"""样张派生（详细设计 §5.1）：Pillow 用该字体渲染 specimen.png（浏览页/搜索结果缩略图）。"""

import os
import tempfile

from PIL import Image, ImageDraw, ImageFont
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.models import Asset, Setting
from app.core.pipeline import build_storage, register, roots_of


@register("derive:font_specimen")
async def derive_font_specimen(db: AsyncSession, payload: dict) -> None:
    asset = await db.get(Asset, payload["asset_id"])
    if asset is None:
        return
    storage = build_storage(await roots_of(db))
    src = storage.resolve(asset.storage_key)

    kv = (await db.execute(select(Setting).where(Setting.key == "font_preview_text"))).scalar_one_or_none()
    text = (kv.value if kv else None) or "永东国爱 Aa Bb Xx 12345"

    out_dir = get_settings().data_root / "derived" / "fonts" / str(asset.id)
    out_dir.mkdir(parents=True, exist_ok=True)

    # FreeType 不直接吃 woff/woff2：先转临时 ttf
    ext = (asset.file_name.rsplit(".", 1)[-1] or "").lower()
    font_path = str(src)
    tmp_ref = None
    if ext in ("woff", "woff2"):
        from fontTools.ttLib import TTFont

        tmp_ref = tempfile.NamedTemporaryFile(suffix=".ttf", delete=False)
        TTFont(str(src)).save(tmp_ref.name)
        font_path = tmp_ref.name

    try:
        img = Image.new("RGB", (1024, 360), (248, 250, 252))
        draw = ImageDraw.Draw(img)
        font = ImageFont.truetype(font_path, 108)
        # 逐行自动缩字号，避免超宽被裁
        while draw.textlength(text, font=font) > 940 and font.size > 28:
            font = ImageFont.truetype(font_path, font.size - 8)
        draw.text((42, 110), text, font=font, fill=(30, 41, 59))
        small = ImageFont.truetype(font_path, 34)
        draw.text((44, 258), text[:24], font=small, fill=(100, 116, 139))
        tmp = out_dir / "specimen.png.tmp"
        img.save(tmp, "PNG")
        os.replace(tmp, out_dir / "specimen.png")
    finally:
        if tmp_ref is not None:
            os.unlink(tmp_ref.name)
