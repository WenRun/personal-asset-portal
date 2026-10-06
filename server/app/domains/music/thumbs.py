"""音乐封面派生（详细设计 §5.2）：内嵌封面 → cover.webp；专辑.cover_path 指向首个有封面的曲目。"""

import os

from PIL import Image, ImageOps
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import MusicAlbum
from app.core.pipeline import register


def derived_dir(asset_id: str):
    from pathlib import Path

    from app.core.config import get_settings

    return Path(get_settings().data_root) / "derived" / "music" / asset_id


@register("derive:music_cover")
async def derive_music_cover(db: AsyncSession, payload: dict) -> None:
    asset_id = str(payload["asset_id"])
    out_dir = derived_dir(asset_id)
    src = next((f for f in out_dir.glob("cover_src.*")), None) if out_dir.is_dir() else None
    if src is not None:
        img = Image.open(src)
        img.load()
        img = ImageOps.exif_transpose(img).convert("RGB")
        for size in (256, 1024):
            thumb = img.copy()
            thumb.thumbnail((size, size))
            tmp = out_dir / f"cover_{size}.webp.tmp"
            thumb.save(tmp, "WEBP", quality=85)
            os.replace(tmp, out_dir / f"cover_{size}.webp")

    # 专辑封面：指向首个已生成封面的曲目
    album = await db.get(MusicAlbum, payload["album_id"])
    if album is not None and album.cover_path is None:
        album.cover_path = f"derived/music/{asset_id}/cover_256.webp"
        await db.commit()
