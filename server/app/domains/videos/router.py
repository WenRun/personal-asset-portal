"""视频端点（详细设计 §5.3/§6.3）：系列墙（公开）、集数列表（member，含进度）、Direct Play 流（member）、封面、确认队列。"""

import uuid

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import require_admin, require_member
from app.core.db import get_db
from app.core.errors import bad_request, not_found
from app.core.models import Asset, User, UserProgress, VideoDetail, VideoSeries
from app.core.pipeline import build_storage, roots_of

router = APIRouter(prefix="/api/videos", tags=["视频"])
admin_router = APIRouter(prefix="/api/admin", tags=["视频"])


@router.get("/series", summary="视频系列墙",
            description="公开。返回全部系列（集数范围 / 总时长 / 封面），系列未设封面时取任一集的封面。")
async def list_series(db: AsyncSession = Depends(get_db)):
    """系列墙（公开浏览页）：系列 + 集数/时长/进度汇总。"""
    rows = (
        await db.execute(
            select(
                VideoSeries.id, VideoSeries.name, VideoSeries.cover_path,
                func.count(VideoDetail.asset_id).label("episodes"),
                func.sum(VideoDetail.duration_ms).label("duration_ms"),
                func.min(VideoDetail.episode).label("first_ep"),
                func.max(VideoDetail.episode).label("last_ep"),
            )
            .join(VideoDetail, VideoDetail.series_id == VideoSeries.id)
            .group_by(VideoSeries.id)
            .order_by(VideoSeries.name)
        )
    ).all()
    out = []
    for r in rows:
        # 封面：系列未设时取任一集的封面
        cover = r.cover_path
        if not cover:
            first = (
                await db.execute(
                    select(VideoDetail.cover_path)
                    .where(VideoDetail.series_id == r.id, VideoDetail.cover_path.isnot(None))
                    .limit(1)
                )
            ).scalar_one_or_none()
            cover = first
        out.append({
            "id": str(r.id), "name": r.name,
            "episodes": r.episodes, "first_ep": r.first_ep, "last_ep": r.last_ep,
            "duration_sec": int((r.duration_ms or 0) / 1000),
            "cover_url": f"/api/videos/cover/{cover}" if cover else None,
        })
    return out


@router.get("/series/{series_id}/episodes", summary="系列集数列表",
            description="登录用户。按集数排序返回每集信息（时长 / 观看位置 / 可否在线播放 / 封面），并汇总当前用户的已看集数。")
async def series_episodes(series_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                          user: User = Depends(require_member)):
    """集数列表（member）：含每集时长与当前用户进度。"""
    s = await db.get(VideoSeries, series_id)
    if s is None:
        raise not_found()
    rows = (
        await db.execute(
            select(Asset, VideoDetail, UserProgress.position)
            .join(VideoDetail, VideoDetail.asset_id == Asset.id)
            .join(UserProgress, (UserProgress.asset_id == Asset.id) & (UserProgress.user_id == user.id), isouter=True)
            .where(VideoDetail.series_id == series_id, Asset.deleted_at.is_(None))
            .order_by(VideoDetail.episode.nullsfirst(), Asset.created_at)
        )
    ).all()
    watched = 0
    eps = []
    for a, d, pos in rows:
        ep_pos = (pos or {}).get("seconds", 0) if isinstance(pos, dict) else 0
        if ep_pos and d.duration_ms and ep_pos >= d.duration_ms / 1000 * 0.95:
            watched += 1
        eps.append({
            "asset_id": str(a.id), "episode": d.episode, "title": a.title,
            "duration_sec": int((d.duration_ms or 0) / 1000), "position_sec": ep_pos,
            "streamable": d.streamable, "cover_url": f"/api/videos/cover/{d.cover_path}" if d.cover_path else None,
        })
    return {
        "id": str(s.id), "name": s.name, "description": s.description,
        "episode_count": len(eps), "watched": watched,
        "cover_url": f"/api/videos/cover/{s.cover_path}" if s.cover_path else (eps[0]["cover_url"] if eps else None),
        "episodes": eps,
    }


