"""图书元数据刮削第一期（Google Books）：

- 查询顺序：ISBN 直查（几乎不错配）→ 书名+作者搜索兜底；
  书名搜出多个候选时不自动落库，进「入库确认队列」由管理员人工选择。
- 落库原则：只填空缺字段，绝不覆盖已有内容；网络评分存 meta（assets.rating 是「我的评分」，
  由用户手动维护，不写网络分）；简介沿用 assets.note。
- 封面原则：文件自带封面（epub OPF / PDF 首页渲染）不动；仅当无封面或当前是合成封面
  （TXT/无封面 MOBI 的占位图，见 meta.cover_synthetic）时才下载网络封面，落 cover_src.*
  后复用既有 derive:book_cover 派生管线。
- 幂等：结果记在 meta.book_scrape.status（ok/skipped/not_found/ambiguous），重复入队自动跳过；
  force 可强制重刮（用户明确「跳过」的除外）。
"""

import html as html_mod
import io
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime as dt
from pathlib import Path

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.jobs import enqueue
from app.core.models import Asset, BookDetail
from app.core.pipeline import register

GB_VOLUMES_URL = "https://www.googleapis.com/books/v1/volumes"
UA = "Mozilla/5.0 (X11; Linux x86_64) personal-asset-portal/1.0 (book metadata scraper)"

MAX_CANDIDATES = 5            # 书名搜索多候选时存入 meta 的上限（确认队列展示用）
DESC_META_LIMIT = 1200        # 候选简介存 meta 的截断长度（防 JSONB 膨胀）
PDF_ISBN_SCAN_PAGES = 8       # PDF 版权页（含 ISBN）通常在前几页


# ---------- ISBN 提取与校验 ----------

def normalize_isbn(raw: str | None) -> str | None:
    """清洗并校验（校验位不对的返回 None，宁可查不到也不用错号码）。"""
    if not raw:
        return None
    s = re.sub(r"[^0-9Xx]", "", str(raw)).upper()
    if len(s) == 13 and s.isdigit() and _isbn13_ok(s):
        return s
    if len(s) == 10 and _isbn10_ok(s):
        return s
    return None


def _isbn13_ok(s: str) -> bool:
    total = sum(int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(s[:12]))
    return (10 - total % 10) % 10 == int(s[12])


def _isbn10_ok(s: str) -> bool:
    total = sum((10 - i) * (10 if c == "X" else int(c)) for i, c in enumerate(s))
    return total % 11 == 0


# 13 位：978/979 开头、数字间允许 - — – 空格分隔（版权页排版各异）
_RE_ISBN13 = re.compile(r"97[89](?:[\s\-—–]?[0-9]){10}(?![0-9])")
# 10 位：仅认带 ISBN 标签的（裸 10 位数字串误报率太高，如电话/书号）
_RE_ISBN10_LABELED = re.compile(r"ISBN(?:-1[03])?[\s\-—:：·]*((?:[0-9][\s\-—–]?){9}[0-9Xx])(?![0-9Xx])", re.I)


def extract_isbn_from_text(text: str | None) -> str | None:
    """从 PDF 前几页文本/文件名等抽取 ISBN：先扫 13 位（带不带标签都认），再认带标签的 10 位。"""
    if not text:
        return None
    for m in _RE_ISBN13.finditer(text):
        if (n := normalize_isbn(m.group(0))):
            return n
    for m in _RE_ISBN10_LABELED.finditer(text):
        if (n := normalize_isbn(m.group(1))):
            return n
    return None


# ---------- Google Books 客户端 ----------

@dataclass
class BookCandidate:
    source_id: str
    title: str
    authors: list[str] = field(default_factory=list)
    publisher: str | None = None
    pub_year: int | None = None
    isbn: str | None = None
    pages: int | None = None
    language: str | None = None
    description: str | None = None
    cover_url: str | None = None
    rating: float | None = None            # 网络评分原始值（豆瓣 0-10 / Google 1-5）
    rating_source: str | None = None       # "douban" | "google"，与 rating 搭配
    source: str = "google"                 # "google" | "douban"（确认队列展示与详情补全用）
    series_name: str | None = None         # 丛书（豆瓣独有）

    def to_dict(self) -> dict:
        d = asdict(self)
        if d.get("description") and len(d["description"]) > DESC_META_LIMIT:
            d["description"] = d["description"][:DESC_META_LIMIT] + "…"
        return d


