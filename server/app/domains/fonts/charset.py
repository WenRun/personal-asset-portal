"""字符集派生（详细设计 §5.1）：cmap → charset.json（Unicode 区块覆盖率）。"""

import json
import os

from fontTools.ttLib import TTFont
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.models import Asset
from app.core.pipeline import build_storage, register, roots_of

# (名称, [区间))；M2 用 Unicode 区块，GB2312 精确清单留 M6
BLOCKS = [
    ("基本拉丁", [(0x41, 0x5B), (0x61, 0x7B)]),
    ("CJK 统一表意文字", [(0x4E00, 0xA000)]),
    ("平假名", [(0x3041, 0x3097)]),
    ("片假名", [(0x30A1, 0x3100)]),
    ("谚文音节", [(0xAC00, 0xD7A4)]),
]


@register("derive:font_charset")
async def derive_font_charset(db: AsyncSession, payload: dict) -> None:
    asset = await db.get(Asset, payload["asset_id"])
    if asset is None:
        return
    storage = build_storage(await roots_of(db))
    src = storage.resolve(asset.storage_key)

    font = TTFont(str(src), fontNumber=0, lazy=True)
    have = set(font.getBestCmap().keys())
    font.close()

    rows = []
    for name, ranges in BLOCKS:
        total = sum(b - a for a, b in ranges)
        hit = sum(1 for a, b in ranges for c in range(a, b) if c in have)
        rows.append({"name": name, "pct": round(100 * hit / total, 1) if total else 0.0})

    out_dir = get_settings().data_root / "derived" / "fonts" / str(asset.id)
    out_dir.mkdir(parents=True, exist_ok=True)
    tmp = out_dir / "charset.json.tmp"
    tmp.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, out_dir / "charset.json")