@router.get("/cover/{path:path}", summary="视频封面图",
            description="公开。路径由服务端下发，仅允许 derived/videos 目录内的文件；长缓存一年（immutable）。")
async def series_or_video_cover(path: str):
    """公开：封面帧属浏览页一部分（路径由服务端下发，仅允许 derived/videos 内文件）。"""
    p = (get_settings().data_root / path).resolve()
    base = (get_settings().data_root / "derived" / "videos").resolve()
    if not p.is_relative_to(base) or not p.is_file():
        raise not_found()
    media = "image/jpeg" if p.suffix == ".jpg" else "image/webp"
    return FileResponse(p, media_type=media,
                        headers={"Cache-Control": "public, max-age=31536000, immutable"})


@router.get("/{asset_id}/stream", summary="视频流",
            description="登录用户。Direct Play 原文件流，支持 Range 分段请求（206）；编码不支持在线播放时返回 400。")
async def stream(asset_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: object = Depends(require_member)):
    """视频流（登录，Direct Play）：FileResponse 原生 Range 支持。"""
    a = await db.get(Asset, asset_id)
    if a is None or a.deleted_at is not None or a.asset_type != "video":
        raise not_found()
    d = await db.get(VideoDetail, asset_id)
    if d is not None and not d.streamable:
        raise bad_request("该容器/编码不支持在线播放（Direct Play），仅下载")
    storage = build_storage(await roots_of(db))
    return FileResponse(storage.resolve(a.storage_key), filename=a.file_name,
                        media_type=a.mime_type or "video/mp4")


class ConfirmBody(BaseModel):
    asset_id: uuid.UUID
    series_name: str
    episode: int


@admin_router.post("/confirm", summary="确认视频归属系列",
                   description="管理员。人工校对识别存疑的视频：绑定系列并写入集数，解除 need_confirm 标记。")
async def confirm_series(body: ConfirmBody, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    """入库确认队列（§5.3 need_confirm）：人工校对系列/集数。"""
    a = await db.get(Asset, body.asset_id)
    d = await db.get(VideoDetail, body.asset_id)
    if a is None or d is None:
        raise not_found()
    from app.domains.videos.series import upsert_series

    srow = await upsert_series(db, body.series_name)
    d.series_id = srow.id
    d.episode = body.episode
    d.kind = "tutorial"
    a.meta = {**a.meta, "need_confirm": False}
    await db.commit()
    return {"ok": True}


@admin_router.get("/confirm", summary="待确认视频列表",
                  description="管理员。返回所有 need_confirm=true 的视频及其识别提示（命中规则 / 集数存疑）。")
async def confirm_list(db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    rows = (
        await db.execute(
            select(Asset, VideoDetail)
            .join(VideoDetail, VideoDetail.asset_id == Asset.id)
            .where(Asset.meta["need_confirm"].as_boolean().is_(True), Asset.deleted_at.is_(None))
        )
    ).all()
    return [
        {
            "id": str(a.id), "file": a.file_name, "series": d.series_id,
            "hint": f"识别规则 {a.meta.get('recognized_pattern', '父目录兜底')} · 集数存疑",
        }
        for a, d in rows
    ]


@admin_router.put("/videos/{asset_id}/cover", summary="更换视频封面帧",
                  description="管理员。在三张候选封面帧中选择一张作为封面（variant 取 1 / 2 / 3）。")
async def pick_cover(asset_id: uuid.UUID, variant: int = Query(description="候选封面帧编号：1 / 2 / 3"),
                     db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    """更换封面帧（1..3）。"""
    if variant not in (1, 2, 3):
        raise bad_request("variant 仅支持 1/2/3")
    d = await db.get(VideoDetail, asset_id)
    if d is None:
        raise not_found()
    d.cover_path = f"derived/videos/{asset_id}/cover_{variant}.webp"
    await db.commit()
    return {"ok": True, "cover_path": d.cover_path}
