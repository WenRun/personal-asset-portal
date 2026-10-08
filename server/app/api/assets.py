"""资产路由（详细设计 §6.2/§6.3）：浏览列表（公开）、详情/下载（member）、编辑/删除/标签（admin）。"""

import base64
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Path, Query, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_app_settings, get_current_user, require_admin, require_member
from app.core.db import get_db
from app.core.errors import bad_request, forbidden, not_found, unauthenticated
from app.core.jobs import enqueue
from app.core.models import Asset, AssetTag, BookDetail, FontDetail, ImageDetail, Job, MusicTrack, Tag, User, VideoDetail
from app.core.registry import ROUTE_TO_TYPE, asset_type_of, ext_of
from app.core.search import delete_document
from app.core.storage import LocalStorage

router = APIRouter(prefix="/api", tags=["资产"])


# ---------- 汇总统计 / 最近入库（公开：仪表盘与侧栏用；需在 /{route} 之前声明） ----------

@router.get("/stats", summary="仪表盘统计",
            description="公开。返回五类资产计数（未删除）与任务状态汇总（排队 / 运行 / 失败 / 今日完成）。")
async def stats(db: AsyncSession = Depends(get_db)):
    type_counts = dict(
        (await db.execute(
            select(Asset.asset_type, func.count()).where(Asset.deleted_at.is_(None)).group_by(Asset.asset_type)
        )).all()
    )
    job_status = dict(
        (await db.execute(select(Job.status, func.count()).group_by(Job.status))).all()
    )
    done_today = (
        await db.execute(
            select(func.count()).select_from(Job).where(
                Job.status == "done",
                Job.finished_at.isnot(None),
                func.date(Job.finished_at) == func.current_date(),
            )
        )
    ).scalar_one()
    return {
        "counts": {t: type_counts.get(t, 0) for t in ("font", "music", "video", "book", "image")},
        "jobs": {
            "queued": job_status.get("queued", 0),
            "running": job_status.get("running", 0),
            "failed": job_status.get("failed", 0),
            "done_today": done_today,
        },
    }


@router.get("/recent", summary="最近入库",
            description="公开。按入库时间倒序返回最近的资产卡片（仪表盘与侧栏用）。")
async def recent(limit: int = Query(12, description="返回条数，默认 12（上限 50，超出自动截断）"),
                 db: AsyncSession = Depends(get_db)):
    rows = (
        await db.execute(
            select(Asset).where(Asset.deleted_at.is_(None))
            .order_by(Asset.created_at.desc(), Asset.id.desc())
            .limit(max(1, min(limit, 50)))
        )
    ).scalars().all()
    return [_item(a) for a in rows]


def _cursor_encode(created_at: datetime, id_: uuid.UUID) -> str:
    raw = f"{created_at.isoformat()}|{id_}".encode()
    return base64.urlsafe_b64encode(raw).decode()


def _cursor_decode(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode()).decode()
        ts, id_ = raw.split("|", 1)
        return datetime.fromisoformat(ts), uuid.UUID(id_)
    except Exception as exc:  # noqa: BLE001
        raise bad_request("非法游标") from exc


def _item(a: Asset) -> dict:
    return {
        "id": str(a.id), "type": a.asset_type, "status": a.status,
        "title": a.title, "file_name": a.file_name, "size_bytes": a.size_bytes,
        "mime_type": a.mime_type, "rating": a.rating, "is_favorite": a.is_favorite,
        "note": a.note, "created_at": a.created_at.isoformat(),
    }


async def _storage(db: AsyncSession) -> LocalStorage:
    kv = await get_app_settings(db)
    return LocalStorage({r["alias"]: r["path"] for r in kv["scan_roots"]})


# ---------- 浏览（公开；访客禁止携带 q —— §6.2/§6.4） ----------

@router.get("/{route}", summary="按类型浏览资产列表",
            description="公开。游标分页（按入库时间倒序），返回对应类型资产并附带类型专属字段；游客不可搜索（携带 q 时返回 401）。")
