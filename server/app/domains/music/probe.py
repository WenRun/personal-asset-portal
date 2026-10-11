"""音频多格式探测：ffprobe JSON 深度探测（支持 DTS/DTS-HD/5.1环绕声/时长/采样率/声道数/码率与流级标签）。"""

import json
import subprocess
from pathlib import Path


def ffprobe(path: Path) -> dict | None:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", str(path)],
            capture_output=True, text=True, timeout=60,
        )
        if out.returncode != 0:
            return None
        return json.loads(out.stdout)
    except (subprocess.TimeoutExpired, json.JSONDecodeError, FileNotFoundError):
        return None


def probe_audio(path: Path) -> dict | None:
    """提取音频信息：时长、码率、采样率、声道数、声场布局、标签元数据。"""
    data = ffprobe(path)
    if data is None:
        return None

    astream = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)
    fmt = data.get("format", {})
    if astream is None and not fmt:
        return None

    # 时长毫秒
    dur_s = float(fmt.get("duration") or (astream.get("duration") if astream else 0) or 0)
    duration_ms = int(dur_s * 1000) if dur_s > 0 else None

    # 码率 kbps
    br = int(fmt.get("bit_rate") or (astream.get("bit_rate") if astream else 0) or 0)
    bitrate_kbps = int(br // 1000) if br > 0 else None

    codec_name = (astream.get("codec_name") if astream else None) or fmt.get("format_name")
    codec_long = astream.get("codec_long_name") if astream else None
    profile = astream.get("profile") if astream else None

    # 采样率（DSD 1-bit 音频在 ffprobe 中以字节采样率汇报，乘以 8 还原真实 DSD 采样率，如 352800*8 = 2822400Hz）
    sr = int((astream.get("sample_rate") if astream else 0) or 0)
    if sr > 0 and codec_name and ("dsd" in str(codec_name) or (fmt.get("format_name") and "dsf" in str(fmt["format_name"]))):
        sr = sr * 8
    sample_rate_hz = sr if sr > 0 else None

    # 声道数与声场布局
    channels = int((astream.get("channels") if astream else 0) or 0) or None
    channel_layout = (astream.get("channel_layout") if astream else None) or None
    surround = None
    if channels == 6 or "5.1" in (channel_layout or ""):
        surround = "5.1"
    elif channels == 8 or "7.1" in (channel_layout or ""):
        surround = "7.1"
    elif channels == 4:
        surround = "4.0"
    elif channels == 2:
        surround = "2.0"
    elif channels == 1:
        surround = "mono"

    # 聚合标签 (format tags + stream tags)
    raw_tags: dict = {}
    if isinstance(fmt.get("tags"), dict):
        raw_tags.update(fmt["tags"])
    if astream and isinstance(astream.get("tags"), dict):
        raw_tags.update(astream["tags"])

    # 大小写不敏感查找
    def _find_tag(*keys: str) -> str | None:
        low_keys = {k.lower() for k in keys}
        for k, v in raw_tags.items():
            if k.lower() in low_keys and v:
                s = str(v).strip()
                if s:
                    return s
        return None

    title = _find_tag("title", "tit2")
    artist = _find_tag("artist", "author", "tpe1", "album_artist", "composer")
    album = _find_tag("album", "talb")
    date_val = _find_tag("date", "year", "tyer", "tdrc")
    year = None
    if date_val and date_val[:4].isdigit():
        year = int(date_val[:4])
    track_val = _find_tag("track", "tracknumber", "trck")
    track_no = None
    if track_val:
        try:
            track_no = int(track_val.split("/")[0].strip("( "))
        except ValueError:
            pass
    genre = _find_tag("genre", "tcon")
    lyrics = _find_tag("lyrics", "unsyncedlyrics", "uslt")

    return {
        "duration_ms": duration_ms,
        "bitrate_kbps": bitrate_kbps,
        "sample_rate_hz": sample_rate_hz,
        "channels": channels,
        "channel_layout": channel_layout,
        "surround": surround,
        "codec_name": codec_name,
        "codec_long_name": codec_long,
        "profile": profile,
        "title": title,
        "artist": artist,
        "album": album,
        "year": year,
        "track_no": track_no,
        "genre": genre,
        "lyrics": lyrics,
    }
