"""字体入库解析（详细设计 §5.1）：fontTools 读 name/OS/2/cmap/fvar → font_details。"""

import asyncio

from fontTools.ttLib import TTFont
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import Asset, FontDetail
from app.core.pipeline import build_storage, register, roots_of
from app.core.registry import ext_of

# 语言覆盖探测：命中任一样本即认定覆盖（M6 可细化为区块占比）
LANG_SAMPLES = {
    "拉丁": (0x41, 0x7A),
    "简体中文": (0x4E2D, 0x6587, 0x6C38),
    "日文": (0x3042, 0x30A2),
    "韩文": (0xAC00, 0xD55C),
}


def _detect_languages(cmap_keys: set[int]) -> list[str]:
    out = []
    for label, samples in LANG_SAMPLES.items():
        if any(c in cmap_keys for c in samples):
            out.append(label)
    return out or ["未知"]


@register("parse:font")
async def parse_font(db: AsyncSession, payload: dict) -> None:
    asset = await db.get(Asset, payload["asset_id"])
    if asset is None:
        return

    storage = build_storage(await roots_of(db))
    path = storage.resolve(asset.storage_key)
    ext = ext_of(asset.file_name)

    fields: dict = {}
    meta: dict = {"ext": ext}
    try:
        # ttc 取第一个字体；woff/woff2 由 fontTools 直接支持（woff2 需 brotli）
        font = TTFont(str(path), fontNumber=0, lazy=True)
        name = font["name"]
        family = name.getDebugName(16) or name.getDebugName(1) or asset.title
        style = name.getDebugName(17) or name.getDebugName(2)
        os2 = font.get("OS/2")
        weight = int(os2.usWeightClass) if os2 else 400
        italic = bool(os2.fsSelection & 0x01) if os2 else ("Italic" in (style or ""))
        is_variable = "fvar" in font
        axes = (
            [{"tag": a.axisTag, "min": a.minValue, "def": a.defaultValue, "max": a.maxValue} for a in font["fvar"].axes]
            if is_variable else []
        )
        glyph_count = int(font["maxp"].numGlyphs)
        cmap_keys = set(font.getBestCmap().keys())
        version = (name.getDebugName(5) or "").replace("Version ", "").strip()
        designer = (name.getDebugName(9) or "").strip()
        license_text = " ".join((name.getDebugName(13) or "").split())[:120]

        fields = {
            "family": family,
            "style": style,
            "weight": weight,
            "italic": italic,
            "is_variable": is_variable,
            "formats": [ext.upper().lstrip(".")],
            "glyph_count": glyph_count,
            "languages": _detect_languages(cmap_keys),
            "license": license_text or None,
            "version": version or None,
            "designer": designer or None,
        }
        meta["units_per_em"] = int(font["head"].unitsPerEm)
        meta["variable_axes"] = axes
        font.close()
    except Exception as exc:  # noqa: BLE001  损坏字体：照常入库但标记警告
        meta["parse_warning"] = f"{type(exc).__name__}: {exc}"
        fields = {"family": asset.title, "weight": 400, "formats": [ext.upper().lstrip(".")]}

    asset.title = asset.title or asset.file_name.rsplit(".", 1)[0]
    asset.meta = {**asset.meta, **meta}
    asset.status = "ready"

    row = await db.get(FontDetail, asset.id)
    if row is None:
        row = FontDetail(asset_id=asset.id)
        db.add(row)
    for k, v in fields.items():
        setattr(row, k, v)

    await db.commit()
    from app.core.jobs import enqueue

    await enqueue(db, "index_meili", {"asset_id": str(asset.id)}, priority=8)
    await enqueue(db, "derive:font_specimen", {"asset_id": str(asset.id)}, priority=5)
    await enqueue(db, "derive:font_charset", {"asset_id": str(asset.id)}, priority=5)
