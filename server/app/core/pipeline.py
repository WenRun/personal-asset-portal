"""入库管道（详细设计 §4.2）：scan_root → fingerprint → parse:generic → index_meili 状态机。"""

import logging
import mimetypes

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import search as meili
from app.core.config import get_settings
from app.core.fingerprints import compute_fingerprint
from app.core.jobs import enqueue
from app.core.models import Asset, Setting
from app.core.registry import asset_type_of, ext_of, mime_of
from app.core.storage import LocalStorage

log = logging.getLogger("portal.pipeline")

# M0 通用解析器：标题=文件名主干；M1–M5 领域解析器按扩展名在此分流
HANDLERS: dict[str, object] = {}


def register(kind: str):
    def deco(fn):
        HANDLERS[kind] = fn
        return fn
    return deco


def build_storage(roots: dict[str, str]) -> LocalStorage:
    return LocalStorage(roots)


@register("scan_root")
async def scan_root(db: AsyncSession, payload: dict) -> None:
    """扫描资源根目录：新文件登记 pending；mtime/size 变化重指纹（详细设计 §4.2 发现）。"""
    alias = payload["root_alias"]
    roots = await roots_of(db)
    if alias not in roots:
        raise LookupError(f"未注册的资源根目录: {alias}")

    storage = build_storage(roots)
    existing = {
        a.storage_key: a
        for a in (
            await db.execute(select(Asset).where(Asset.storage_key.like(f"{alias}:%")))
        ).scalars().all()
    }
    new_files = 0
    for st in storage.iter_files(alias):
        if asset_type_of(st.name) is None:
            continue
        row = existing.get(st.key)
        if row is None:
            db.add(
                Asset(
                    asset_type=asset_type_of(st.name),
                    status="pending",
                    title=st.name.rsplit(".", 1)[0],
                    storage_key=st.key,
                    file_name=st.name,
                    size_bytes=st.size,
                    file_mtime=st.mtime_ns,
                    mime_type=mime_of(st.name),
                )
            )
            new_files += 1
            await enqueue(db, "fingerprint", {"storage_key": st.key}, priority=5)
        elif row.file_mtime != st.mtime_ns or row.size_bytes != st.size:
            row.file_mtime = st.mtime_ns
            row.size_bytes = st.size
            row.status = "pending"
            await enqueue(db, "fingerprint", {"asset_id": str(row.id)}, priority=5)
    await db.commit()
    log.info("scan_root %s: %d new files", alias, new_files)


@register("fingerprint")
async def fingerprint(db: AsyncSession, payload: dict) -> None:
    if "asset_id" in payload:
        asset = await db.get(Asset, payload["asset_id"])
    else:
        asset = (
            await db.execute(select(Asset).where(Asset.storage_key == payload["storage_key"]))
        ).scalar_one_or_none()
    if asset is None:
        return
    roots = await roots_of(db)
    storage = build_storage(roots)
    path = storage.resolve(asset.storage_key)
    st = path.stat()
    asset.fingerprint = compute_fingerprint(path, st.st_size, st.st_mtime_ns)
    asset.file_mtime = st.st_mtime_ns
    asset.size_bytes = st.st_size
    await enqueue(db, f"parse:{asset.asset_type}", {"asset_id": str(asset.id)}, priority=5)


@register("parse:video")
async def parse_generic(db: AsyncSession, payload: dict) -> None:
    """M0 通用解析：标题、mime、meta 扩展名；领域字段解析在 M1–M5 替换。"""
    asset = await db.get(Asset, payload["asset_id"])
    if asset is None:
        return
    asset.title = asset.title or asset.file_name.rsplit(".", 1)[0]
    asset.meta = {**asset.meta, "ext": ext_of(asset.file_name)}
    asset.mime_type = asset.mime_type or mime_of(asset.file_name)
    asset.status = "ready"
    await enqueue(db, "index_meili", {"asset_id": str(asset.id)}, priority=8)


@register("index_meili")
async def index_meili(db: AsyncSession, payload: dict) -> None:
    asset = await db.get(Asset, payload["asset_id"])
    if asset is None:
        return
    if asset.deleted_at is not None:
        await meili.delete_document(asset.asset_type, str(asset.id))
        return
    await meili.upsert_documents(asset.asset_type, [meili.doc_from_asset(asset)])


async def roots_of(db: AsyncSession) -> dict[str, str]:
    from app.core.models import Setting

    rows = (await db.execute(select(Setting))).scalars().all()
    scan_roots = next((r.value for r in rows if r.key == "scan_roots"), None)
    if scan_roots is None:
        scan_roots = [
            {"alias": a, "path": str(get_settings().data_root / "library" / a)}
            for a in ("fonts", "music", "videos", "books", "images", "uploads")
        ]
    return {r["alias"]: r["path"] for r in scan_roots}
