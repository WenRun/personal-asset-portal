"""字体预览端点（详细设计 §5.1/§6.2）：字族打包下载、样张图公开，文件流与字符集 member。"""

import os
import tempfile
import uuid
import zipfile
from pathlib import Path

import anyio
from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import require_member
from app.core.db import get_db
from app.core.errors import not_found
from app.core.models import Asset, FontDetail
from app.core.pipeline import build_storage, roots_of

router = APIRouter(prefix="/api/fonts", tags=["字体"])


@router.get("/{asset_id}/family-pack", summary="字族打包下载",
            description="登录用户。把该资产所属字族的全部字重文件即时打成 ZIP 返回（文件名冲突自动加序号）；字族名取自解析结果。")
async def family_pack(asset_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: object = Depends(require_member)):
    a = await db.get(Asset, asset_id)
    if a is None or a.deleted_at is not None or a.asset_type != "font":
        raise not_found()
    d = await db.get(FontDetail, a.id)
    if d is None or not d.family:
        raise not_found("该字体尚未解析出字族")
    rows = (
        await db.execute(
            select(Asset).join(FontDetail, FontDetail.asset_id == Asset.id)
            .where(FontDetail.family == d.family, Asset.deleted_at.is_(None))
            .order_by(Asset.created_at)
        )
    ).scalars().all()
    if not rows:
        raise not_found("字族下没有可用文件")
    storage = build_storage(await roots_of(db))
    sources = [(storage.resolve(x.storage_key), x.file_name) for x in rows]
    family = d.family.replace("/", "_").replace("\\", "_") or "font-family"

    def _build_zip() -> str:
        """同步打包：字族文件通常只有几MB~几十MB，临时文件后一次返回。"""
        fd, tmp = tempfile.mkstemp(suffix=".zip")
        with os.fdopen(fd, "wb") as f, zipfile.ZipFile(f, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as zf:
            used: set[str] = set()
            for src, arc in sources:
                base, ext = os.path.splitext(arc)
                n = 2
                while arc in used:
                    arc = f"{base}({n}){ext}"
                    n += 1
                used.add(arc)
                zf.write(src, arc)
        return tmp

    tmp = await anyio.to_thread.run_sync(_build_zip)
    return FileResponse(
        tmp, filename=f"{family}.zip", media_type="application/zip",
        headers={"Cache-Control": "no-store"},
        background=BackgroundTask(os.unlink, tmp),  # 响应发送完毕后删除临时文件
    )


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
