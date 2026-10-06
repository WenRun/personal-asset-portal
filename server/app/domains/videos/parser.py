"""视频入库解析（详细设计 §5.3）：ffprobe + 封面帧 + 系列识别 → video_series/video_details。"""

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import Asset, VideoDetail, VideoSeries
from app.core.pipeline import build_storage, register, roots_of
from app.core.registry import ext_of
from app.domains.videos.probe import extract_cover_frames, probe_video
from app.domains.videos.series import recognize, upsert_series


@register("parse:video")
async def parse_video(db: AsyncSession, payload: dict) -> None:
    asset = await db.get(Asset, payload["asset_id"])
    if asset is None:
        return

    storage = build_storage(await roots_of(db))
    path = storage.resolve(asset.storage_key)
    ext = ext_of(asset.file_name).lstrip(".")

    probed = probe_video(path)
    fields: dict = {"container": ext}
    meta: dict = {"ext": ext}
    fields.update(probed.get("fields", {}))
    meta.update(probed.get("meta", {}))

    rec = recognize(asset.file_name, asset.storage_key, storage)
    fields["kind"] = rec["kind"]
    meta["recognized_pattern"] = rec.get("rule")
    if rec.get("need_confirm"):
        meta["need_confirm"] = True

    series_id = None
    if rec.get("series_name"):
        srow = await upsert_series(db, rec["series_name"])
        series_id = srow.id
    fields["series_id"] = series_id
    fields["episode"] = rec.get("episode")

    asset.title = asset.title or asset.file_name.rsplit(".", 1)[0]
    asset.meta = {**asset.meta, **meta}
    asset.status = "ready"

    row = await db.get(VideoDetail, asset.id)
    if row is None:
        row = VideoDetail(asset_id=asset.id)
        db.add(row)
    for k, v in fields.items():
        setattr(row, k, v)

    await db.commit()
    from app.core.jobs import enqueue

    # 封面帧（Direct Play 与否都生成：浏览页需要）
    frames = extract_cover_frames(path, fields.get("duration_ms"), _derived_dir(str(asset.id)))
    if frames:
        row.cover_path = f"derived/videos/{asset.id}/cover_1.jpg"
        if series_id and rec["kind"] == "tutorial":
            # 系列封面：取集数最小的那一集的第一帧（已有则不覆盖）
            srow = await db.get(VideoSeries, series_id)
            if srow is not None and srow.cover_path is None:
                srow.cover_path = row.cover_path
        await db.commit()
    await enqueue(db, "index_meili", {"asset_id": str(asset.id)}, priority=8)


def _derived_dir(asset_id: str):
    from pathlib import Path

    from app.core.config import get_settings

    return Path(get_settings().data_root) / "derived" / "videos" / asset_id