def _plain_description(raw: str | None) -> str | None:
    """Google 简介带 <br>/<b> 等 HTML，转纯文本。"""
    if not raw:
        return None
    text = html_mod.unescape(re.sub(r"<[^>]+>", " ", raw))
    return re.sub(r"[ \t]+", " ", text).strip() or None


def candidates_from_response(data: dict) -> list[BookCandidate]:
    """解析 volumes 响应为候选列表（纯函数便于单测）。"""
    out: list[BookCandidate] = []
    for item in (data or {}).get("items") or []:
        vi = item.get("volumeInfo") or {}
        isbn = None
        for ident in vi.get("industryIdentifiers") or []:
            if (t := ident.get("type")) in ("ISBN_13", "ISBN_10"):
                isbn = normalize_isbn(ident.get("identifier"))
                if isbn and t == "ISBN_13":
                    break
        pub = (vi.get("publishedDate") or "")[:4]
        links = vi.get("imageLinks") or {}
        out.append(BookCandidate(
            source_id=str(item.get("id") or ""),
            title=(vi.get("title") or "").strip(),
            authors=[a for a in (vi.get("authors") or []) if a],
            publisher=vi.get("publisher") or None,
            pub_year=int(pub) if pub.isdigit() else None,
            isbn=isbn,
            pages=vi.get("pageCount") or None,
            language=vi.get("language") or None,
            description=_plain_description(vi.get("description")),
            cover_url=links.get("thumbnail") or links.get("smallThumbnail"),
            rating=vi.get("averageRating"),
            rating_source="google" if vi.get("averageRating") is not None else None,
        ))
    return [c for c in out if c.title]


def upscale_cover_url(url: str) -> str:
    """Google 封面链接默认 zoom=1 缩略图：换 zoom=3 取大图，去掉 edge=curl 翻页特效。"""
    u = url.replace("edge=curl", "")
    return re.sub(r"zoom=\d", "zoom=3", u)


def cover_urls(primary_url: str, isbn: str | None) -> list[str]:
    """封面下载候选 URL。豆瓣封面（doubanio.com）国内直连且原图即大图：不做变换、不兜底；
    Google 封面强制 https（明文 http 在部分出口网络直接被重置），有 ISBN 时追加
    OpenLibrary 兜底（Google 图片 CDN 常按出口 IP 封禁 403，OpenLibrary 对英文书覆盖好）。"""
    if "doubanio.com" in primary_url:
        return [primary_url]
    urls = [re.sub(r"^http://", "https://", upscale_cover_url(primary_url), count=1)]
    if isbn:
        urls.append(f"https://covers.openlibrary.org/b/isbn/{isbn}-L.jpg?default=false")
    return urls


def _client(use_proxy: bool = True) -> httpx.AsyncClient:
    s = get_settings()
    kw: dict = {
        "timeout": s.scrape_timeout_seconds,
        "follow_redirects": True,
        "headers": {"User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.5"},
    }
    # 容错：host:port 形式（没写协议头）自动补 http://，httpx 不接受裸地址
    if use_proxy and s.scrape_proxy_url:
        proxy = s.scrape_proxy_url if "://" in s.scrape_proxy_url else f"http://{s.scrape_proxy_url}"
        kw["proxy"] = proxy
    return httpx.AsyncClient(**kw)