async def list_assets(
    route: str = Path(description="资产类型路由：fonts / music / videos / books / images"),
    cursor: str | None = Query(None, description="分页游标，取自上一页返回的 next_cursor"),
    page_size: int = Query(60, description="每页条数，默认 60（上限 200，超出自动截断）"),
    q: str | None = Query(None, description="关键词，模糊匹配标题 / 文件名；游客不可用"),
    tag: str | None = Query(None, description="按标签名精确过滤"),
    favorite: bool | None = Query(None, description="仅看收藏"),
    user: User | None = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if route not in ROUTE_TO_TYPE:
        raise not_found()
    if q is not None and q.strip() and user is None:
        raise unauthenticated("访客不可搜索，请先登录")
    page_size = max(1, min(page_size, 200))
    cond = [Asset.asset_type == ROUTE_TO_TYPE[route], Asset.deleted_at.is_(None)]
    if favorite:
        cond.append(Asset.is_favorite.is_(True))
    if tag is not None and tag.strip():
        cond.append(Asset.id.in_(
            select(AssetTag.asset_id).join(Tag, Tag.id == AssetTag.tag_id).where(Tag.name == tag.strip())
        ))
    if q is not None and q.strip():
        pat = f"%{q.strip()}%"
        cond.append(Asset.title.ilike(pat) | Asset.file_name.ilike(pat))
    if cursor:
        ts, id_ = _cursor_decode(cursor)
        cond.append(tuple_(Asset.created_at, Asset.id) < tuple_(ts, id_))
    rows = (
        await db.execute(
            select(Asset).where(*cond).order_by(Asset.created_at.desc(), Asset.id.desc()).limit(page_size + 1)
        )
    ).scalars().all()
    next_cursor = None
    if len(rows) > page_size:
        rows = rows[:page_size]
        last = rows[-1]
        next_cursor = _cursor_encode(last.created_at, last.id)
    items = [_item(a) for a in rows]
    if rows:
        # 批量补标签（列表页标签筛选/展示用；一次查询避免 N+1）
        tag_rows = (
            await db.execute(
                select(AssetTag.asset_id, Tag.id, Tag.name)
                .join(Tag, Tag.id == AssetTag.tag_id)
                .where(AssetTag.asset_id.in_([a.id for a in rows]))
                .order_by(Tag.name)
            )
        ).all()
        tags_map: dict[uuid.UUID, list[dict]] = {}
        for aid, tid, tname in tag_rows:
            tags_map.setdefault(aid, []).append({"id": str(tid), "name": tname})
        for it, a in zip(items, rows):
            it["tags"] = tags_map.get(a.id, [])
    if route == "fonts" and rows:
        details = (
            await db.execute(select(FontDetail).where(FontDetail.asset_id.in_([a.id for a in rows])))
        ).scalars().all()
        dmap = {d.asset_id: d for d in details}
        for it, a in zip(items, rows):
            d = dmap.get(a.id)
            if d is not None:
                it.update({
                    "family": d.family, "style": d.style, "weight": d.weight,
                    "italic": d.italic, "is_variable": d.is_variable, "formats": d.formats,
                    "glyph_count": d.glyph_count, "languages": d.languages,
                    "license": d.license, "version": d.version, "designer": d.designer,
                })
    if route == "videos" and rows:
        details = (
            await db.execute(select(VideoDetail).where(VideoDetail.asset_id.in_([a.id for a in rows])))
        ).scalars().all()
        dmap = {d.asset_id: d for d in details}
        for it, a in zip(items, rows):
            d = dmap.get(a.id)
            if d is not None:
                it.update({
                    "kind": d.kind, "series_id": str(d.series_id) if d.series_id else None,
                    "episode": d.episode, "duration_sec": int((d.duration_ms or 0) / 1000),
                    "resolution": f"{d.width}x{d.height}" if d.width else None,
                    "container": d.container, "video_codec": d.video_codec, "audio_codec": d.audio_codec,
                    "streamable": d.streamable,
                    "cover_url": f"/api/videos/cover/{d.cover_path}" if d.cover_path else None,
                })
    if route == "music" and rows:
        details = (
            await db.execute(select(MusicTrack).where(MusicTrack.asset_id.in_([a.id for a in rows])))
        ).scalars().all()
        dmap = {d.asset_id: d for d in details}
        for it, a in zip(items, rows):
            d = dmap.get(a.id)
            if d is not None:
                it.update({
                    "duration_sec": int((d.duration_ms or 0) / 1000), "format": d.format,
                    "bitrate_kbps": d.bitrate_kbps, "has_lyrics": d.has_lyrics,
                    "streamable": d.streamable,
                })
    if route == "books" and rows:
        details = (
            await db.execute(select(BookDetail).where(BookDetail.asset_id.in_([a.id for a in rows])))
        ).scalars().all()
        dmap = {d.asset_id: d for d in details}
        for it, a in zip(items, rows):
            d = dmap.get(a.id)
            if d is not None:
                it.update({
                    "authors": d.authors, "publisher": d.publisher, "pub_year": d.pub_year,
                    "isbn": d.isbn, "series_name": d.series_name, "series_index": d.series_index,
                    "language": d.language, "format": d.format, "pages": d.pages,
                })
    if route == "images" and rows:
        details = (
            await db.execute(select(ImageDetail).where(ImageDetail.asset_id.in_([a.id for a in rows])))
        ).scalars().all()
        dmap = {d.asset_id: d for d in details}
        for it, a in zip(items, rows):
            d = dmap.get(a.id)
            if d is not None:
                it.update({
                    "taken_at": d.taken_at.isoformat() if d.taken_at else None,
                    "camera": " ".join(x for x in (d.camera_make, d.camera_model) if x) or None,
                    "width": d.width, "height": d.height,
                })
    return {"items": items, "next_cursor": next_cursor}


# ---------- 详情（member） ----------

@router.get("/assets/{asset_id}", summary="资产详情",
            description="登录用户。返回基础信息、标签与类型专属元数据（视频 / 书籍 / 字体 / 图片各自的详情字段）。")
async def asset_detail(asset_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                       user: User = Depends(require_member)):
    a = await db.get(Asset, asset_id)
    if a is None or a.deleted_at is not None:
        raise not_found()
    tags = (
        await db.execute(select(Tag).join(AssetTag, AssetTag.tag_id == Tag.id).where(AssetTag.asset_id == a.id))
    ).scalars().all()
    out = {**_item(a), "meta": a.meta, "fingerprint": a.fingerprint, "storage_key": a.storage_key,
           "tags": [{"id": str(t.id), "name": t.name} for t in tags]}
    if a.asset_type == "video":
        d = await db.get(VideoDetail, a.id)
        if d is not None:
            out.update({
                "kind": d.kind, "series_id": str(d.series_id) if d.series_id else None,
                "episode": d.episode, "duration_sec": int((d.duration_ms or 0) / 1000),
                "resolution": f"{d.width}x{d.height}" if d.width else None,
                "container": d.container, "video_codec": d.video_codec, "audio_codec": d.audio_codec,
                "streamable": d.streamable,
                "cover_url": f"/api/videos/cover/{d.cover_path}" if d.cover_path else None,
            })
    if a.asset_type == "book":
        d = await db.get(BookDetail, a.id)
        if d is not None:
            out.update({
                "authors": d.authors, "publisher": d.publisher, "pub_year": d.pub_year,
                "isbn": d.isbn, "series_name": d.series_name, "series_index": d.series_index,
                "language": d.language, "format": d.format, "pages": d.pages,
            })
    if a.asset_type == "font":
        d = await db.get(FontDetail, a.id)
        if d is not None:
            out.update({
                "family": d.family, "style": d.style, "weight": d.weight,
                "italic": d.italic, "is_variable": d.is_variable, "formats": d.formats,
                "glyph_count": d.glyph_count, "languages": d.languages,
                "license": d.license, "version": d.version, "designer": d.designer,
            })
    if a.asset_type == "image":
        d = await db.get(ImageDetail, a.id)
        if d is not None:
            out.update({
                "taken_at": d.taken_at.isoformat() if d.taken_at else None,
                "camera": " ".join(x for x in (d.camera_make, d.camera_model) if x) or None,
                "camera_make": d.camera_make, "camera_model": d.camera_model, "lens": d.lens,
                "iso": d.iso, "aperture": d.aperture, "shutter": d.shutter,
                "focal_length_mm": d.focal_length_mm, "gps_lat": d.gps_lat, "gps_long": d.gps_long,
                "width": d.width, "height": d.height,
            })
    return out


# ---------- 下载（member；不暴露真实路径） ----------

@router.get("/assets/{asset_id}/download", summary="下载资产文件",
            description="登录用户。以附件形式返回原文件，不暴露服务器真实路径。")
async def download(asset_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                   user: User = Depends(require_member)):
    a = await db.get(Asset, asset_id)
    if a is None or a.deleted_at is not None:
        raise not_found()
    storage = await _storage(db)
    path = storage.resolve(a.storage_key)
    return FileResponse(path, filename=a.file_name, media_type=a.mime_type or "application/octet-stream")


# ---------- 编辑 / 删除 / 恢复（admin） ----------

class AssetPatch(BaseModel):
    title: str | None = Field(default=None, max_length=256)
    note: str | None = None
    rating: int | None = Field(default=None, ge=0, le=5)
    is_favorite: bool | None = None
    tags: list[str] | None = None


async def _reindex(db: AsyncSession, a: Asset) -> None:
    await enqueue(db, "index_meili", {"asset_id": str(a.id)}, priority=8)


@router.patch("/assets/{asset_id}", summary="编辑资产元信息",
              description="管理员或登录成员。可修改标题 / 备注 / 评分（0-5）/ 标签 / 收藏标记，仅传入的字段生效；改动后异步重建搜索索引。")
async def patch_asset(asset_id: uuid.UUID, body: AssetPatch, db: AsyncSession = Depends(get_db),
                      user: User = Depends(require_member)):
    a = await db.get(Asset, asset_id)
    if a is None or a.deleted_at is not None:
        raise not_found()
    # 非管理员仅允许修改评分与收藏标记
    if user.role != "admin" and (body.title is not None or body.note is not None or body.tags is not None):
        raise forbidden()
    for field in ("title", "note", "rating", "is_favorite"):
        val = getattr(body, field)
        if val is not None:
            setattr(a, field, val)
    if body.tags is not None:
        # 重置资产关联标签
        await db.execute(delete(AssetTag).where(AssetTag.asset_id == a.id))
        cleaned = [t.strip() for t in body.tags if t.strip()]
        for name in cleaned:
            t = (await db.execute(select(Tag).where(Tag.name == name))).scalar_one_or_none()
            if t is None:
                t = Tag(name=name)
                db.add(t)
                await db.flush()
            db.add(AssetTag(asset_id=a.id, tag_id=t.id))
    await db.commit()
    await _reindex(db, a)
    tags = (
        await db.execute(select(Tag).join(AssetTag, AssetTag.tag_id == Tag.id).where(AssetTag.asset_id == a.id))
    ).scalars().all()
    return {**_item(a), "tags": [{"id": str(t.id), "name": t.name} for t in tags]}


@router.delete("/assets/{asset_id}", summary="删除资产",
               description="管理员。默认软删（可恢复）；purge=true 彻底删除记录并移出搜索索引，delete_file=true 连同源文件一起删除（仅与 purge 同时生效）。两种删除都会同步清理该资产的派生物（缩略图/封面/样张等）。")
async def delete_asset(asset_id: uuid.UUID, purge: bool = Query(False, description="是否彻底删除（默认软删）"),
                       delete_file: bool = Query(False, description="是否同时删除磁盘文件（需 purge=true）"),
                       db: AsyncSession = Depends(get_db), user: User = Depends(require_admin)):
    from app.core.config import get_settings
    from app.core.pipeline import cleanup_derived

    a = await db.get(Asset, asset_id)
    if a is None:
        raise not_found()
    if purge:
        await delete_document(a.asset_type, str(a.id))
        if delete_file:
            storage = await _storage(db)
            storage.delete(a.storage_key)
        cleanup_derived(a.id, get_settings().data_root)
        await db.delete(a)
    else:
        a.deleted_at = datetime.now().astimezone()
        cleanup_derived(a.id, get_settings().data_root)  # 软删也清派生物；恢复时重新派生
        await _reindex(db, a)  # 软删后同步删除索引文档（由 worker 判断 deleted_at）
    await db.commit()
    return {"ok": True, "purged": purge}


@router.post("/assets/{asset_id}/restore", summary="恢复软删资产",
             description="管理员。清除删除标记并重建搜索索引；同时重新触发解析以补齐派生物（软删时缩略图/封面等已被清理）。")
async def restore_asset(asset_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                        user: User = Depends(require_admin)):
    from app.core.jobs import enqueue as jobs_enqueue

    a = await db.get(Asset, asset_id)
    if a is None:
        raise not_found()
    a.deleted_at = None
    await db.commit()
    await _reindex(db, a)
    # 重新派生：软删时派生物已清理，重跑解析链补齐缩略图/封面（解析器幂等，安全）
    await jobs_enqueue(db, f"parse:{a.asset_type}", {"asset_id": str(a.id)}, priority=5)
    return _item(a)


# ---------- 标签挂载（admin） ----------

class TagsBody(BaseModel):
    tag_ids: list[uuid.UUID]


@router.post("/assets/{asset_id}/tags", summary="挂载标签",
             description="管理员。为资产批量挂标签，已挂载的自动跳过。")
async def attach_tags(asset_id: uuid.UUID, body: TagsBody, db: AsyncSession = Depends(get_db),
                      user: User = Depends(require_admin)):
    a = await db.get(Asset, asset_id)
    if a is None:
        raise not_found()
    for tid in body.tag_ids:
        exists = await db.get(AssetTag, {"asset_id": a.id, "tag_id": tid})
        if exists is None:
            db.add(AssetTag(asset_id=a.id, tag_id=tid))
    await db.commit()
    await _reindex(db, a)
    return {"ok": True}


@router.delete("/assets/{asset_id}/tags", summary="移除标签",
               description="管理员。批量解除资产上的标签挂载，并异步重建该资产的搜索索引文档。")
async def detach_tags(asset_id: uuid.UUID, body: TagsBody, db: AsyncSession = Depends(get_db),
                      user: User = Depends(require_admin)):
    a = await db.get(Asset, asset_id)
    if a is None:
        raise not_found()
    for tid in body.tag_ids:
        row = await db.get(AssetTag, {"asset_id": asset_id, "tag_id": tid})
        if row is not None:
            await db.delete(row)
    await db.commit()
    await _reindex(db, a)
    return {"ok": True}


# ---------- 上传入库（admin；与扫描共用同一管道 §4.3） ----------

@router.post("/admin/uploads", summary="上传文件入库",
             description="管理员。单文件上传，走与目录扫描相同的解析管道（指纹 → 解析 → 派生物 / 索引）；类型不支持或超过大小上限时返回 400。")
async def upload(file: UploadFile, db: AsyncSession = Depends(get_db),
                 user: User = Depends(require_admin)):
    from app.core.config import get_settings

    if asset_type_of(file.filename or "") is None:
        raise bad_request(f"不支持的文件类型: {ext_of(file.filename or '')}")
    data = await file.read()
    if len(data) > get_settings().max_upload_gb * 1024**3:
        raise bad_request("文件超过上传上限")
    storage = await _storage(db)
    ym = datetime.now().strftime("%Y-%m")
    key = f"uploads:staging/{ym}/{uuid.uuid4().hex}{ext_of(file.filename or '')}"
    storage.save(key, data)
    asset = Asset(
        asset_type=asset_type_of(file.filename),
        status="pending",
        title=(file.filename or "upload").rsplit(".", 1)[0],
        storage_key=key,
        file_name=file.filename or "upload",
        size_bytes=len(data),
        mime_type=None,
    )
    db.add(asset)
    await db.commit()
    await enqueue(db, "fingerprint", {"asset_id": str(asset.id)}, priority=1)
    return _item(asset)
