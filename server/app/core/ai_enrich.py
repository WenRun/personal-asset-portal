"""AI 元数据识别任务（一期：图片 / 视频 / 书籍 / 字体；音乐二期按专辑设计）。

与图书刮削（scrape:book）同一套原则，口径完全对齐：
- 只填空缺：assets.note 为空才写 AI 描述；suggested_category 是推荐位可更新；
  标签 / 标题修正 / 视频系列名 / 书籍作者等**身份字段只存 meta.ai_enrich.suggestions**，
  详情页展示并由管理员一键采纳——绝不静默改用户手填内容。
- assets.rating 永不写（那是「我的评分」）；书籍不采信 AI 报的 ISBN（乱编风险，只信豆瓣/Google/PDF 扫描）。
- 状态记 meta.ai_enrich.status：ok / not_found / error / skipped，幂等判定与批量入队共用。
- 视觉证据全部来自现成派生物（缩略图/抽帧/封面/样张），零新增派生任务。
"""

import datetime as dt

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.ai import (
    AI_ENRICHABLE_TYPES, AiCallError, ai_config_ready, category_vocabulary, chat,
    get_ai_config, parse_json_content, vision_messages,
)
from app.core.config import get_settings
from app.core.jobs import enqueue
from app.core.models import Asset, BookDetail, FontDetail, ImageDetail, VideoDetail, VideoSeries
from app.core.pipeline import register

DESC_LIMIT = 800            # AI 简介写入 note 的截断长度（防 JSONB 与列表页膨胀）
TAG_LIMIT = 6               # 采纳建议里的标签上限
BOOK_BATCH_SCRAPE_DEAD = ("not_found", "ambiguous", "skipped")  # 在线刮削已到头的书，AI 才兜底

SYSTEM_PROMPT = """你是个人资源库的元数据整理助手。根据给出的文件信息和图片推断这份资源的元数据。
要求：
- 用中文，只输出一个 JSON 对象，不要输出其它任何文字。
- description：80~200 字的客观描述，概括内容与风格；只依据图片与给定信息推断，禁止编造拿不准的具体事实（人名、出版社、获奖信息等）。
- category：分类路径，用 / 分层（如「摄影相片/风景」）。必须优先从「已有分类」列表里选；都不合适才新建一个简短分类。
- tags：3~6 个简短标签，每个不超过 12 个字。
- title_suggestion：当前标题明显不规范（乱码、多余后缀、错把文件名当标题）时给出更规范的标题，否则为 null。
- 拿不准的字段一律填 null 或空数组，宁可空着也不要硬编。"""

_TYPE_INSTRUCTIONS = {
    "image": "这是图片库中的一张图片，附件是它的缩略图。description 请描述画面主体、场景与风格。",
    "video": (
        "这是视频库中的一个文件，附件是视频约 10% 与 60% 处的两张截图。"
        "额外输出 kind：判断它是 tutorial（教学课程，画面有讲义/代码/界面）还是 clip（单个素材片段），拿不准为 null；"
        "series_guess：若像系列课程或剧集，给出系列名，否则 null。"
    ),
    "book": (
        "这是电子书，附件是封面。豆瓣与 Google Books 在线书目均未收录此书，请依据封面与文件信息推断。"
        "额外输出 authors（作者数组）、publisher（出版社）、pub_year（出版年，整数）；ISBN 一律输出 null，禁止猜测。"
    ),
    "font": "这是字体文件，附件是用该字体渲染的中文样张。description 请介绍字体的风格特征与适用场景。",
}

_TYPE_LABELS = {"image": "图片", "video": "视频", "book": "书籍", "font": "字体"}


def _now() -> str:
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


# ---------- 证据收集 ----------

def _first_existing(*paths) -> list:
    """按优先级取**第一个**存在的路径（图片/书籍的候选是同一张图的不同来源或分辨率，
    只发最优的一份，别把同图两遍烧 token）。视频例外：两张抽帧是不同画面，见调用处。"""
    for p in paths:
        if p and p.is_file():
            return [p]
    return []