async def google_books_search(query: str) -> list[BookCandidate]:
    """查询 Google Books。query 可为裸关键词或 isbn:978… 形式；网络/HTTP 错误直接抛给任务退避重试。
    免 key 调用按 IP 共享匿名配额（常 429），配置 SCRAPE_GOOGLE_BOOKS_KEY 后走独立 1000 次/天。"""
    params: dict = {
        "q": query, "maxResults": 12, "printType": "books", "country": "US",
    }
    if get_settings().scrape_google_books_key:
        params["key"] = get_settings().scrape_google_books_key
    async with _client() as c:
        r = await c.get(GB_VOLUMES_URL, params=params)
        r.raise_for_status()
        return candidates_from_response(r.json())

async def download_cover(primary_url: str, out_dir: Path, isbn: str | None = None) -> tuple[str | None, str | None]:
    """依次尝试候选 URL 下载封面到 out_dir/cover_src.{ext}，PIL 校验是真实图片才落盘。
    返回 (文件名, 失败原因)：成功时 (名字, None)；全失败时 (None, 最后一个错误)——
    失败原因交给调用方记入 meta，绝不能静默吞掉（否则线上排查只能靠猜）。"""
    from PIL import Image

    last_err = "no attempt"
    for url in cover_urls(primary_url, isbn):
        try:
            # 豆瓣图片国内直连（海外出口访问 doubanio 反而更易失败）+ 必须带豆瓣 Referer
            # （CDN 反盗链，不带会 418）；其余（Google/OpenLibrary）走代理
            is_douban_img = "doubanio.com" in url
            headers = {"Referer": "https://book.douban.com/"} if is_douban_img else None
            async with _client(use_proxy=not is_douban_img) as c:
                r = await c.get(url, headers=headers)
                r.raise_for_status()
                data = r.content
            img = Image.open(io.BytesIO(data))
            img.load()
            ext = (img.format or "JPEG").lower().replace("jpeg", "jpg")
            out_dir.mkdir(parents=True, exist_ok=True)
            name = f"cover_src.{ext}"
            (out_dir / name).write_bytes(data)
            return name, None
        except Exception as exc:  # noqa: BLE001  封面拿不到不影响元数据，但原因要带回去
            last_err = f"{type(exc).__name__}: {str(exc)[:140]}"
    return None, last_err


# ---------- 落库（只填空缺）与状态 ----------

def _cover_is_synthetic(asset: Asset, detail: BookDetail) -> bool:
    """当前封面是否为合成占位图。meta.cover_synthetic 是权威标记；一期上线前解析的
    老书没有该标记（null），按格式兜底推断：txt 从无内嵌封面必然是合成图；
    epub/pdf 是文件自带真封面；mobi/azw3 无法区分（保守按真封面处理，宁可不换也不错换）。"""
    v = (asset.meta or {}).get("cover_synthetic")
    if v is not None:
        return bool(v)
    return (detail.format or "") == "txt"


def _pick_by_year(candidates: list, detail: BookDetail):
    """多候选同年份择优：书名一致的候选里恰好只有一册出版年与库内一致时直接采用
    （同名多版本最常见的差异就是年份，能消掉大部分本要人工确认的书）。"""
    if not detail.pub_year:
        return None
    same = [c for c in candidates if getattr(c, "pub_year", None) == detail.pub_year]
    return same[0] if len(same) == 1 else None


def _pick_candidate(asset_title: str | None, cands: list, detail: BookDetail):
    """书名搜索候选择优：唯一命中 / 书名唯一一致 / 年份唯一一致；都不满足返回 None（进确认队列）。"""
    exacts = [c for c in cands if _title_matches(asset_title, c.title)]
    pick = _pick_by_year(exacts, detail)
    if pick is None and len(exacts) == 1:
        pick = exacts[0]
    if pick is None and len(cands) == 1:
        pick = cands[0]
    return pick


def _now() -> str:
    return dt.now().astimezone().isoformat(timespec="seconds")


