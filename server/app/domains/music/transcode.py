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
