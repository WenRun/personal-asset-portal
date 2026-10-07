"""字体预览端点（详细设计 §5.1/§6.2）：字族打包下载随 M6；样张图公开，文件流与字符集 member。"""

import uuid

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import require_member
from app.core.db import get_db
from app.core.errors import not_found
from app.core.models import Asset
from app.core.pipeline import build_storage, roots_of

router = APIRouter(prefix="/api/fonts", tags=["字体"])


@router.get("/{asset_id}/file", summary="字体原文件流",
            description="登录用户。原字体文件流，前端用 FontFace 加载预览。")
async def font_file(asset_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: object = Depends(require_member)):
    """原字体文件流（前端 FontFace 加载用）；需登录。"""
    a = await db.get(Asset, asset_id)
    if a is None or a.deleted_at is not None or a.asset_type != "font":
        raise not_found()
    storage = build_storage(await roots_of(db))
    return FileResponse(storage.resolve(a.storage_key), filename=a.file_name,
                        media_type=a.mime_type or "font/ttf")


@router.get("/{asset_id}/charset", summary="字体字符集",
            description="登录用户。返回解析出的字符集 JSON；尚未生成时返回 404。")
async def font_charset(asset_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: object = Depends(require_member)):
    a = await db.get(Asset, asset_id)
    if a is None or a.deleted_at is not None or a.asset_type != "font":
        raise not_found()
    p = get_settings().data_root / "derived" / "fonts" / str(a.id) / "charset.json"
    if not p.is_file():
        raise not_found("字符集尚未生成")
    import json

    return json.loads(p.read_text(encoding="utf-8"))


@router.get("/{asset_id}/preview/specimen", summary="字体样张图",
            description="公开。PNG 样张预览图；长缓存一年（immutable）。")
async def specimen(asset_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """公开：样张图属于浏览页的一部分（§5.5 同款权限口径）。"""
    a = await db.get(Asset, asset_id)
    if a is None or a.deleted_at is not None or a.asset_type != "font":
        raise not_found()
    p = get_settings().data_root / "derived" / "fonts" / str(a.id) / "specimen.png"
    if not p.is_file():
        raise not_found("样张尚未生成")
    return FileResponse(p, media_type="image/png",
                        headers={"Cache-Control": "public, max-age=31536000, immutable"})
