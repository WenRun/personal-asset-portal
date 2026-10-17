"""缩略图管线（详细设计 §5.5/§9）：thumb_256/1024/2560.webp，EXIF 方向预旋转，临时文件原子落盘。"""

import os

from PIL import Image, ImageOps
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.models import Asset
from app.core.pipeline import build_storage, register, roots_of
from app.core.registry import ext_of
from app.domains.images import decoders  # noqa: F401  import 即注册 HEIC/AVIF 解码器

SIZES = (256, 1024, 2560)


def _load_source(src, ext: str) -> Image.Image:
    """各格式统一出 PIL 图。RAW 优先取相机内嵌 JPEG 预览（快、已是相机渲染效果），
    无内嵌预览时退回完整解码；AI（PDF 兼容）用 PyMuPDF 渲染首页；其余交给 Pillow。"""
    if ext in decoders.RAW_EXTENSIONS:
        import io

        import rawpy

        with rawpy.imread(str(src)) as raw:
            try:
                thumb = raw.extract_thumb()
                if thumb.format == rawpy.ThumbFormat.JPEG:
                    img = Image.open(io.BytesIO(thumb.data))
                    img.load()
                    return img
            except Exception:  # noqa: BLE001  无内嵌预览/非 JPEG：走完整解码
                pass
            rgb = raw.postprocess(use_camera_wb=True)
        return Image.fromarray(rgb)
    if ext == ".ai":
        import pymupdf

        with pymupdf.open(str(src)) as doc:
            page = doc[0]
            z = min(2560 / max(page.rect.width, page.rect.height), 16)
            pix = page.get_pixmap(matrix=pymupdf.Matrix(z, z), alpha=False)
        return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    img = Image.open(src)
    img.load()
    return img


def derived_dir(asset_id: str):
    return get_settings().data_root / "derived" / "images" / asset_id


@register("derive:thumb_image")
async def derive_thumb_image(db: AsyncSession, payload: dict) -> None:
    asset = await db.get(Asset, payload["asset_id"])
    if asset is None:
        return
    storage = build_storage(await roots_of(db))
    src = storage.resolve(asset.storage_key)

    if ext_of(asset.file_name) == ".svg":
        return  # 矢量图不做栅格缩略图，缩略图端点直接回退原图（SVG 无级缩放）

    img = _load_source(src, ext_of(asset.file_name))
    img = ImageOps.exif_transpose(img)  # 按 orientation 摆正

    out_dir = derived_dir(str(asset.id))
    out_dir.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        thumb = img.copy()
        thumb.thumbnail((size, size))
        target = out_dir / f"thumb_{size}.webp"
        tmp = out_dir / f"thumb_{size}.webp.tmp"
        thumb.save(tmp, "WEBP", quality=82)
        os.replace(tmp, target)  # 原子改名，重试安全