def fill_missing(asset: Asset, detail: BookDetail, cand: BookCandidate) -> None:
    """把候选字段写进资产：仅当当前为空才写，已有内容（含用户手填）一律不动。"""
    if not detail.authors and cand.authors:
        detail.authors = cand.authors
    if not detail.publisher and cand.publisher:
        detail.publisher = cand.publisher
    if detail.pub_year is None and cand.pub_year:
        detail.pub_year = cand.pub_year
    if not detail.isbn and cand.isbn:
        detail.isbn = cand.isbn
    if not detail.language and cand.language:
        detail.language = cand.language
    if detail.pages is None and cand.pages:
        detail.pages = cand.pages
    if not detail.series_name and cand.series_name:
        detail.series_name = cand.series_name
    if not (asset.note or "").strip() and cand.description:
        asset.note = cand.description


def needs_scrape(asset: Asset, detail: BookDetail | None) -> bool:
    """自动入队门槛：从未刮削过 且 仍有信息缺口。已 ok/not_found/ambiguous/skipped 的不再自动重刮。"""
    st = ((asset.meta or {}).get("book_scrape") or {}).get("status")
    if st is not None:
        return False
    if detail is None:
        return True
    return (
        not (detail.authors or [])
        or not detail.publisher
        or detail.pub_year is None
        or not detail.isbn
        or not (asset.note or "").strip()
        or bool((asset.meta or {}).get("cover_synthetic"))
    )


async def apply_candidate(db: AsyncSession, asset: Asset, detail: BookDetail, cand: BookCandidate, *, matched_by: str) -> dict:
    """应用候选：填字段 + 按需换封面 + 写 meta 状态（不 commit，由调用方统一提交）。"""
    fill_missing(asset, detail, cand)

    scrape_meta: dict = {
        "status": "ok",
        "source": cand.source,
        "matched_by": matched_by,       # isbn | title | manual（确认队列人工选择）
        "matched_title": cand.title,
        "rating": cand.rating,
        "rating_source": cand.rating_source,  # 豆瓣 0-10 / Google 1-5；assets.rating 是「我的评分」，不写
        "time": _now(),
    }

    from app.domains.books.parser import derived_dir

    out_dir = derived_dir(str(asset.id))
    has_cover = out_dir.is_dir() and next(out_dir.glob("cover_src.*"), None) is not None
    if cand.cover_url and (not has_cover or _cover_is_synthetic(asset, detail)):
        name, cover_err = await download_cover(
            cand.cover_url, out_dir, isbn=normalize_isbn(detail.isbn) or cand.isbn
        )
        if name:
            scrape_meta["cover"] = name
        elif cover_err:
            scrape_meta["cover_error"] = cover_err  # 线上排查关键：封面失败原因落 meta，不静默

    meta = dict(asset.meta or {})
    if scrape_meta.get("cover"):
        meta["cover_synthetic"] = False
    # 合并保留旧状态里的 providers_tried 等记录（成功时清掉过期的 douban_error）
    merged = {**(meta.get("book_scrape") or {}), **scrape_meta}
    if scrape_meta.get("status") == "ok":
        merged.pop("douban_error", None)
    meta["book_scrape"] = merged
    asset.meta = meta
    await enqueue(db, "index_meili", {"asset_id": str(asset.id)}, priority=8)
    if scrape_meta.get("cover"):
        await enqueue(db, "derive:book_cover", {"asset_id": str(asset.id)}, priority=5)
    return scrape_meta


async def mark_skipped(db: AsyncSession, asset: Asset) -> None:
    meta = dict(asset.meta or {})
    meta["book_scrape"] = {**(meta.get("book_scrape") or {}), "status": "skipped", "time": _now()}
    asset.meta = meta
    await db.commit()


