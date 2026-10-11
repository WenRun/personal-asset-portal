"""音乐入库解析（详细设计 §5.2）：mutagen 统一标签 → 艺术家/专辑/曲目三级聚合 + 内嵌封面。"""

import posixpath
import subprocess
from pathlib import Path

from mutagen import File as MutagenFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import Asset, MusicAlbum, MusicArtist, MusicTrack
from app.core.pipeline import build_storage, register, roots_of
from app.core.registry import ext_of

PLAYABLE = {
    "mp3", "flac", "m4a", "ogg", "oga", "wav", "opus", "webm",
    "dts", "dtshd", "ape", "dsf", "dff", "aiff", "aif", "wma", "alac",
}

NEED_TRANSCODE = {
    "dts", "dtshd", "ape", "dsf", "dff", "aiff", "aif", "wma", "alac",
}


def _frame_value(first) -> str | None:
    """ID3 帧对象（.text 可为 list 或 str）/ 普通值统一取字符串。"""
    if hasattr(first, "text"):
        tx = first.text
        if isinstance(tx, (list, tuple)):
            return str(tx[0]) if tx else None
        return str(tx) if tx else None
    return str(first) if first is not None else None


def _get(tags, *keys) -> str | None:
    """按别名序取标签：easy 名 → ID3 帧 → MP4 atom → Vorbis 小写；ID3 帧键支持前缀匹配（如 USLT::chi）。"""
    if tags is None:
        return None
    all_keys = set(tags.keys()) if hasattr(tags, "keys") else set()
    for k in keys:
        candidates = [k] + [key for key in all_keys if key.startswith(k + ":")]
        for ck in candidates:
            try:
                v = tags.get(ck)
            except Exception:  # noqa: BLE001
                continue
            if not v:
                continue
            first = v[0] if isinstance(v, (list, tuple)) else v
            s = _frame_value(first)
            if s and s.strip():
                return s.strip()
    return None


def _cover_bytes(m) -> bytes | None:
    if hasattr(m, "pictures") and m.pictures:  # FLAC / OGG / Opus
        return m.pictures[0].data
    tags = getattr(m, "tags", None)
    if tags is None:
        return None
    if hasattr(tags, "getall"):  # ID3（mp3 / wav / aiff / dsf）
        apic = tags.getall("APIC")
        if apic:
            return apic[0].data
    try:
        if "covr" in tags:  # MP4 / M4A / ALAC
            return bytes(tags["covr"][0])
    except Exception:  # noqa: BLE001
        pass
    # APEv2 标签封面
    for k in ("Cover Art (Front)", "Cover Art (Back)", "Cover Art"):
        if hasattr(tags, "get") and k in tags:
            try:
                val = tags[k].value if hasattr(tags[k], "value") else bytes(tags[k])
                if b"\0" in val:
                    return val.split(b"\0", 1)[1]
                return val
            except Exception:
                pass
    return None


def _extract_attached_pic(path: Path) -> bytes | None:
    """万能内嵌封面兜底：通过 ffmpeg 提取音频流附带的封面图像（支持 APE / WMA / AIFF / DSF 等）。"""
    try:
        res = subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", str(path), "-an", "-vcodec", "copy", "-f", "image2", "pipe:1"],
            capture_output=True, timeout=8,
        )
        if res.returncode == 0 and len(res.stdout) > 128:
            return res.stdout
    except Exception:
        pass
    return None


