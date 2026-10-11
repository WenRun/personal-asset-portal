"""音频转码与串流派生：DTS / 多声道无损音频下混立体声 MP3 串流缓存。"""

import os
import subprocess
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.models import Asset
from app.core.pipeline import build_storage, register, roots_of


def derived_music_dir(asset_id: str) -> Path:
    return Path(get_settings().data_root) / "derived" / "music" / asset_id


def ensure_transcoded_stream(storage_path: Path, asset_id: str) -> Path | None:
    """确保存在兼容现代浏览器的立体声 320kbps MP3 串流文件（支持 Range 寻道播放）。"""
    out_dir = derived_music_dir(asset_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / "stream.mp3"

    if out_file.exists() and out_file.stat().st_size > 0:
        return out_file

    tmp_file = out_dir / "stream.mp3.tmp"
    cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-i", str(storage_path),
        "-vn",
        "-c:a", "libmp3lame",
        "-b:a", "320k",
        "-ac", "2",
        "-f", "mp3",
        str(tmp_file),
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        if res.returncode == 0 and tmp_file.exists() and tmp_file.stat().st_size > 0:
            os.replace(tmp_file, out_file)
            return out_file
    except Exception:
        pass
    finally:
        if tmp_file.exists():
            try:
                tmp_file.unlink()
            except Exception:
                pass

    return None


@register("derive:music_stream")
async def derive_music_stream(db: AsyncSession, payload: dict) -> None:
    """后台任务：为 DTS / 环绕声音频预先派生 stream.mp3，避免首次播放等待。"""
    asset_id = payload.get("asset_id")
    if not asset_id:
        return
    asset = await db.get(Asset, asset_id)
    if asset is None or asset.deleted_at is not None:
        return

    storage = build_storage(await roots_of(db))
    src_path = storage.resolve(asset.storage_key)
    if src_path.exists():
        ensure_transcoded_stream(src_path, str(asset.id))


def ensure_cue_track_stream(
    audio_path: Path,
    cue_asset_id: str,
    track_no: int,
    start_ms: int,
    end_ms: int | None = None,
    original: bool = False,
    audio_format: str = "mp3",
) -> Path | None:
    """确保存在 CUE 分轨的切片音频文件（默认 320k 立体声 MP3，支持 Range 寻道；或原格式切片）。"""
    out_dir = derived_music_dir(cue_asset_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    ext = audio_format.lstrip(".").lower() if original else "mp3"
    out_file = out_dir / f"track_{track_no:02d}.{ext}"

    if out_file.exists() and out_file.stat().st_size > 0:
        return out_file

    if not audio_path.exists():
        return None

    tmp_file = out_dir / f"track_{track_no:02d}.{ext}.tmp"
    start_sec = max(0.0, start_ms / 1000.0)

    cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-ss", f"{start_sec:.3f}",
    ]
    if end_ms is not None and end_ms > start_ms:
        duration_sec = (end_ms - start_ms) / 1000.0
        cmd.extend(["-t", f"{duration_sec:.3f}"])

    cmd.extend(["-i", str(audio_path), "-vn"])

    if not original or ext == "mp3":
        cmd.extend(["-c:a", "libmp3lame", "-b:a", "320k", "-ac", "2", "-f", "mp3", str(tmp_file)])
    elif ext in ("flac", "wav"):
        cmd.extend(["-c:a", "copy", str(tmp_file)])
    else:
        cmd.extend(["-c:a", "copy", str(tmp_file)])

    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if res.returncode == 0 and tmp_file.exists() and tmp_file.stat().st_size > 0:
            os.replace(tmp_file, out_file)
            return out_file
        # 若 copy 切片失败（部分特定容器不兼容），尝试转为 flac 或 mp3
        if original and ext not in ("mp3",):
            fallback_cmd = [
                "ffmpeg", "-y", "-v", "error",
                "-ss", f"{start_sec:.3f}",
            ]
            if end_ms is not None and end_ms > start_ms:
                fallback_cmd.extend(["-t", f"{(end_ms - start_ms) / 1000.0:.3f}"])
            fallback_cmd.extend(["-i", str(audio_path), "-vn", "-c:a", "flac", str(tmp_file)])
            res = subprocess.run(fallback_cmd, capture_output=True, text=True, timeout=120)
            if res.returncode == 0 and tmp_file.exists() and tmp_file.stat().st_size > 0:
                os.replace(tmp_file, out_file)
                return out_file
    except Exception:
        pass
    finally:
        if tmp_file.exists():
            try:
                tmp_file.unlink()
            except Exception:
                pass

    return None


@register("derive:cue_slices")
async def derive_cue_slices(db: AsyncSession, payload: dict) -> None:
    """后台任务：预先将 CUE 专辑各音轨切片缓存，确保在线点播秒级响应。"""
    from sqlalchemy import select

    cue_asset_id = payload.get("cue_asset_id")
    if not cue_asset_id:
        return
    cue_asset = await db.get(Asset, cue_asset_id)
    if cue_asset is None or cue_asset.deleted_at is not None:
        return

    rows = (await db.execute(
        select(Asset).where(
            Asset.meta["cue_asset_id"].astext == str(cue_asset.id),
            Asset.deleted_at.is_(None),
        )
    )).scalars().all()

    for child in rows:
        audio_path_str = child.meta.get("audio_path")
        if not audio_path_str:
            continue
        audio_path = Path(audio_path_str)
        if not audio_path.is_file():
            continue
        track_no = child.meta.get("track_no", 1)
        start_ms = child.meta.get("start_ms", 0)
        end_ms = child.meta.get("end_ms")
        audio_fmt = child.meta.get("format", "mp3")
        ensure_cue_track_stream(audio_path, str(cue_asset.id), track_no, start_ms, end_ms, original=False, audio_format=audio_fmt)
