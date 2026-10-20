"""入库管道（详细设计 §4.2）：scan_root → fingerprint → parse:generic → index_meili 状态机。"""

import logging
import mimetypes
import os
import shutil
from datetime import datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import search as meili
from app.core.config import get_settings
from app.core.deps import get_app_settings
from app.core.fingerprints import compute_fingerprint
from app.core.jobs import enqueue
from app.core.models import Asset, AssetTag, Setting, Tag
from app.core.registry import ASSET_TYPES, asset_type_of, ext_of, mime_of
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


def cleanup_derived(asset_id, data_root) -> int:
    """删除资产名下的派生物目录（derived/<分类>/<asset_id>），返回清理数。
    资产进入软删态时调用（页面删除与扫描对账两条路径共用），防止孤儿派生物累积。
    音乐专辑封面按专辑 ID 存放，不在此范围（专辑维度，量级极小）。"""
    derived = Path(data_root) / "derived"
    removed = 0
    if not derived.is_dir():
        return removed
    for category in derived.iterdir():
        target = category / str(asset_id)
        if target.is_dir():
            shutil.rmtree(target, ignore_errors=True)
            removed += 1
    return removed


def category_from_key(key: str) -> str | None:
    """从 storage_key ("alias:rel_path") 提取多级父目录作为初始分类。
    若在根目录（无子文件夹）或虚拟分轨键（如 cue:）则返回 None。"""
    if not key or key.startswith("cue:") or ":" not in key:
        return None
    _, rel = key.split(":", 1)
    parts = [p for p in rel.split("/") if p]
    if len(parts) > 1:
        return "/".join(parts[:-1])
    return None


@register("scan_root")
async def scan_root(db: AsyncSession, payload: dict) -> None:
    """扫描资源根目录：新文件登记 pending；mtime/size 变化重指纹；
    库内有、盘上没有（或不在类型白名单内）的记录自动软删（对账，可恢复）——文件被删除/移动/改名/排除后重扫即同步；
    对账安全阀：根目录缺失/不可读时跳过（疑似挂载丢失，防误删全库）；目录存在但被清空则照常对账。"""
    alias = payload["root_alias"]
    settings_kv = await get_app_settings(db)
    scan_roots = settings_kv.get("scan_roots", [])
    root_cfg = next((r for r in scan_roots if r.get("alias") == alias), None)
    if root_cfg is None:
        raise LookupError(f"未注册的资源根目录: {alias}")

    allowed_types = set(root_cfg.get("types") or ASSET_TYPES)
    roots = {r["alias"]: r["path"] for r in scan_roots}
    # 对账前置检查（须在 build_storage 之前：后者会对缺失根目录自动 mkdir）：目录存在且可列出
    # 内容才允许「盘上没有即软删」；目录缺失/不可读多为挂载丢失或路径配错，据此跳过对账防误删。
    try:
        os.listdir(Path(root_cfg["path"]).expanduser())
        root_readable = True
    except OSError:
        root_readable = False
    storage = build_storage(roots)
    existing = {
        a.storage_key: a
        for a in (
            await db.execute(select(Asset).where(Asset.storage_key.like(f"{alias}:%")))
        ).scalars().all()
    }
    seen: set[str] = set()
    new_files = 0
    for st in storage.iter_files(alias):
        atype = asset_type_of(st.name)
        if atype is None or atype not in allowed_types:
            continue
        seen.add(st.key)
        row = existing.get(st.key)
        if row is None:
            db.add(
                Asset(
                    asset_type=atype,
                    status="pending",
                    title=st.name.rsplit(".", 1)[0],
                    storage_key=st.key,
                    file_name=st.name,
                    size_bytes=st.size,
                    file_mtime=st.mtime_ns,
                    mime_type=mime_of(st.name),
                    category=category_from_key(st.key),
                )
            )
            new_files += 1
            await enqueue(db, "fingerprint", {"storage_key": st.key}, priority=5)
        elif row.deleted_at is not None:
            row.deleted_at = None
            row.file_mtime = st.mtime_ns
            row.size_bytes = st.size
            row.status = "pending"
            if row.category is None:
                row.category = category_from_key(st.key)
            await enqueue(db, "fingerprint", {"asset_id": str(row.id)}, priority=5)
        elif row.file_mtime != st.mtime_ns or row.size_bytes != st.size:
            row.file_mtime = st.mtime_ns
            row.size_bytes = st.size
            row.status = "pending"
            await enqueue(db, "fingerprint", {"asset_id": str(row.id)}, priority=5)

    # 对账（安全阀）：根目录缺失/不可读（疑似挂载丢失、路径配错）时跳过——绝不能据此把整个库
    # 软删；目录真实存在（哪怕被用户清空）则照常对账，盘上没有的记录自动软删（可恢复）。
    alive = [a for a in existing.values() if a.deleted_at is None]
    missing = [a for a in alive if a.storage_key not in seen]
    if missing and not root_readable:
        log.warning("scan_root %s: 根目录缺失或不可读，库内 %d 条存活记录保持原样，跳过对账（疑似挂载丢失）", alias, len(alive))
        missing = []
    cleaned = 0
    for a in missing:
        a.deleted_at = datetime.now().astimezone()
        cleaned += cleanup_derived(a.id, get_settings().data_root)
        await enqueue(db, "index_meili", {"asset_id": str(a.id)}, priority=8)
    await db.commit()
    log.info(
        "scan_root %s: %d new files, %d missing -> soft-deleted (%d derived dirs cleaned)",
        alias, new_files, len(missing), cleaned,
    )


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
    tag_names = (
        await db.execute(
            select(Tag.name).join(AssetTag, AssetTag.tag_id == Tag.id)
            .where(AssetTag.asset_id == asset.id).order_by(Tag.name)
        )
    ).scalars().all()
    await meili.upsert_documents(asset.asset_type, [meili.doc_from_asset(asset, list(tag_names))])


async def roots_of(db: AsyncSession) -> dict[str, str]:
    settings_kv = await get_app_settings(db)
    return {r["alias"]: r["path"] for r in settings_kv.get("scan_roots", [])}
