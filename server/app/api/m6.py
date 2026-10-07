"""M6 打磨端点：打包下载 / 分享链接 / 智能集合（详细设计 §8/§6.3）。"""

import datetime as dt
import secrets
import uuid

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import bad_request, not_found
from app.core.jobs import enqueue
from app.core.models import (
    Asset, DownloadPack, SavedCollection, ShareLink, User,
)
from app.core.deps import get_current_user, require_admin, require_member

router = APIRouter(prefix="/api", tags=["打包与分享"])
share_public = APIRouter(prefix="/api/share", tags=["打包与分享"])


# ---------- 打包下载 ----------

class PackBody(BaseModel):
    asset_ids: list[uuid.UUID] | None = None
    type: str | None = None       # filters 兜底：按类型
    favorite: bool | None = None


@router.post("/download-packs", summary="创建打包任务",
             description="登录用户。按 asset_ids 列表，或按类型+收藏筛选创建 ZIP 打包任务（二选一），后台异步生成。")
async def create_pack(body: PackBody, db: AsyncSession = Depends(get_db), user: User = Depends(require_member)):
    if body.asset_ids:
        params = {"asset_ids": [str(i) for i in body.asset_ids]}
    elif body.type:
        params = {"type": body.type, "favorite": bool(body.favorite)}
    else:
        raise bad_request("需要 asset_ids 或 type")
    pack = DownloadPack(user_id=user.id, params=params)
    db.add(pack)
    await db.commit()
    await enqueue(db, "pack_zip", {"pack_id": str(pack.id)}, priority=3)
    await db.commit()
    return {"id": str(pack.id), "status": pack.status}


@router.get("/download-packs", summary="我的打包任务列表",
            description="登录用户。返回当前用户最近 50 个打包任务（状态 / 大小 / 文件数 / 错误信息）。")
async def list_packs(db: AsyncSession = Depends(get_db), user: User = Depends(require_member)):
    rows = (
        await db.execute(
            select(DownloadPack).where(DownloadPack.user_id == user.id).order_by(DownloadPack.created_at.desc()).limit(50)
        )
    ).scalars().all()
    return [
        {
            "id": str(p.id), "status": p.status, "params": p.params,
            "size_bytes": p.size_bytes, "file_count": p.file_count,
            "error": p.error, "created_at": p.created_at.isoformat(),
        }
        for p in rows
    ]


@router.get("/download-packs/{pack_id}/file", summary="下载打包 ZIP",
            description="登录用户。仅能下载自己的、状态为 done 的打包结果；未完成时返回 400。")
async def pack_file(pack_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = Depends(require_member)):
    p = await db.get(DownloadPack, pack_id)
    if p is None or p.user_id != user.id:
        raise not_found()
    if p.status != "done" or not p.file_path:
        raise bad_request("打包尚未完成")
    return FileResponse(get_settings().data_root / p.file_path, filename=f"pack-{pack_id}.zip",
                        media_type="application/zip")


# ---------- 分享链接（详细设计 §8：带过期，可限制下载） ----------

class ShareBody(BaseModel):
    asset_id: uuid.UUID
    expires_hours: int = Field(default=72, ge=1, le=24 * 30)
    allow_download: bool = False


@router.post("/admin/shares", summary="创建分享链接",
             description="管理员。为单个资产生成带过期时间的公开 token 链接，可限制是否允许下载。")
async def create_share(body: ShareBody, db: AsyncSession = Depends(get_db), user: User = Depends(require_admin)):
    a = await db.get(Asset, body.asset_id)
    if a is None or a.deleted_at is not None:
        raise not_found()
    token = secrets.token_urlsafe(16)
    db.add(ShareLink(
        token=token, asset_id=a.id, allow_download=body.allow_download,
        expires_at=dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=body.expires_hours),
        created_by=user.id,
    ))
    await db.commit()
    return {"token": token, "url": f"/share/{token}", "expires_hours": body.expires_hours}


@router.get("/admin/shares", summary="分享链接列表",
            description="管理员。返回最近 50 条分享链接（对应资产 / 是否可下载 / 过期时间与状态）。")
