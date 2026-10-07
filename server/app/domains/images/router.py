"""图片预览端点（详细设计 §5.5/§6.2）：缩略图公开（浏览页一部分），原图 member。"""

import uuid

from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import require_member
from app.core.db import get_db
from app.core.errors import bad_request, not_found
from app.core.models import Asset
from app.domains.images.thumbs import derived_dir

router = APIRouter(prefix="/api/images", tags=["图片"])


@router.get("/{asset_id}/thumbnail", summary="图片缩略图",
            description="公开。WebP 缩略图，size 支持 256 / 1024 / 2560 三档；长缓存一年（immutable）。")
async def thumbnail(asset_id: uuid.UUID, size: int = Query(256, description="缩略图边长档位：256 / 1024 / 2560"),
                    db: AsyncSession = Depends(get_db)):
    """公开：浏览页网格内的缩略图属于「浏览」的一部分（§5.5 权限口径）。"""
    if size not in (256, 1024, 2560):
        raise bad_request("size 仅支持 256/1024/2560")
    a = await db.get(Asset, asset_id)
    if a is None or a.deleted_at is not None or a.asset_type != "image":
        raise not_found()
    p = derived_dir(str(a.id)) / f"thumb_{size}.webp"
    if not p.is_file():
        raise not_found("缩略图尚未生成")
    return FileResponse(p, media_type="image/webp",
                        headers={"Cache-Control": "public, max-age=31536000, immutable"})


@router.get("/{asset_id}/original", summary="图片原图",
            description="登录用户。输出原图文件流（不暴露服务器真实路径）。")
async def original(asset_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                   _: object = Depends(require_member)):
    """原图需登录；经存储抽象输出，不暴露真实路径。"""
    a = await db.get(Asset, asset_id)
    if a is None or a.deleted_at is not None or a.asset_type != "image":
        raise not_found()
    from app.core.pipeline import build_storage, roots_of

    storage = build_storage(await roots_of(db))
    return FileResponse(storage.resolve(a.storage_key), filename=a.file_name,
                        media_type=a.mime_type or "application/octet-stream")