async def _collect_evidence(db: AsyncSession, asset: Asset) -> tuple[str, list]:
    """按类型组装（证据文本, 派生图片路径列表）。图片缺失不拦识别：退化为纯文本推断。"""
    root = get_settings().data_root
    atype = asset.asset_type
    lines = [f"资源类型：{_TYPE_LABELS.get(atype, atype)}", f"文件名：{asset.file_name}"]
    if asset.title and asset.title != asset.file_name.rsplit(".", 1)[0]:
        lines.append(f"当前标题：{asset.title}")
    if asset.category:
        lines.append(f"所在目录分类：{asset.category}")

    images: list = []
    if atype == "image":
        d = root / "derived" / "images" / str(asset.id)
        images = _first_existing(d / "thumb_1024.webp", d / "thumb_256.webp")
        det = await db.get(ImageDetail, asset.id)
        if det:
            shot = [x for x in [
                det.camera_model or det.camera_make,
                det.lens,
                f"{det.focal_length_mm:g}mm" if det.focal_length_mm else None,
                f"f/{det.aperture:g}" if det.aperture else None,
                f"ISO {det.iso}" if det.iso else None,
                det.taken_at.strftime("%Y-%m-%d") if det.taken_at else None,
            ] if x]
            if shot:
                lines.append("拍摄信息：" + " · ".join(shot))
            if det.width and det.height:
                lines.append(f"尺寸：{det.width}×{det.height}")
    elif atype == "video":
        d = root / "derived" / "videos" / str(asset.id)
        # 10% 与 60% 两帧是不同画面：两张都要（开头 + 中段信息量大）
        images = [p for p in (d / "cover_1.jpg", d / "cover_3.jpg") if p.is_file()]
        det = await db.get(VideoDetail, asset.id)
        if det:
            if det.kind:
                lines.append(f"当前归类：{'教程' if det.kind == 'tutorial' else '素材片段'}")
            if det.series_id and (s := await db.get(VideoSeries, det.series_id)) is not None:
                lines.append(f"所属系列：{s.name}")
            if det.episode is not None:
                lines.append(f"第 {det.episode} 集")
            if det.duration_ms:
                lines.append(f"时长：{det.duration_ms // 60000} 分钟")
            if det.width and det.height:
                lines.append(f"分辨率：{det.width}×{det.height}")
    elif atype == "book":
        d = root / "derived" / "books" / str(asset.id)
        # cover_src.* 是刮削下载/文件自带真封面优先；否则用派生封面
        src = next(d.glob("cover_src.*"), None) if d.is_dir() else None
        images = _first_existing(src, d / "cover_1024.webp", d / "cover_256.webp")
        det = await db.get(BookDetail, asset.id)
        if det:
            info = [x for x in [
                "、".join(det.authors) if det.authors else None,
                det.publisher,
                str(det.pub_year) if det.pub_year else None,
                (det.format or "").upper(),
                f"{det.pages} 页" if det.pages else None,
            ] if x]
            if info:
                lines.append("书籍信息：" + " · ".join(info))
    elif atype == "font":
        d = root / "derived" / "fonts" / str(asset.id)
        images = _first_existing(d / "specimen.png")
        det = await db.get(FontDetail, asset.id)
        if det:
            info = [x for x in [
                det.style,
                f"字重 {det.weight}" if det.weight else None,
                "可变字体" if det.is_variable else None,
                det.designer,
            ] if x]
            if info:
                lines.append("字体信息：" + " · ".join(info))
            if det.languages:
                lines.append(f"语言覆盖：{'、'.join(det.languages[:8])}")

    if not (asset.note or "").strip():
        lines.append("简介：暂无（正等待补全）")
    return "\n".join(lines), images


def _user_prompt(evidence: str, vocab: list[str], asset_type: str) -> str:
    vocab_line = "、".join(vocab[:40]) if vocab else "（暂无，可新建）"
    return (
        f"{_TYPE_INSTRUCTIONS[asset_type]}\n\n文件信息：\n{evidence}\n\n"
        f"已有分类（category 必须优先从中选）：{vocab_line}\n\n"
        "请输出 JSON，字段：description、category、tags、title_suggestion"
        + ("、kind、series_guess" if asset_type == "video" else "")
        + ("、authors、publisher、pub_year、isbn(恒为 null)" if asset_type == "book" else "")
        + "。"
    )


# ---------- 结果归一与落库（纯函数便于单测） ----------

