"""豆瓣读书刮削（第二期）：中文书数据最全的来源——评分、丛书、中文简介、封面大图。

关键约束：
- **国内直连、不走代理**：代理是海外出口，豆瓣对海外 IP 风控更严；本模块的所有请求
  （含 doubanio.com 封面下载）一律直连。
- **全局限速**：豆瓣无官方 API，靠网页接口；进程内全局锁 + 最小间隔串行化请求，
  并发 worker 也不会打爆。被风控（403/验证页）时抛 DoubanBlockedError 交由任务退避。
- 端点（2026-10 实测，无需登录）：
  * ``/j/subject_suggest?q=``      JSON 建议：title/url/pic/author_name/year/type/id
  * ``/isbn/{isbn}``               301→302 跳转到 ``/subject/{id}/``（查无则停留 404）
  * ``/subject/{id}/``             详情页：#info 文本块 + JSON-LD + og:image + v:average 评分
"""

import asyncio
import html as html_mod
import json
import re
import time

import httpx

from app.core.config import get_settings
from app.domains.books.scrape import BookCandidate, normalize_isbn

BOOK_BASE = "https://book.douban.com"
DOUBAN_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
             "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")
MIN_INTERVAL = 1.2  # 豆瓣限速：相邻请求最小间隔（秒）——1 qps 量级长期安全

_req_lock = asyncio.Lock()
_last_at = 0.0


class DoubanBlockedError(RuntimeError):
    """豆瓣风控（403 / 验证页 / 封禁页）：任务应退避重试而不是当成 not_found。"""


def _direct_client(follow_redirects: bool) -> httpx.AsyncClient:
    # 注意：绝不过代理——海外出口访问豆瓣反而触发风控
    return httpx.AsyncClient(
        timeout=get_settings().scrape_timeout_seconds,
        follow_redirects=follow_redirects,
        headers={"User-Agent": DOUBAN_UA, "Accept-Language": "zh-CN,zh;q=0.9"},
    )


async def _throttled_get(url: str, *, params: dict | None = None, follow_redirects: bool = True) -> httpx.Response:
    """全局串行 + 最小间隔：多 worker 并发时也保持 1qps 量级。"""
    global _last_at
    async with _req_lock:
        wait = _last_at + MIN_INTERVAL - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        _last_at = time.monotonic()
        async with _direct_client(follow_redirects) as c:
            r = await c.get(url, params=params)
    if r.status_code in (403, 418) or (r.status_code == 200 and "Verify" in str(r.url.host)):
        raise DoubanBlockedError(f"豆瓣拒绝访问（HTTP {r.status_code}），疑似触发风控")
    return r


# ---------- 纯解析函数（单测覆盖） ----------

def parse_suggest(data: dict | list) -> list[BookCandidate]:
    """subject_suggest 响应 → 候选（仅建议级字段：题名/作者/年份/小图，详情需再取详情页）。"""
    items = data if isinstance(data, list) else (data or {}).get("cards") or []
    out = []
    for it in items:
        if it.get("type") not in ("b", "book"):
            continue
        sid = str(it.get("id") or "")
        if not sid or not it.get("title"):
            continue
        out.append(BookCandidate(
            source="douban",
            source_id=f"douban:{sid}",
            title=str(it["title"]).strip(),
            authors=[it["author_name"]] if it.get("author_name") else [],
            pub_year=int(m.group(0)) if it.get("year") and (m := re.search(r"\d{4}", str(it["year"]))) else None,
            cover_url=it.get("pic") or None,
        ))
    return out


_RE_INT = re.compile(r"\d+")


def _info_pairs(block_html: str) -> dict[str, str]:
    """#info 文本块 → {"出版社": "...", "出版年": ...}。<br> 视为换行（多作者/多译者），实体反转义。
    真实页面两种排版并存：「出版社: 人民邮电出版社」同行，或「出版社:」单独一行、值在下一行。"""
    text = re.sub(r"<br\s*/?>", "\n", block_html)
    text = html_mod.unescape(re.sub(r"<[^>]+>", "", text))
    lines = [ln.replace("\xa0", " ").strip() for ln in text.splitlines()]
    label_re = re.compile(r"^([\u4e00-\u9fff]{2,4})\s*[:：]\s*(.*)$")

    pairs: dict[str, str] = {}
    i = 0
    while i < len(lines):
        m = label_re.match(lines[i])
        if m is None:
            i += 1
            continue
        label, value = m.group(1), m.group(2).strip()
        if not value:
            # 值在下一行：跳过空行，取第一条非「标签:」开头的行
            j = i + 1
            while j < len(lines) and not lines[j]:
                j += 1
            if j < len(lines) and label_re.match(lines[j]) is None and lines[j]:
                value = lines[j].strip()
                i = j
        if value:
            pairs[label] = value
        i += 1
    return pairs