@register("parse:music")
async def parse_music(db: AsyncSession, payload: dict) -> None:
    asset = await db.get(Asset, payload["asset_id"])
    if asset is None:
        return

    storage = build_storage(await roots_of(db))
    path = storage.resolve(asset.storage_key)
    ext = ext_of(asset.file_name).lstrip(".")

    meta: dict = {"ext": ext, "streamable": ext in PLAYABLE}
    fields: dict = {"format": ext, "streamable": ext in PLAYABLE}
    title = artist = album = None
    year = None
    cover_bytes = None
    cover_ext = "jpg"

    try:
        m = MutagenFile(str(path), easy=True)
        if m is not None and m.info is not None:
            fields["duration_ms"] = int(m.info.length * 1000)
            bitrate = getattr(m.info, "bitrate", None)
            if bitrate:
                fields["bitrate_kbps"] = int(bitrate // 1000)
            sr = getattr(m.info, "sample_rate", None)
            if sr:
                fields["sample_rate_hz"] = int(sr)
        if m is not None and m.tags:
            title = _get(m.tags, "title", "TIT2", "©nam")
            artist = _get(m.tags, "artist", "TPE1", "©ART")
            album = _get(m.tags, "album", "TALB", "©alb")
            date = _get(m.tags, "date", "TDRC", "TYER", "©day")
            year = int(date[:4]) if date and date[:4].isdigit() else None
            tn = _get(m.tags, "tracknumber", "TRCK", "trkn")
            if tn:
                try:
                    fields["track_no"] = int(str(tn).split("/")[0].strip("( "))
                except ValueError:
                    pass
            lyrics = _get(m.tags, "lyrics", "USLT", "USLT::chi", "©lyr")
            if lyrics:
                fields["has_lyrics"] = True
                meta["lyrics"] = str(lyrics)[:8000]
            genre = _get(m.tags, "genre", "TCON", "©gen")
            if genre:
                meta["genre"] = str(genre)
            cover_bytes = _cover_bytes(m)
    except Exception as exc:  # noqa: BLE001  非音频/损坏文件：兜底 + 警告
        meta["parse_warning"] = f"{type(exc).__name__}: {exc}"

    # mutagen 无法解析、需要转码派生或缺失关键元数据时，走 ffprobe 音频探测补充流级信息
    if ext in NEED_TRANSCODE or fields.get("duration_ms") is None or fields.get("sample_rate_hz") is None:
        try:
            from app.domains.music.probe import probe_audio

            probed = probe_audio(path)
            if probed:
                if probed.get("duration_ms") and not fields.get("duration_ms"):
                    fields["duration_ms"] = probed["duration_ms"]
                if probed.get("bitrate_kbps") and not fields.get("bitrate_kbps"):
                    fields["bitrate_kbps"] = probed["bitrate_kbps"]
                if probed.get("sample_rate_hz") and not fields.get("sample_rate_hz"):
                    fields["sample_rate_hz"] = probed["sample_rate_hz"]
                if fields.get("sample_rate_hz") and fields["sample_rate_hz"] >= 2822400:
                    sr = fields["sample_rate_hz"]
                    meta["dsd_rate"] = "DSD64" if sr <= 3000000 else ("DSD128" if sr <= 6000000 else "DSD256")
                if probed.get("channels"):
                    meta["channels"] = probed["channels"]
                if probed.get("channel_layout"):
                    meta["channel_layout"] = probed["channel_layout"]
                if probed.get("surround"):
                    meta["surround"] = probed["surround"]
                if probed.get("codec_name"):
                    meta["audio_codec"] = probed["codec_name"]
                if probed.get("profile"):
                    meta["profile"] = probed["profile"]
                if not title and probed.get("title"):
                    title = probed["title"]
                if not artist and probed.get("artist"):
                    artist = probed["artist"]
                if not album and probed.get("album"):
                    album = probed["album"]
                if year is None and probed.get("year"):
                    year = probed["year"]
                if "track_no" not in fields and probed.get("track_no"):
                    fields["track_no"] = probed["track_no"]
                if "has_lyrics" not in fields and probed.get("lyrics"):
                    fields["has_lyrics"] = True
                    meta["lyrics"] = str(probed["lyrics"])[:8000]
                if "genre" not in meta and probed.get("genre"):
                    meta["genre"] = str(probed["genre"])
        except Exception as exc:  # noqa: BLE001
            meta["probe_warning"] = f"probe_audio failed: {exc}"

    # 内嵌封面提取兜底：mutagen 未能解析时通过 ffmpeg 提取流级内嵌附图
    if cover_bytes is None:
        cover_bytes = _extract_attached_pic(path)

    # 内嵌封面缺失时，尝试同目录下的常见封面图（如 cover.jpg / folder.jpg）
    if cover_bytes is None and path.parent.is_dir():
        for cand_name in ("cover.jpg", "cover.png", "cover.jpeg", "folder.jpg", "folder.png", "front.jpg", "front.png"):
            cand = path.parent / cand_name
            if cand.is_file():
                try:
                    cover_bytes = cand.read_bytes()
                    cover_ext = cand.suffix.lstrip(".").lower() or "jpg"
                    break
                except Exception:
                    pass

    # 无标签 → 目录/文件名兜底（详细设计 §5.2）
    rel = asset.storage_key.split(":", 1)[1]
    parts = rel.split("/")
    asset.title = title or asset.title or asset.file_name.rsplit(".", 1)[0]
    artist_name = artist or (parts[0] if len(parts) > 2 else None) or "未知艺术家"
    album_name = album or (parts[-2] if len(parts) > 2 else None) or "未知专辑"
    asset.meta = {**asset.meta, **meta}
    asset.status = "ready"

    # 三级聚合：按名字归一 upsert
    arow = (await db.execute(select(MusicArtist).where(MusicArtist.name == artist_name))).scalar_one_or_none()
    if arow is None:
        arow = MusicArtist(name=artist_name)
        db.add(arow)
        await db.flush()
    alrow = (
        await db.execute(
            select(MusicAlbum).where(MusicAlbum.artist_id == arow.id, MusicAlbum.name == album_name)
        )
    ).scalar_one_or_none()
    if alrow is None:
        alrow = MusicAlbum(artist_id=arow.id, name=album_name, year=year)
        db.add(alrow)
        await db.flush()
    elif alrow.year is None and year:
        alrow.year = year

    trow = await db.get(MusicTrack, asset.id)
    if trow is None:
        trow = MusicTrack(asset_id=asset.id)
        db.add(trow)
    for k, v in {**fields, "album_id": alrow.id, "artist_id": arow.id}.items():
        setattr(trow, k, v)

    await db.commit()
    from app.core.jobs import enqueue

    if cover_bytes is not None:
        from app.domains.music.thumbs import derived_dir

        out_dir = derived_dir(str(asset.id))
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / f"cover_src.{cover_ext}").write_bytes(cover_bytes)
        await enqueue(db, "derive:music_cover", {"asset_id": str(asset.id), "album_id": str(alrow.id)}, priority=5)
    needs_stream_transcode = (
        ext in NEED_TRANSCODE
        or meta.get("surround") in ("5.1", "7.1", "4.0")
        or (meta.get("channels") and meta["channels"] > 2)
    )
    if needs_stream_transcode:
        await enqueue(db, "derive:music_stream", {"asset_id": str(asset.id)}, priority=6)
    await enqueue(db, "index_meili", {"asset_id": str(asset.id)}, priority=8)