def normalize_result(parsed: dict, asset_type: str) -> dict:
    """模型输出 → 干净的建议结构：截断、去空、非法值丢弃。"""
    def _s(v) -> str | None:
        v = str(v).strip() if v is not None else ""
        return v or None

    tags = []
    for t in (parsed.get("tags") or [])[:TAG_LIMIT * 2]:
        t = str(t).strip()
        if t and len(t) <= 16 and t not in tags:
            tags.append(t)
    out: dict = {
        "description": (_s(parsed.get("description")) or "")[:DESC_LIMIT] or None,
        "category": _s(parsed.get("category")),
        "title": _s(parsed.get("title_suggestion")),
        "tags": tags[:TAG_LIMIT],
    }
    if asset_type == "video":
        kind = str(parsed.get("kind") or "").strip().lower()
        out["video"] = {
            "kind": kind if kind in ("clip", "tutorial") else None,
            "series": _s(parsed.get("series_guess")),
        }
    if asset_type == "book":
        try:
            year = int(parsed.get("pub_year"))
        except (TypeError, ValueError):
            year = None
        authors = [str(a).strip() for a in (parsed.get("authors") or [])[:4] if str(a).strip()]
        out["book"] = {"authors": authors, "publisher": _s(parsed.get("publisher")), "pub_year": year if year and 1000 <= year <= 2100 else None}
    return out


def apply_result(asset: Asset, result: dict) -> tuple[list, dict]:
    """落库：返回 (applied 字段名列表, suggestions)。note 只填空缺；分类进推荐位；
    其余全部进 suggestions 由前端一键采纳。"""
    applied: list[str] = []
    if result.get("description") and not (asset.note or "").strip():
        asset.note = result["description"]
        applied.append("note")
    if result.get("category"):
        asset.suggested_category = result["category"]
        applied.append("suggested_category")

    suggestions: dict = {}
    if result.get("title"):
        suggestions["title"] = result["title"]
    if result.get("tags"):
        suggestions["tags"] = result["tags"]
    if result.get("video"):
        v = {k: x for k, x in result["video"].items() if x}
        if v:
            suggestions["video"] = v
    if result.get("book"):
        b = {k: x for k, x in result["book"].items() if x}
        if b:
            suggestions["book"] = b
    return applied, suggestions


def needs_ai_enrich(asset: Asset) -> bool:
    """批量入队门槛：从未 AI 识别过 且 简介仍为空（花钱的事只在缺信息时做）。"""
    if ((asset.meta or {}).get("ai_enrich") or {}).get("status") is not None:
        return False
    return not (asset.note or "").strip()


def _set_status(asset: Asset, status: str, **extra) -> None:
    meta = dict(asset.meta or {})
    meta["ai_enrich"] = {**(meta.get("ai_enrich") or {}), "status": status, "time": _now(), **extra}
    asset.meta = meta


# ---------- 任务处理器 ----------

@register("ai_enrich")
async def ai_enrich(db: AsyncSession, payload: dict) -> None:
    """单资源 AI 识别：payload {asset_id}。手动触发即视为强制重跑（点击就是要再试一次）。"""
    asset = await db.get(Asset, payload["asset_id"])
    if asset is None or asset.deleted_at is not None or asset.asset_type not in AI_ENRICHABLE_TYPES:
        return

    cfg = await get_ai_config(db)
    ready, hint = ai_config_ready(cfg)
    if not ready:
        # 入队后配置被关掉：记 skipped 而非报错，任务中心不产生红色失败
        _set_status(asset, "skipped", reason=hint)
        await db.commit()
        return

    evidence, images = await _collect_evidence(db, asset)
    vocab = await category_vocabulary(db, asset.asset_type)
    messages = vision_messages(SYSTEM_PROMPT, _user_prompt(evidence, vocab, asset.asset_type), images)

    try:
        content, usage = await chat(cfg, messages, max_tokens=768, temperature=0.2)
    except AiCallError as exc:
        # 网络 / 供应商错误：抛给任务系统按 30s/5m/30m 退避重试（与刮削同款路径）
        raise RuntimeError(f"AI 调用失败：{exc}") from exc

    parsed = parse_json_content(content)
    if parsed is None:
        _set_status(asset, "error", model=cfg.get("model"),
                    error=f"模型未返回可解析 JSON：{(content or '')[:160]}")
        await db.commit()
        return

    result = normalize_result(parsed, asset.asset_type)
    applied, suggestions = apply_result(asset, result)
    if not applied and not suggestions:
        # 模型明说啥也推断不出来：落 not_found，批量不再重复打扰
        _set_status(asset, "not_found", model=cfg.get("model"), usage=usage)
        await db.commit()
        return

    _set_status(asset, "ok", model=cfg.get("model"), applied=applied,
                suggestions=suggestions or None, usage=usage)
    await enqueue(db, "index_meili", {"asset_id": str(asset.id)}, priority=8)
    await db.commit()
