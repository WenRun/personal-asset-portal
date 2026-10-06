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


def recognize(file_name: str, storage_key: str, storage: LocalStorage) -> dict:
    """返回 {kind, series_name?, episode?, need_confirm, rule?}。"""
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
    parent = rel.split("/")[-2] if "/" in rel else None
    if parent:
        return {"kind": "tutorial", "series_name": parent, "episode": None, "need_confirm": True, "rule": "parent-dir"}
    return {"kind": "clip", "need_confirm": False}


async def upsert_series(db: AsyncSession, name: str) -> VideoSeries:
    row = (await db.execute(select(VideoSeries).where(VideoSeries.name == name))).scalar_one_or_none()
    if row is None:
        row = VideoSeries(name=name)
        db.add(row)
        await db.flush()
    return row
