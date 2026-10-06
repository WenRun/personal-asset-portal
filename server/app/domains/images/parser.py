"""图片入库解析（详细设计 §5.5）：Pillow 提取 EXIF → image_details；目录聚合相册；派生缩略图任务。"""

import datetime as dt
import posixpath

from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import Asset, ImageAlbum, ImageAlbumItem, ImageDetail
from app.core.pipeline import build_storage, register, roots_of
from app.core.registry import ext_of


def _exif_datetime(raw) -> dt.datetime | None:
    if not raw:
        return None
    try:
        return dt.datetime.strptime(str(raw).strip(), "%Y:%m:%d %H:%M:%S").replace(tzinfo=dt.timezone.utc)
    except ValueError:
        return None


def _rational(v) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _shutter(v) -> str | None:
    """ExposureTime rational → '1/500s' / '8s'。"""
    f = _rational(v)
    if not f or f <= 0:
        return None
    if f < 1:
        return f"1/{round(1 / f)}s"
    return f"{f:g}s"


def _aperture(v) -> float | None:
    f = _rational(v)
    return round(f, 1) if f else None


def _gps_decimal(gps: dict, lat_key: int, lat_ref_key: int, lon_key: int, lon_ref_key: int) -> tuple[float | None, float | None]:
    def dec(vals, ref):
        try:
            d = [float(x) for x in vals]
            v = d[0] + d[1] / 60 + d[2] / 3600
            if ref in ("S", "W"):
                v = -v
            return round(v, 6)
        except (TypeError, ValueError, KeyError, IndexError):
            return None
    return dec(gps.get(lat_key, ()), gps.get(lat_ref_key)), dec(gps.get(lon_key, ()), gps.get(lon_ref_key))


@register("parse:image")
async def parse_image(db: AsyncSession, payload: dict) -> None:
    asset = await db.get(Asset, payload["asset_id"])
    if asset is None:
        return

    storage = build_storage(await roots_of(db))
    path = storage.resolve(asset.storage_key)

    fields: dict = {}
    meta: dict = {"ext": ext_of(asset.file_name)}
    width = height = None
    try:
        img = Image.open(path)
        img.load()
        width, height = img.size
        exif = img.getexif()
        try:
            exif_ifd = exif.get_ifd(0x8769)
        except Exception:  # noqa: BLE001
            exif_ifd = {}
        try:
            gps_ifd = exif.get_ifd(0x8825)
        except Exception:  # noqa: BLE001
            gps_ifd = {}

        taken = _exif_datetime(exif_ifd.get(36867)) or _exif_datetime(exif.get(306))
        lat, lon = _gps_decimal(gps_ifd, 2, 1, 4, 3)
        fields = {
            "taken_at": taken,
            "camera_make": str(exif.get(271)) if exif.get(271) else None,
            "camera_model": str(exif.get(272)) if exif.get(272) else None,
            "lens": str(exif_ifd.get(42036)) if exif_ifd.get(42036) else None,
            "iso": int(exif_ifd[34855]) if exif_ifd.get(34855) else None,
            "aperture": _aperture(exif_ifd.get(33437)),
            "shutter": _shutter(exif_ifd.get(33434)),
            "focal_length_mm": _rational(exif_ifd.get(37386)),
            "gps_lat": lat,
            "gps_long": lon,
            "orientation": int(exif.get(274, 1)),
            "width": width,
            "height": height,
        }
    except Exception as exc:  # noqa: BLE001  非图片内容/损坏文件：照常入库但标记警告
        meta["parse_warning"] = f"{type(exc).__name__}: {exc}"

    asset.title = asset.title or asset.file_name.rsplit(".", 1)[0]
    asset.meta = {**asset.meta, **meta}
    asset.status = "ready"

    row = await db.get(ImageDetail, asset.id)
    if row is None:
        row = ImageDetail(asset_id=asset.id)
        db.add(row)
    for k, v in fields.items():
        setattr(row, k, v)

    # 目录相册：父目录自动聚合（详细设计 §5.5）
    rel = asset.storage_key.split(":", 1)[1]
    dir_path = posixpath.dirname(rel)
    album = (
        await db.execute(
            select(ImageAlbum).where(ImageAlbum.source == "directory", ImageAlbum.dir_path == dir_path)
        )
    ).scalar_one_or_none()
    if album is None:
        album = ImageAlbum(name=dir_path.split("/")[-1] or "未分组", source="directory", dir_path=dir_path)
        db.add(album)
        await db.flush()
    if await db.get(ImageAlbumItem, {"album_id": album.id, "asset_id": asset.id}) is None:
        db.add(ImageAlbumItem(album_id=album.id, asset_id=asset.id))

    await db.commit()
    from app.core.jobs import enqueue

    await enqueue(db, "index_meili", {"asset_id": str(asset.id)}, priority=8)
    await enqueue(db, "derive:thumb_image", {"asset_id": str(asset.id)}, priority=5)
