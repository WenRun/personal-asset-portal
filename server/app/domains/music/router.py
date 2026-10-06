"""音乐端点（详细设计 §5.2/§6.2）：专辑墙（公开）、专辑详情/曲目/平铺曲目（member）、Range 音频流（member）。"""

import uuid

from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import require_member
from app.core.db import get_db
from app.core.errors import bad_request, not_found
from app.core.models import Asset, MusicAlbum, MusicArtist, MusicTrack
from app.core.pipeline import build_storage, roots_of

router = APIRouter(prefix="/api/music", tags=["music"])


@router.get("/albums")
async def list_albums(db: AsyncSession = Depends(get_db)):
    """专辑墙（公开浏览页）。"""
    rows = (
        await db.execute(
            select(
                MusicAlbum.id, MusicAlbum.name, MusicAlbum.year, MusicAlbum.cover_path,
                MusicArtist.name.label("artist"),
                func.count(MusicTrack.asset_id).label("track_count"),
                func.sum(MusicTrack.duration_ms).label("duration_ms"),
                func.min(MusicTrack.format).label("format"),
            )
            .join(MusicArtist, MusicArtist.id == MusicAlbum.artist_id, isouter=True)
            .join(MusicTrack, MusicTrack.album_id == MusicAlbum.id, isouter=True)
            .group_by(MusicAlbum.id, MusicArtist.name)
            .having(func.count(MusicTrack.asset_id) > 0)
            .order_by(MusicAlbum.year.desc().nullslast(), MusicAlbum.name)
        )
    ).all()
    return [
        {
            "id": str(r.id), "name": r.name, "artist": r.artist or "未知艺术家",
            "year": r.year, "format": r.format, "track_count": r.track_count,
            "duration_sec": int((r.duration_ms or 0) / 1000),
            "has_cover": bool(r.cover_path),
        }
        for r in rows
    ]


@router.get("/tracks")
async def list_tracks(db: AsyncSession = Depends(get_db), _: object = Depends(require_member)):
    """全部曲目平铺（member）。"""
    rows = (
        await db.execute(
            select(Asset, MusicTrack, MusicAlbum.name.label("album"), MusicArtist.name.label("artist"))
            .join(MusicTrack, MusicTrack.asset_id == Asset.id)
            .join(MusicAlbum, MusicAlbum.id == MusicTrack.album_id, isouter=True)
            .join(MusicArtist, MusicArtist.id == MusicTrack.artist_id, isouter=True)
            .where(Asset.deleted_at.is_(None))
            .order_by(Asset.created_at.desc())
            .limit(500)
        )
    ).all()
    return [
        {
            "asset_id": str(a.id), "album_id": str(t.album_id), "title": a.title, "album": al or "未知专辑",
            "artist": ar or "未知艺术家", "no": t.track_no,
            "duration_sec": int((t.duration_ms or 0) / 1000), "bitrate_kbps": t.bitrate_kbps,
            "lrc": t.has_lyrics, "format": t.format, "streamable": t.streamable,
            "created_at": a.created_at.isoformat(),
        }
        for a, t, al, ar in rows
    ]


@router.get("/albums/{album_id}")
async def album_detail(album_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: object = Depends(require_member)):
    """专辑详情（member）：曲目列表。"""
    al = await db.get(MusicAlbum, album_id)
    if al is None:
        raise not_found()
    artist = await db.get(MusicArtist, al.artist_id) if al.artist_id else None
    tracks = (
        await db.execute(
            select(Asset, MusicTrack)
            .join(MusicTrack, MusicTrack.asset_id == Asset.id)
            .where(MusicTrack.album_id == al.id, Asset.deleted_at.is_(None))
            .order_by(MusicTrack.disc_no.nullsfirst(), MusicTrack.track_no.nullsfirst(), Asset.created_at)
        )
    ).all()
    return {
        "id": str(al.id), "name": al.name, "artist": artist.name if artist else "未知艺术家",
        "year": al.year, "has_cover": bool(al.cover_path),
        "tracks": [
            {
                "asset_id": str(a.id), "no": t.track_no, "title": a.title,
                "duration_sec": int((t.duration_ms or 0) / 1000), "bitrate_kbps": t.bitrate_kbps,
                "sample_rate_hz": t.sample_rate_hz, "lrc": t.has_lyrics,
                "format": t.format, "streamable": t.streamable, "size_bytes": a.size_bytes,
            }
            for a, t in tracks
        ],
    }


@router.get("/albums/{album_id}/cover")
async def album_cover(album_id: uuid.UUID, size: int = 256, db: AsyncSession = Depends(get_db)):
    """公开：专辑封面取首曲派生物（§5.5 同款口径）。"""
    if size not in (256, 1024):
        raise bad_request("size 仅支持 256/1024")
    al = await db.get(MusicAlbum, album_id)
    if al is None or not al.cover_path:
        raise not_found("专辑封面尚未生成")
    p = get_settings().data_root / al.cover_path.replace("cover_256", f"cover_{size}")
    if not p.is_file():
        raise not_found()
    return FileResponse(p, media_type="image/webp",
                        headers={"Cache-Control": "public, max-age=31536000, immutable"})


@router.get("/{asset_id}/stream")
async def stream(asset_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: object = Depends(require_member)):
    """音频流（登录）：FileResponse 原生支持 Range 请求（206 分段）。"""
    a = await db.get(Asset, asset_id)
    if a is None or a.deleted_at is not None or a.asset_type != "music":
        raise not_found()
    t = await db.get(MusicTrack, asset_id)
    if t is not None and not t.streamable:
        raise bad_request("该格式不支持在线播放，仅下载")
    storage = build_storage(await roots_of(db))
    return FileResponse(storage.resolve(a.storage_key), filename=a.file_name,
                        media_type=a.mime_type or "audio/mpeg")
