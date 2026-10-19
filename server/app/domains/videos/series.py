"""系列/集数识别（详细设计 §5.3）：文件名正则 + 父目录兜底；存疑标记 need_confirm。"""

import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import Asset, VideoSeries
from app.core.pipeline import roots_of
from app.core.storage import LocalStorage

RULES = [
    (re.compile(r"^(?P<series>.+?)[ ._-]+S\d+E(?P<ep>\d+)", re.IGNORECASE), "SxxEyy"),
    (re.compile(r"^(?P<series>.+?)[ ._-]*第(?P<ep>\d+)[讲集课回]"), "第N讲"),
    (re.compile(r"^(?P<series>.+?)[ ._-]+EP?0*(?P<ep>\d+)$", re.IGNORECASE), "EPnn"),
]

# 章节目录名（课程/第N章 xx/文件）：命中时系列向上卷积到课程（祖父目录）
CHAPTER_RE = re.compile(r"^(?:第\s*0*(?P<cn>\d{1,3})\s*[章节回]|(?:chapter|part)\s*0*(?P<cn2>\d{1,3})[ ._-]?)", re.IGNORECASE)
# 章内文件名的集数模式（纯序号开头 / 第N讲 / EPnn 结尾）
EP_ONLY_RULES = [
    re.compile(r"^0*(?P<ep>\d{1,3})(?:[ ._-]+|$)"),
    re.compile(r"第\s*0*(?P<ep>\d{1,3})\s*[讲集课回]"),
    re.compile(r"[ ._-]EP?0*(?P<ep>\d{1,3})$", re.IGNORECASE),
]


def recognize(file_name: str, storage_key: str, storage: LocalStorage) -> dict:
    """返回 {kind, series_name?, episode?, chapter?, chapter_title?, need_confirm, rule?}。"""
    stem = file_name.rsplit(".", 1)[0]
    for rx, rule in RULES:
        m = rx.match(stem)
        if m:
            series = (m.group("series") or "").strip(" ._-")
            ep = int(m.group("ep"))
            if series:
                return {"kind": "tutorial", "series_name": series, "episode": ep, "need_confirm": False, "rule": rule}
    # 父目录兜底：子目录内的文件归入目录系列，但集数存疑 → 确认队列
    rel = storage_key.split(":", 1)[1]
    parts = [p for p in rel.split("/") if p]
    parent = parts[-2] if len(parts) >= 2 else None
    if not parent:
        return {"kind": "clip", "need_confirm": False}
    # 课程/第N章 xx/01.mp4 三层结构：章节目录不当系列，向上卷积到课程（祖父目录），
    # 章号独立记录（video_details.chapter），集数尽量从文件名提取章内序号
    m = CHAPTER_RE.match(parent.strip())
    if m and len(parts) >= 3:
        ep = next((int(x.group("ep")) for rx in EP_ONLY_RULES if (x := rx.search(stem))), None)
        return {
            "kind": "tutorial", "series_name": parts[-3], "episode": ep,
            "chapter": int(m.group("cn") or m.group("cn2")), "chapter_title": parent,
            "need_confirm": ep is None, "rule": "chapter-dir",
        }
    return {"kind": "tutorial", "series_name": parent, "episode": None, "need_confirm": True, "rule": "parent-dir"}


async def upsert_series(db: AsyncSession, name: str) -> VideoSeries:
    row = (await db.execute(select(VideoSeries).where(VideoSeries.name == name))).scalar_one_or_none()
    if row is None:
        row = VideoSeries(name=name)
        db.add(row)
        await db.flush()
    return row
