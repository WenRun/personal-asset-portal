"""图片入库解析（详细设计 §5.5）：Pillow 提取 EXIF → image_details；目录聚合相册；派生缩略图任务。"""

import datetime as dt
import posixpath

from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import Asset, ImageAlbum, ImageAlbumItem, ImageDetail
from app.core.pipeline import build_storage, register, roots_of
from app.core.registry import ext_of
from app.domains.images import decoders  # noqa: F401  import 即注册 HEIC/AVIF 解码器


def _svg_dimensions(path) -> tuple[int | None, int | None]:
    """SVG 是矢量 XML，Pillow 打不开：从根节点 width/height（或 viewBox）取像素尺寸。"""
    import re
    import xml.etree.ElementTree as ET

    def px(v: str | None) -> int | None:
        if not v:
            return None
        m = re.match(r"([0-9.]+)\s*(px|pt|pc|mm|cm|in|em)?$", v.strip())
        return round(float(m.group(1))) if m else None

    try:
        root = ET.parse(path).getroot()
        w, h = px(root.get("width")), px(root.get("height"))
        if w and h:
            return w, h
        nums = [float(x) for x in (root.get("viewBox") or "").replace(",", " ").split()]
        if len(nums) == 4 and nums[2] > 0 and nums[3] > 0:
            return round(nums[2]), round(nums[3])
        return w, h
    except Exception:  # noqa: BLE001
        return None, None


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


def _raw_exif(path) -> dict:
    """相机 RAW 的 EXIF（exifread 读取；Pillow 打不开 RAW）。"""
    import exifread

    with open(path, "rb") as f:
        tags = exifread.process_file(f, details=False)

    def printable(*names: str) -> str | None:
        for n in names:
            if tags.get(n) is not None:
                v = str(tags[n].printable).strip()
                return v or None
        return None

    def _num(v) -> float | None:
        """exifread 的值可能是 Ratio(num/den)、单元素元组或裸数字，统一换算。"""
        try:
            if isinstance(v, tuple):
                v = v[0]
            if hasattr(v, "num") and getattr(v, "den", 1):
                return float(v.num) / float(v.den)
            return float(v)
        except (TypeError, ValueError, ZeroDivisionError, IndexError):
            return None

    def ratio(*names: str) -> float | None:
        for n in names:
            t = tags.get(n)
            if t and t.values:
                r = _num(t.values[0])
                if r is not None:
                    return r
        return None

    def gps_decimal(loc_name: str, ref_name: str) -> float | None:
        t = tags.get(loc_name)
        ref = (printable(ref_name) or "").upper()
        if t is None or ref not in ("N", "S", "E", "W") or len(t.values) != 3:
            return None
        d = [_num(v) for v in t.values]
        if any(x is None for x in d):
            return None
        dec = d[0] + d[1] / 60 + d[2] / 3600
        return round(-dec if ref in ("S", "W") else dec, 6)

    return {
        "taken_at": _exif_datetime(printable("EXIF DateTimeOriginal", "Image DateTime")),
        "camera_make": printable("Image Make"),
        "camera_model": printable("Image Model"),
        "lens": printable("EXIF LensModel"),
        "iso": int(ratio("EXIF ISOSpeedRatings") or 0) or None,
        "aperture": _aperture(ratio("EXIF FNumber")),
        "shutter": _shutter(ratio("EXIF ExposureTime")),
        "focal_length_mm": _rational(ratio("EXIF FocalLength")),
        "gps_lat": gps_decimal("GPS GPSLatitude", "GPS GPSLatitudeRef"),
        "gps_long": gps_decimal("GPS GPSLongitude", "GPS GPSLongitudeRef"),
        "orientation": int(ratio("Image Orientation") or 1),
    }


