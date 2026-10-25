"""音乐端点（详细设计 §5.2/§6.2）：专辑墙（公开）、专辑详情/曲目/平铺曲目（member）、Range 音频流（member）。"""

import logging
import posixpath
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import require_member
from app.core.db import get_db
from app.core.errors import bad_request, not_found
from app.core.models import Asset, MusicAlbum, MusicArtist, MusicTrack
from app.core.pipeline import build_storage, roots_of
from app.core.registry import ext_of, mime_of

log = logging.getLogger("portal.music.router")

router = APIRouter(prefix="/api/music", tags=["音乐"])


@router.get("/albums", summary="专辑墙",
            description="公开。分页返回专辑（艺术家 / 年份 / 曲目数 / 总时长 / 格式 / 是否有封面），按年份倒序、名称排序；返回 {items, total, has_more}。")
async def list_albums(category: str | None = None, page: int = Query(1, ge=1),
                      page_size: int = Query(60, ge=1, le=120), db: AsyncSession = Depends(get_db)):
    """专辑墙（公开浏览页）。offset 分页：排序键 year 可空且名称可重复，无法做稳定游标。"""
    q = (
        select(
            MusicAlbum.id, MusicAlbum.name, MusicAlbum.year, MusicAlbum.cover_path,
            MusicArtist.name.label("artist"),
            func.count(MusicTrack.asset_id).label("track_count"),
            func.sum(MusicTrack.duration_ms).label("duration_ms"),
            func.min(MusicTrack.format).label("format"),
        )
        .join(MusicArtist, MusicArtist.id == MusicAlbum.artist_id, isouter=True)
        .join(MusicTrack, MusicTrack.album_id == MusicAlbum.id, isouter=True)
        .join(Asset, Asset.id == MusicTrack.asset_id, isouter=True)
        .where(Asset.deleted_at.is_(None))
    )
    if category == "__uncategorized__":
        q = q.where(Asset.category.is_(None))
    elif category:
        q = q.where(or_(Asset.category == category, Asset.category.like(f"{category}/%")))

    q = (
        q.group_by(MusicAlbum.id, MusicArtist.name)
        .having(func.count(MusicTrack.asset_id) > 0)
        .order_by(MusicAlbum.year.desc().nullslast(), MusicAlbum.name)
    )
    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar() or 0
    rows = (await db.execute(q.offset((page - 1) * page_size).limit(page_size))).all()
    return {
        "items": [
            {
                "id": str(r.id), "name": r.name, "artist": r.artist or "未知艺术家",
                "year": r.year, "format": r.format, "track_count": r.track_count,
                "duration_sec": int((r.duration_ms or 0) / 1000),
                "has_cover": bool(r.cover_path),
            }
            for r in rows
        ],
        "total": total,
        "has_more": page * page_size < total,
    }


@router.get("/tracks", summary="全部曲目（平铺）",
            description="登录用户。按入库时间倒序返回最近 500 首曲目及其专辑 / 艺术家信息。")
async def list_tracks(category: str | None = None, db: AsyncSession = Depends(get_db), _: object = Depends(require_member)):
    """全部曲目平铺（member）。"""
    q = (
        select(Asset, MusicTrack, MusicAlbum.name.label("album"), MusicArtist.name.label("artist"))
        .join(MusicTrack, MusicTrack.asset_id == Asset.id)
        .join(MusicAlbum, MusicAlbum.id == MusicTrack.album_id, isouter=True)
        .join(MusicArtist, MusicArtist.id == MusicTrack.artist_id, isouter=True)
        .where(Asset.deleted_at.is_(None))
    )
    if category == "__uncategorized__":
        q = q.where(Asset.category.is_(None))
    elif category:
        q = q.where(or_(Asset.category == category, Asset.category.like(f"{category}/%")))

    q = q.order_by(Asset.created_at.desc()).limit(500)
    rows = (await db.execute(q)).all()
    return [
        {
            "asset_id": str(a.id), "album_id": str(t.album_id), "title": a.title, "album": al or "未知专辑",
            "artist": ar or "未知艺术家", "no": t.track_no,
            "duration_sec": int((t.duration_ms or 0) / 1000), "bitrate_kbps": t.bitrate_kbps,
            "sample_rate_hz": t.sample_rate_hz,
            "channels": a.meta.get("channels") if a.meta else None,
            "channel_layout": a.meta.get("channel_layout") if a.meta else None,
            "surround": a.meta.get("surround") if a.meta else None,
            "lrc": t.has_lyrics, "format": t.format, "streamable": t.streamable,
            "is_cue_track": bool(a.meta and a.meta.get("is_cue_track")),
            "created_at": a.created_at.isoformat(),
            "category": a.category,
            "suggested_category": a.suggested_category,
        }
        for a, t, al, ar in rows
        if not (a.meta and a.meta.get("is_cue_master"))
    ]