async def apply_stored_candidate(db: AsyncSession, asset: Asset, candidate_id: str) -> None:
    """确认队列人工选择候选后应用。豆瓣候选若来自 suggest（只有建议级字段），
    先取详情页补全评分/出版社/丛书/简介/大图，再统一走 apply。"""
    cands = ((asset.meta or {}).get("book_scrape") or {}).get("candidates") or []
    raw = next((c for c in cands if c.get("source_id") == candidate_id), None)
    if raw is None:
        raise LookupError(f"候选不存在: {candidate_id}")
    if raw.get("source") == "douban" and not raw.get("rating") and not raw.get("publisher"):
        from app.domains.books.douban import douban_subject

        sid = str(raw.get("source_id") or "").removeprefix("douban:")
        if (full := await douban_subject(sid)) is not None:
            raw = {**raw, **{k: v for k, v in full.to_dict().items() if v}}
    detail = await db.get(BookDetail, asset.id)
    if detail is None:
        detail = BookDetail(asset_id=asset.id)
        db.add(detail)
    await apply_candidate(db, asset, detail, BookCandidate(**{
        k: v for k, v in raw.items() if k in BookCandidate.__dataclass_fields__
    }), matched_by="manual")
    await db.commit()


# ---------- 任务处理器 ----------

def _set_status(asset: Asset, status: str, **extra) -> None:
    meta = dict(asset.meta or {})
    meta["book_scrape"] = {**(meta.get("book_scrape") or {}), "status": status, "time": _now(), **extra}
    asset.meta = meta


def _title_matches(a: str | None, b: str | None) -> bool:
    """书名一致性：去除空白与常见全/半角标点后忽略大小写互为包含（容忍副标题、版次后缀）。"""
    strip = r"[\s：:，,。·・\-—－（）()［\]【】《》<>\"'‘’“”]"
    na, nb = re.sub(strip, "", a or "").lower(), re.sub(strip, "", b or "").lower()
    return bool(na) and bool(nb) and (na in nb or nb in na)


def _title_query(asset: Asset, detail: BookDetail) -> str:
    """书名搜索词：书名 + 第一作者。"""
    q = (asset.title or "").strip()
    if detail.authors:
        q = f"{q} {detail.authors[0]}"
    return q


async def _search_by_title(asset: Asset, detail: BookDetail) -> list[BookCandidate]:
    """书名搜索：先「书名+第一作者」，候选里没有书名能对上的（组合词污染召回，
    尤其中文书名配英文/无关作者名）再退到纯书名查询；仍无书名命中才返回首组结果兜底。"""
    title = (asset.title or "").strip()
    if not title:
        return []
    queries = [f"{title} {detail.authors[0]}"] if detail.authors else []
    queries.append(title)
    fallback: list[BookCandidate] = []
    for q in queries:
        cands = await google_books_search(q)
        if not cands:
            continue
        if any(_title_matches(title, c.title) for c in cands):
            return cands
        fallback = fallback or cands
    return fallback


def _needs_douban_pass(asset: Asset) -> bool:
    """第二期豆瓣补量判定：启用豆瓣且这本书还没试过豆瓣——已 ok（Google 来源）的存量书
    借此补一次豆瓣评分/丛书/封面，providers_tried 记录后不再重复。"""
    if not get_settings().scrape_douban_enabled:
        return False
    bs = (asset.meta or {}).get("book_scrape") or {}
    return bs.get("status") != "skipped" and "douban" not in (bs.get("providers_tried") or [])