def _raw_preview_exif(path) -> dict:
    """CR3 等 ISO-BMFF 容器 exifread 读不到 EXIF：从内嵌 JPEG 预览的 EXIF 里补。"""
    import io

    import rawpy

    try:
        with rawpy.imread(str(path)) as raw:
            thumb = raw.extract_thumb()
        if thumb.format != rawpy.ThumbFormat.JPEG:
            return {}
        exif = Image.open(io.BytesIO(thumb.data)).getexif()
        exif_ifd = exif.get_ifd(0x8769)
        return {
            "taken_at": _exif_datetime(exif_ifd.get(36867)) or _exif_datetime(exif.get(306)),
            "camera_make": str(exif.get(271)) if exif.get(271) else None,
            "camera_model": str(exif.get(272)) if exif.get(272) else None,
        }
    except Exception:  # noqa: BLE001  无内嵌预览/损坏文件：放弃补充
        return {}


def _raw_fields(path) -> dict:
    """RAW 全量字段：EXIF + 尺寸（rawpy 读元数据，不解码像素，开销毫秒级）。"""
    import rawpy

    fields = _raw_exif(path)
    for k, v in _raw_preview_exif(path).items():
        if v and not fields.get(k):
            fields[k] = v
    with rawpy.imread(str(path)) as raw:
        fields["width"] = raw.sizes.width
        fields["height"] = raw.sizes.height
    return fields


def _ai_dimensions(path) -> tuple[int, int]:
    """AI 文件（PDF 兼容格式本质是 PDF）：首页页面尺寸即像素口径（72dpi）。"""
    import pymupdf

    with pymupdf.open(str(path)) as doc:
        rect = doc[0].rect
    return max(1, round(rect.width)), max(1, round(rect.height))


def suggest_image_category(camera_make: str | None, camera_model: str | None, width: int | None, height: int | None, ext: str) -> str:
    if camera_make or camera_model:
        return "摄影相片"
    if width and height:
        ratio = width / height if height > 0 else 0
        if width >= 1920 and height >= 1080 and (1.5 <= ratio <= 2.4):
            return "电脑壁纸"
        if height >= 1920 and width >= 1080 and (0.45 <= ratio <= 0.65):
            return "手机壁纸"
        if width <= 512 and height <= 512:
            return "图标表情"
    if ext.lower() in (".svg", ".ico", ".ai", ".psd"):
        return "设计矢量"
    return "插画图形"


@register("parse:image")
async def parse_image(db: AsyncSession, payload: dict) -> None:
    asset = await db.get(Asset, payload["asset_id"])
    if asset is None:
        return

    storage = build_storage(await roots_of(db))
    path = storage.resolve(asset.storage_key)

    ext = ext_of(asset.file_name)
    fields: dict = {}
    meta: dict = {"ext": ext}
    width = height = None
    if ext in decoders.RAW_EXTENSIONS:
        try:  # RAW：EXIF 走 exifread，尺寸走 rawpy 元数据
            fields = _raw_fields(path)
            width, height = fields["width"], fields["height"]
        except Exception as exc:  # noqa: BLE001
            meta["parse_warning"] = f"{type(exc).__name__}: {exc}"
    elif ext == ".ai":
        try:  # AI（PDF 兼容格式）：取首页尺寸
            width, height = _ai_dimensions(path)
            fields = {"width": width, "height": height}
        except Exception as exc:  # noqa: BLE001
            meta["parse_warning"] = f"{type(exc).__name__}: {exc}"
    else:
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
            if ext == ".svg":
                # SVG 无栅格数据，Pillow 打不开是预期行为：尺寸取到就不算警告
                width, height = _svg_dimensions(path)
                if width and height:
                    fields = {"width": width, "height": height}
            if not fields:
                meta["parse_warning"] = f"{type(exc).__name__}: {exc}"

    asset.title = asset.title or asset.file_name.rsplit(".", 1)[0]
    asset.meta = {**asset.meta, **meta}
    asset.status = "ready"
    if not asset.suggested_category:
        asset.suggested_category = suggest_image_category(
            fields.get("camera_make"),
            fields.get("camera_model"),
            width,
            height,
            ext_of(asset.file_name),
        )

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