@router.get("/albums/{album_id}", summary="专辑详情",
            description="登录用户。返回专辑信息与曲目列表（按碟号 / 曲目号排序）。")
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

    # 展示用资源路径：专辑曲目通常同目录，取首轨所在目录；CUE 分轨回落到母带音频所在目录
    album_path = None
    try:
        storage = build_storage(await roots_of(db))
        for a, _t in tracks:
            try:
                key = (a.meta or {}).get("audio_storage_key") or a.storage_key
                album_path = posixpath.dirname(storage.display_path(key)) or None
                break
            except Exception:  # noqa: BLE001
                continue
    except Exception:  # noqa: BLE001
        album_path = None

    return {
        "id": str(al.id), "name": al.name, "artist": artist.name if artist else "未知艺术家",
        "year": al.year, "has_cover": bool(al.cover_path), "path": album_path,
        "tracks": [
            {
                "asset_id": str(a.id), "no": t.track_no, "title": a.title,
                "duration_sec": int((t.duration_ms or 0) / 1000), "bitrate_kbps": t.bitrate_kbps,
                "sample_rate_hz": t.sample_rate_hz,
                "channels": a.meta.get("channels") if a.meta else None,
                "channel_layout": a.meta.get("channel_layout") if a.meta else None,
                "surround": a.meta.get("surround") if a.meta else None,
                "lrc": t.has_lyrics,
                "format": t.format, "streamable": t.streamable, "size_bytes": a.size_bytes,
                "is_cue_track": bool(a.meta and a.meta.get("is_cue_track")),
            }
            for a, t in tracks
            if not (a.meta and a.meta.get("is_cue_master"))
        ],
    }


@router.get("/albums/{album_id}/cover", summary="专辑封面",
            description="公开。取专辑首曲的派生封面图，size 支持 256 / 1024；长缓存一年（immutable）。")
async def album_cover(album_id: uuid.UUID, size: int = Query(256, description="封面边长档位：256 / 1024"),
                      db: AsyncSession = Depends(get_db)):
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


@router.get("/{asset_id}/lyrics", summary="歌词文本",
            description="登录用户。返回解析时入库的歌词原文（meta.lyrics，LRC 带时间戳或纯文本），无歌词时 lyrics 为 null。")
async def lyrics(asset_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: object = Depends(require_member)):
    a = await db.get(Asset, asset_id)
    if a is None or a.deleted_at is not None or a.asset_type != "music":
        raise not_found()
    return {"lyrics": a.meta.get("lyrics") or None}


@router.get("/{asset_id}/stream", summary="音频流",
            description="登录用户。返回音频文件流，原生支持 Range 分段请求（206），可直接供 audio 标签播放。")
