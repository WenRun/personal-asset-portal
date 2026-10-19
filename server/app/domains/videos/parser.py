"""视频入库解析（详细设计 §5.3）：ffprobe + 封面帧 + 系列识别 → video_series/video_details。"""

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import Asset, VideoDetail, VideoSeries
from app.core.pipeline import build_storage, register, roots_of
from app.core.registry import ext_of
from app.domains.videos.probe import extract_cover_frames, probe_video
from app.domains.videos.series import recognize, upsert_series


def suggest_video_category(kind: str, title: str, series_name: str | None = None) -> str:
    comb = f"{title} {series_name or ''}".lower()
    if kind == "tutorial" or series_name:
        if any(k in comb for k in ("开发", "编程", "python", "java", "vue", "react", "前端", "后端", "算法", "代码")):
            return "编程技术教程"
        if any(k in comb for k in ("剪辑", "pr", "ae", "ps", "摄影", "达芬奇", "调色")):
            return "影视设计教程"
        return "教程系列"
    if any(k in comb for k in ("空镜", "绿幕", "转场", "特效", "bgm", "片头", "片尾", "音效", "素材")):
        return "剪辑素材"
    if any(k in comb for k in ("movie", "电影", "纪录片", "剧场版", "短片")):
        return "影视片段"
    return "素材片段"


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
    # 章节字段随每次解析重置：目录结构调整后重扫描能正确收敛
    fields["chapter"] = rec.get("chapter")
    if rec.get("chapter_title"):
        meta["chapter_title"] = rec["chapter_title"]
    else:
        meta.pop("chapter_title", None)
    if rec.get("need_confirm"):
        meta["need_confirm"] = True
    else:
        meta.pop("need_confirm", None)

    series_id = None
    if rec.get("series_name"):
        srow = await upsert_series(db, rec["series_name"])
        series_id = srow.id
    fields["series_id"] = series_id
    fields["episode"] = rec.get("episode")

    asset.title = asset.title or asset.file_name.rsplit(".", 1)[0]
    asset.meta = {**asset.meta, **meta}
    asset.status = "ready"
    if not asset.suggested_category:
        asset.suggested_category = suggest_video_category(fields.get("kind", "clip"), asset.title, rec.get("series_name"))

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
