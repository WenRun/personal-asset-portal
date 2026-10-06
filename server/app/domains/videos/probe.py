"""视频探测与封面帧（详细设计 §5.3）：ffprobe JSON + ffmpeg 抽帧；Direct Play 判定。"""

import json
import subprocess
from pathlib import Path

PLAYABLE_VIDEO = {"h264", "hevc", "vp8", "vp9", "av1"}
PLAYABLE_AUDIO = {"aac", "mp3", "opus", "flac", "vorbis"}
PLAYABLE_CONTAINER = {"mp4", "m4v", "mov", "webm"}


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


def probe_video(path: Path) -> dict:
    """返回 video_details 所需字段 + meta.streams_raw 节选。"""
    data = ffprobe(path)
    if data is None:
        return {"fields": {}, "meta": {"parse_warning": "ffprobe 不可用或文件无法解析"}, "streamable": False}

    vstream = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    astream = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)
    fmt = data.get("format", {})
    container = (fmt.get("format_name") or "").split(",")[0]
    vcodec = vstream.get("codec_name") if vstream else None
    acodec = astream.get("codec_name") if astream else None
    duration_ms = int(float(fmt.get("duration") or 0) * 1000) or None
    width = vstream.get("width") if vstream else None
    height = vstream.get("height") if vstream else None

    streamable = container in PLAYABLE_CONTAINER and vcodec in PLAYABLE_VIDEO and (acodec in PLAYABLE_AUDIO or astream is None)

    fields = {
        "duration_ms": duration_ms,
        "width": width, "height": height,
        "container": container,
        "video_codec": vcodec, "audio_codec": acodec,
        "streamable": streamable,
    }
    meta = {
        "streams_raw": {
            "video": vcodec, "audio": acodec,
            "pix_fmt": (vstream or {}).get("pix_fmt"),
            "bit_rate": fmt.get("bit_rate"),
        },
    }
    return {"fields": fields, "meta": meta, "streamable": streamable}


def extract_cover_frames(path: Path, duration_ms: int | None, out_dir: Path) -> list[Path]:
    """按 10%/35%/60% 抽 3 张候选帧 → cover_1..3.webp（临时文件原子改名）。"""
    out_dir.mkdir(parents=True, exist_ok=True)
    total = (duration_ms or 0) / 1000
    positions = [0.1, 0.35, 0.6] if total > 3 else [0.0]
    written: list[Path] = []
    for i, pct in enumerate(positions, 1):
        target = out_dir / f"cover_{i}.jpg"
        tmp = out_dir / f".cover_{i}.tmp.jpg"
        try:
            r = subprocess.run(
                ["ffmpeg", "-y", "-v", "quiet", "-ss", f"{max(0, total * pct)}", "-i", str(path),
                 "-frames:v", "1", "-vf", "scale=640:-2", str(tmp)],
                capture_output=True, timeout=60,
            )
            if r.returncode == 0 and tmp.is_file():
                tmp.replace(target)
                written.append(target)
        except (subprocess.TimeoutExpired, FileNotFoundError):
            continue
    return written