async def stream(asset_id: uuid.UUID,
                 original: bool = Query(False, description="是否原样输出原始音频文件（非转码）"),
                 db: AsyncSession = Depends(get_db), _: object = Depends(require_member)):
    """音频流（登录）：FileResponse 原生支持 Range 请求（206 分段）。DTS 及多声道环绕声音频自动下混为兼容立体声 MP3 串流播放。"""
    a = await db.get(Asset, asset_id)
    if a is None or a.deleted_at is not None or a.asset_type != "music":
        raise not_found()
    t = await db.get(MusicTrack, asset_id)
    if t is not None and not t.streamable:
        raise bad_request("该格式不支持在线播放，仅下载")
    storage = build_storage(await roots_of(db))
    ext = ext_of(a.file_name).lstrip(".").lower()

    # 若请求的是 CUE 索引资产本身：自动路由播放其第一首分轨曲目（或直接播放关联母带）
    if ext == "cue" or (a.meta and a.meta.get("is_cue_sheet")):
        first_track_id = uuid.uuid5(a.id, "track_1")
        first_asset = await db.get(Asset, first_track_id)
        if first_asset is not None and first_asset.deleted_at is None:
            a = first_asset
            asset_id = first_track_id
            ext = ext_of(a.file_name).lstrip(".").lower()
        else:
            audio_aid = a.meta.get("audio_asset_id") if a.meta else None
            if audio_aid:
                try:
                    master_a = await db.get(Asset, uuid.UUID(audio_aid))
                    if master_a is not None and master_a.deleted_at is None:
                        a = master_a
                        asset_id = master_a.id
                        ext = ext_of(a.file_name).lstrip(".").lower()
                except Exception:
                    pass

    # CUE 派生分轨：多层容错定位母带音频并输出切片流
    if a.meta and a.meta.get("is_cue_track"):
        from app.domains.music.transcode import ensure_cue_track_stream

        cue_asset_id = a.meta.get("cue_asset_id")
        track_no = a.meta.get("track_no", 1)
        start_ms = a.meta.get("start_ms", 0)
        end_ms = a.meta.get("end_ms")
        audio_path_str = a.meta.get("audio_path")
        audio_path = Path(audio_path_str) if audio_path_str else None

        # 1. 尝试直接从子资产 meta 中的 audio_storage_key 解析
        if (audio_path is None or not audio_path.exists()) and a.meta.get("audio_storage_key"):
            try:
                audio_path = storage.resolve(a.meta["audio_storage_key"])
            except Exception:
                pass

        # 2. 尝试从所属 CUE 资产解析并定位同目录音频
        cue_asset = None
        if cue_asset_id:
            try:
                cue_asset = await db.get(Asset, uuid.UUID(cue_asset_id))
            except Exception:
                pass

        # 2.1 尝试从 CUE 资产记录的 audio_asset_id 查找
        if (audio_path is None or not audio_path.exists()) and cue_asset is not None and cue_asset.meta:
            audio_aid = cue_asset.meta.get("audio_asset_id")
            if audio_aid:
                try:
                    master_a = await db.get(Asset, uuid.UUID(audio_aid))
                    if master_a is not None and master_a.deleted_at is None:
                        cand_p = storage.resolve(master_a.storage_key)
                        if cand_p.is_file():
                            audio_path = cand_p
                except Exception:
                    pass

        # 2.2 尝试从所属 CUE 资产磁盘内容解析并定位
        if (audio_path is None or not audio_path.exists()) and cue_asset is not None:
            from app.domains.music.cue import detect_and_read_cue, parse_cue_sheet, resolve_audio_file

            try:
                cue_path = storage.resolve(cue_asset.storage_key)
                content = detect_and_read_cue(cue_path)
                if content:
                    sheet = parse_cue_sheet(content)
                    audio_path = resolve_audio_file(cue_path, sheet)
            except Exception:
                pass

        # 3. 尝试在数据库中查找同存储目录下的母带音频资产
        if (audio_path is None or not audio_path.exists()) and cue_asset is not None:
            if ":" in cue_asset.storage_key:
                alias, rel = cue_asset.storage_key.split(":", 1)
                dir_part = posixpath.dirname(rel)
                prefix = f"{alias}:{dir_part}/" if dir_part else f"{alias}:"
                siblings = (await db.execute(
                    select(Asset).where(
                        Asset.asset_type == "music",
                        Asset.storage_key.startswith(prefix),
                        Asset.id != cue_asset.id,
                        Asset.deleted_at.is_(None),
                    )
                )).scalars().all()
                for sib in siblings:
                    if ext_of(sib.file_name).lstrip(".").lower() != "cue":
                        try:
                            cand_p = storage.resolve(sib.storage_key)
                            if cand_p.is_file():
                                audio_path = cand_p
                                break
                        except Exception:
                            pass

        # 4. 尝试根据 CUE 中声明的文件名或主干在库内全局资产中匹配
        if (audio_path is None or not audio_path.exists()) and cue_asset is not None:
            from app.domains.music.cue import detect_and_read_cue, parse_cue_sheet

            try:
                cue_path = storage.resolve(cue_asset.storage_key)
                content = detect_and_read_cue(cue_path)
                target_names: list[str] = []
                if content:
                    sheet = parse_cue_sheet(content)
                    for f in sheet.files:
                        pure_name = f.replace("\\", "/").split("/")[-1].strip()
                        if pure_name:
                            target_names.append(pure_name)
                target_names.append(cue_asset.file_name)

                for t_name in target_names:
                    t_stem = Path(t_name).stem.lower()
                    cands = (await db.execute(
                        select(Asset).where(
                            Asset.asset_type == "music",
                            Asset.id != cue_asset.id,
                            Asset.deleted_at.is_(None),
                        )
                    )).scalars().all()
                    for cand_a in cands:
                        c_name = cand_a.file_name.lower()
                        c_stem = Path(c_name).stem.lower()
                        c_ext = ext_of(c_name).lstrip(".").lower()
                        if c_ext != "cue" and (c_name == t_name.lower() or c_stem == t_stem or t_stem in c_stem or c_stem in t_stem):
                            try:
                                cand_p = storage.resolve(cand_a.storage_key)
                                if cand_p.is_file():
                                    audio_path = cand_p
                                    break
                            except Exception:
                                pass
                    if audio_path and audio_path.is_file():
                        break
            except Exception:
                pass

        if audio_path is None or not audio_path.exists():
            log.warning("CUE track %s stream failed: master audio file not found", a.id)
            raise not_found("关联的母带音频文件不存在")

        # 命中后回填缓存路径，提升后续切片点播性能
        if audio_path and a.meta.get("audio_path") != str(audio_path):
            try:
                a.meta = {**a.meta, "audio_path": str(audio_path)}
                await db.commit()
            except Exception:
                pass

        fmt = a.meta.get("format") or "mp3"
        sliced = ensure_cue_track_stream(
            audio_path=audio_path,
            cue_asset_id=cue_asset_id or str(a.id),
            track_no=track_no,
            start_ms=start_ms,
            end_ms=end_ms,
            original=original,
            audio_format=fmt,
        )
        if sliced is None or not sliced.exists():
            raise not_found("生成分轨音频切片失败")

        out_ext = sliced.suffix.lstrip(".").lower()
        media_type = "audio/mpeg" if out_ext == "mp3" else (mime_of(f"x.{out_ext}") or "application/octet-stream")
        return FileResponse(
            sliced,
            media_type=media_type,
            content_disposition_type="inline",
        )

    src_path = storage.resolve(a.storage_key)

    # 针对非浏览器原生播放格式（DTS/APE/DSF/DFF/WMA/ALAC/AIFF 等）或多声道环绕声音频，在非强制原始串流时，转码/读取下混立体声 MP3 以供浏览器 audio 标签平滑播放
    from app.domains.music.parser import NEED_TRANSCODE

    needs_transcode = (
        ext in NEED_TRANSCODE
        or (a.meta and (a.meta.get("surround") in ("5.1", "7.1", "4.0") or (a.meta.get("channels") and a.meta["channels"] > 2)))
    )
    if needs_transcode and not original:
        from app.domains.music.transcode import ensure_transcoded_stream

        preview = ensure_transcoded_stream(src_path, str(a.id))
        if preview is not None and preview.is_file():
            base_stem = a.file_name.rsplit(".", 1)[0]
            return FileResponse(
                preview,
                filename=f"{base_stem}.mp3",
                media_type="audio/mpeg",
                content_disposition_type="inline",
            )

    media_type = a.mime_type or mime_of(a.file_name) or "audio/mpeg"
    return FileResponse(
        src_path,
        filename=a.file_name,
        media_type=media_type,
        content_disposition_type="inline",
    )
