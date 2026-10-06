"""封面派生（详细设计 §5.4/§9）：cover_src.* → cover_256/1024.webp（两级）。"""

import os

from PIL import Image, ImageOps
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import Asset
from app.core.pipeline import register


@register("derive:book_cover")
async def derive_book_cover(db: AsyncSession, payload: dict) -> None:
    asset = await db.get(Asset, payload["asset_id"])
    if asset is None:
        return
    from app.domains.books.parser import derived_dir

    out_dir = derived_dir(str(asset.id))
    src = next((f for f in out_dir.glob("cover_src.*")), None) if out_dir.is_dir() else None
    if src is None:
        return  # 无封面（mobi 兜底等），任务正常结束

    img = Image.open(src)
    img.load()
    img = ImageOps.exif_transpose(img).convert("RGB")
    for size in (256, 1024):
        thumb = img.copy()
        thumb.thumbnail((size, size))
        tmp = out_dir / f"cover_{size}.webp.tmp"
        thumb.save(tmp, "WEBP", quality=85)
        os.replace(tmp, out_dir / f"cover_{size}.webp")