async def list_shares(db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    rows = (
        await db.execute(
            select(ShareLink, Asset.title, Asset.file_name)
            .join(Asset, Asset.id == ShareLink.asset_id)
            .order_by(ShareLink.created_at.desc())
            .limit(50)
        )
    ).all()
    return [
        {
            "token": s.token, "asset_title": title, "file_name": file_name,
            "allow_download": s.allow_download,
            "expires_at": s.expires_at.isoformat(),
            "expired": s.expires_at <= dt.datetime.now(dt.timezone.utc),
        }
        for s, title, file_name in rows
    ]


@router.delete("/admin/shares/{token}", summary="撤销分享链接",
               description="管理员。立即删除该 token，链接随之失效。")
async def revoke_share(token: str, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    await db.execute(delete(ShareLink).where(ShareLink.token == token))
    await db.commit()
    return {"ok": True}


@share_public.get("/{token}", summary="公开分享预览",
                  description="无需登录。按 token 返回分享内容的基本信息与预览图地址；链接不存在或已过期返回 404。")
async def share_view(token: str, db: AsyncSession = Depends(get_db)):
    s = (await db.execute(select(ShareLink).where(ShareLink.token == token))).scalar_one_or_none()
    if s is None or s.expires_at <= dt.datetime.now(dt.timezone.utc):
        raise not_found("分享不存在或已过期")
    a = await db.get(Asset, s.asset_id)
    if a is None or a.deleted_at is not None:
        raise not_found()
    preview = None
    if a.asset_type == "image":
        preview = f"/api/images/{a.id}/thumbnail?size=1024"
    elif a.asset_type == "book":
        preview = f"/api/books/{a.id}/cover?size=1024"
    elif a.asset_type == "video":
        from app.core.models import VideoDetail
        d = await db.get(VideoDetail, a.id)
        if d is not None and d.cover_path:
            preview = f"/api/videos/cover/{d.cover_path}"
    elif a.asset_type == "font":
        preview = f"/api/fonts/{a.id}/preview/specimen"
    return {
        "title": a.title, "type": a.asset_type, "file_name": a.file_name,
        "size_bytes": a.size_bytes, "note": a.note,
        "allow_download": s.allow_download,
        "preview_url": preview,
        "download_url": f"/api/share/{token}/download" if s.allow_download else None,
    }


@share_public.get("/{token}/download", summary="公开分享下载",
                  description="无需登录。下载分享的原文件；链接过期或未开放下载权限时返回 404。")
async def share_download(token: str, db: AsyncSession = Depends(get_db)):
    s = (await db.execute(select(ShareLink).where(ShareLink.token == token))).scalar_one_or_none()
    if s is None or s.expires_at <= dt.datetime.now(dt.timezone.utc) or not s.allow_download:
        raise not_found("分享不存在、已过期或不允许下载")
    a = await db.get(Asset, s.asset_id)
    if a is None or a.deleted_at is not None:
        raise not_found()
    from app.core.pipeline import build_storage, roots_of

    storage = build_storage(await roots_of(db))
    return FileResponse(storage.resolve(a.storage_key), filename=a.file_name,
                        media_type=a.mime_type or "application/octet-stream")


# ---------- 智能集合（保存的筛选，详细设计 §4.5） ----------

class CollectionBody(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    asset_type: str | None = None
    params: dict = Field(default_factory=dict)


@router.get("/collections", summary="我的智能集合",
            description="登录用户。返回当前用户保存的筛选集合（名称 / 资产类型 / 筛选参数）。")
async def list_collections(db: AsyncSession = Depends(get_db), user: User = Depends(require_member)):
    rows = (
        await db.execute(
            select(SavedCollection).where(SavedCollection.user_id == user.id).order_by(SavedCollection.created_at.desc())
        )
    ).scalars().all()
    return [
        {"id": str(c.id), "name": c.name, "asset_type": c.asset_type, "params": c.params}
        for c in rows
    ]


@router.post("/collections", summary="新建智能集合",
             description="登录用户。把当前筛选条件（类型 + 参数）保存为命名集合，便于一键复访。")
async def create_collection(body: CollectionBody, db: AsyncSession = Depends(get_db), user: User = Depends(require_member)):
    c = SavedCollection(user_id=user.id, name=body.name,
                        asset_type=body.asset_type, params=body.params)
    db.add(c)
    await db.commit()
    return {"id": str(c.id), "name": c.name}


@router.delete("/collections/{cid}", summary="删除智能集合",
               description="登录用户。仅能删除自己创建的集合。")
async def delete_collection(cid: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = Depends(require_member)):
    c = await db.get(SavedCollection, cid)
    if c is None or c.user_id != user.id:
        raise not_found()
    await db.execute(delete(SavedCollection).where(SavedCollection.id == cid))
    await db.commit()
    return {"ok": True}
