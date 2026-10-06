"""缩略图管线（详细设计 §5.5/§9）：thumb_256/1024/2560.webp，EXIF 方向预旋转，临时文件原子落盘。"""

import os

from PIL import Image, ImageOps
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.models import Asset
from app.core.pipeline import build_storage, register, roots_of

SIZES = (256, 1024, 2560)


def derived_dir(asset_id: str):
    return get_settings().data_root / "derived" / "images" / asset_id


@register("derive:thumb_image")
async def derive_thumb_image(db: AsyncSession, payload: dict) -> None:
    asset = await db.get(Asset, payload["asset_id"])
    if asset is None:
        return
    storage = build_storage(await roots_of(db))
    src = storage.resolve(asset.storage_key)

    img = Image.open(src)
    img.load()
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