@register("scrape:book")
async def scrape_book(db: AsyncSession, payload: dict) -> None:
    """单本图书刮削：payload 支持 {asset_id} / {asset_id, force} / {asset_id, candidate_id}。"""
    if not get_settings().scrape_enabled:
        return
    asset = await db.get(Asset, payload["asset_id"])
    if asset is None or asset.deleted_at is not None or asset.asset_type != "book":
        return
    prev = (asset.meta or {}).get("book_scrape") or {}

    # 确认队列指定候选：直接应用
    if (cand_id := payload.get("candidate_id")) is not None:
        await apply_stored_candidate(db, asset, str(cand_id))
        return

    # 人工「跳过」永远生效（force 也不覆盖）
    if prev.get("status") == "skipped":
        return
    # 幂等：已终态的任务跳过（force 只能重刮 ok/not_found/ambiguous）。
    # 例外：第二期上线后「没试过豆瓣」的存量书放行一次（providers_tried 记录后不再重复）。
    if not payload.get("force") and prev.get("status") in ("ok", "not_found", "ambiguous") \
            and not _needs_douban_pass(asset):
        return

    detail = await db.get(BookDetail, asset.id)
    if detail is None:
        detail = BookDetail(asset_id=asset.id)
        db.add(detail)
        await db.flush()

    # 查询键：优先 ISBN（文件元数据 / PDF 版权页 / 文件名兜底）
    isbn = normalize_isbn(detail.isbn) or extract_isbn_from_text(asset.file_name) or extract_isbn_from_text(asset.title)
    if isbn and not detail.isbn:
        detail.isbn = isbn

    providers_tried: set[str] = set(prev.get("providers_tried") or [])
    douban_err: str | None = None
    applied = False

    # ① 豆瓣优先（中文书最全：评分 0-10/丛书/中文简介/封面大图；国内直连、进程内限速）
    if get_settings().scrape_douban_enabled:
        from app.domains.books import douban

        providers_tried.add("douban")
        try:
            if isbn and (c := await douban.douban_isbn_lookup(isbn)) is not None:
                await apply_candidate(db, asset, detail, c, matched_by="isbn")
                applied = True
            if not applied:
                # suggest 对长查询极敏感：书名+作者组合常直接 0 结果，只用纯书名查
                cands = await douban.douban_search((asset.title or "").strip())
                if (pick := _pick_candidate(asset.title, cands, detail)) is not None:
                    if (full := await douban.douban_subject(pick.source_id.removeprefix("douban:"))) is not None:
                        pick = full  # suggest 只有建议级字段，详情页补全评分/出版社/丛书/简介
                    await apply_candidate(db, asset, detail, pick, matched_by="title")
                    applied = True
                elif len(cands) > 1:
                    # 豆瓣多候选：存建议级字段进确认队列（应用时会自动取详情页补全）
                    _set_status(asset, "ambiguous", source="douban",
                                providers_tried=sorted(providers_tried),
                                candidates=[c.to_dict() for c in cands[:MAX_CANDIDATES]])
                    await db.commit()
                    return
        except Exception as exc:  # noqa: BLE001  豆瓣失败不拦 Google 兜底，原因落 meta 备查
            douban_err = f"{type(exc).__name__}: {str(exc)[:140]}"

    # ② Google 兜底（英文书 / 豆瓣无收录）；此前 Google 已成功且本次只是豆瓣补量未命中时不重复消耗配额
    if not applied and not (prev.get("status") == "ok" and prev.get("source") == "google"):
        providers_tried.add("google")
        candidates: list[BookCandidate] = []
        matched_by = "isbn"
        if isbn:
            candidates = await google_books_search(f"isbn:{isbn}")
        if not candidates:
            candidates = await _search_by_title(asset, detail)
            matched_by = "title"

        if not candidates:
            _set_status(asset, "not_found")
        elif matched_by == "isbn":
            # ISBN 直查视为权威，直接应用（来源与匹配题名记入 meta 备查）
            await apply_candidate(db, asset, detail, candidates[0], matched_by="isbn")
            applied = True
        else:
            # 书名搜索：唯一命中 / 书名唯一一致 / 年份唯一一致 → 直接应用；否则进确认队列
            if (pick := _pick_candidate(asset.title, candidates, detail)) is not None:
                await apply_candidate(db, asset, detail, pick, matched_by="title")
                applied = True
            else:
                _set_status(asset, "ambiguous", source="google",
                            candidates=[c.to_dict() for c in candidates[:MAX_CANDIDATES]])

    if not applied and not (asset.meta or {}).get("book_scrape", {}).get("status"):
        _set_status(asset, "not_found")

    # 统一记录已尝试来源与豆瓣错误（批量补量判定依据；apply/not_found 写入的状态在此合并）
    bs = dict((asset.meta or {}).get("book_scrape") or {})
    bs["providers_tried"] = sorted(providers_tried)
    if douban_err:
        bs["douban_error"] = douban_err
    asset.meta = {**(asset.meta or {}), "book_scrape": bs}
    await db.commit()