def parse_subject_html(html: str, subject_id: str) -> BookCandidate | None:
    """详情页 → 完整候选：#info（出版社/出版年/页数/丛书/ISBN）+ JSON-LD（题名/作者/ISBN）
    + og:image（大图封面）+ v:average（豆瓣评分 0-10）+ 首个 intro（内容简介）。"""
    ld: dict = {}
    if (m := re.search(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)):
        try:
            ld = json.loads(m.group(1))
        except (ValueError, TypeError):
            ld = {}

    info: dict[str, str] = {}
    if (m := re.search(r'<div id="info"[^>]*>(.*?)</div>', html, re.S)):
        info = _info_pairs(m.group(1))

    title = str(ld.get("name") or "").strip()
    if not title:
        og_t = re.search(r'property="og:title" content="([^"]+)"', html)
        title = og_t.group(1).strip() if og_t else ""
    if not title:
        return None

    authors = [a.get("name") for a in ld.get("author") or [] if a.get("name")]
    if not authors and "作者" in info:
        authors = [a.strip() for a in info["作者"].split("/") if a.strip()]

    rating = None
    if (m := re.search(r'property="v:average">\s*([\d.]+)\s*<', html)) and float(m.group(1)) > 0:
        rating = float(m.group(1))

    description = ""
    for intro in re.findall(r'<div class="intro">(.*?)</div>', html, re.S):
        paras = [html_mod.unescape(re.sub(r"<[^>]+>", "", p)).strip()
                 for p in re.findall(r"<p>(.*?)</p>", intro, re.S)]
        paras = [p for p in paras if p]
        if paras:
            description = "\n\n".join(paras)
            break

    pub_year = None
    if info.get("出版年") and (m := re.search(r"\d{4}", info["出版年"])):
        pub_year = int(m.group(0))
    pages = None
    if info.get("页数") and (m := _RE_INT.search(info["页数"])):
        pages = int(m.group(0))
    cover_url = None
    if (m := re.search(r'property="og:image" content="([^"]+)"', html)):
        cover_url = m.group(1)
    isbn = normalize_isbn(ld.get("isbn") or info.get("ISBN"))

    return BookCandidate(
        source="douban",
        source_id=f"douban:{subject_id}",
        title=title,
        authors=authors,
        publisher=info.get("出版社"),
        pub_year=pub_year,
        isbn=isbn,
        pages=pages,
        series_name=info.get("丛书"),
        description=description or None,
        cover_url=cover_url,
        rating=rating,
        rating_source="douban" if rating is not None else None,
    )


# ---------- 网络函数 ----------

async def douban_isbn_lookup(isbn: str) -> BookCandidate | None:
    """ISBN 直查：/isbn/{isbn} 跳转到条目页即权威命中；查无返回 None。"""
    r = await _throttled_get(f"{BOOK_BASE}/isbn/{isbn}")
    if r.status_code == 404 or r.status_code >= 500:
        return None
    m = re.search(r"/subject/(\d+)", str(r.url))
    if m is None:
        return None
    if r.status_code != 200:
        return None
    return parse_subject_html(r.text, m.group(1))


async def douban_search(query: str) -> list[BookCandidate]:
    """subject_suggest 关键词搜索（建议级字段，作者/年份/小图；出版社与评分在详情页）。"""
    r = await _throttled_get(f"{BOOK_BASE}/j/subject_suggest", params={"q": query}, follow_redirects=False)
    if r.status_code == 404:
        return []
    r.raise_for_status()
    try:
        data = r.json()
    except ValueError:
        return []
    return parse_suggest(data)


async def douban_subject(subject_id: str) -> BookCandidate | None:
    """按条目 ID 取详情页完整数据（评分/出版社/丛书/简介/大图封面）。"""
    r = await _throttled_get(f"{BOOK_BASE}/subject/{subject_id}/")
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return parse_subject_html(r.text, subject_id)
