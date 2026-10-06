"""打包下载 worker（详细设计 §8/§4.4）：按 asset_ids 或 filters 打 zip → derived/packs/{id}.zip。"""

import os
import zipfile
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.models import Asset, DownloadPack
from app.core.pipeline import build_storage, register, roots_of


@register("pack_zip")
async def pack_zip(db: AsyncSession, payload: dict) -> None:
    pack = await db.get(DownloadPack, payload["pack_id"])
    if pack is None:
        return

    params = pack.params or {}
    if params.get("asset_ids"):
        rows = (
            await db.execute(
                select(Asset).where(Asset.id.in_([__import__("uuid").UUID(i) for i in params["asset_ids"]]), Asset.deleted_at.is_(None))
            )
        ).scalars().all()
    else:
        cond = [Asset.asset_type == params.get("type", "image"), Asset.deleted_at.is_(None)]
        if params.get("favorite"):
            cond.append(Asset.is_favorite.is_(True))
        rows = (await db.execute(select(Asset).where(*cond).limit(500))).scalars().all()

    if not rows:
        pack.status = "failed"
        pack.error = "没有符合条件的资产"
        await db.commit()
        return

    storage = build_storage(await roots_of(db))
    out_dir = Path(get_settings().data_root) / "derived" / "packs"
    out_dir.mkdir(parents=True, exist_ok=True)
    final = out_dir / f"{pack.id}.zip"
    tmp = out_dir / f".{pack.id}.tmp.zip"

    count = 0
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as zf:
        used = set()
        for a in rows:
            src = storage.resolve(a.storage_key)
            arc = a.file_name
            base, ext = os.path.splitext(arc)
            n = 2
            while arc in used:
                arc = f"{base}({n}){ext}"
                n += 1
            used.add(arc)
            zf.write(src, arc)
            count += 1
    os.replace(tmp, final)

    pack.status = "done"
    pack.file_path = f"derived/packs/{pack.id}.zip"
    pack.size_bytes = final.stat().st_size
    pack.file_count = count
    await db.commit()
