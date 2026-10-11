"""CUE 分轨索引核心解析器与多编码容错探测模块。

负责：
1. 字符编码自适应探测（UTF-8, GB18030, Big5, Shift-JIS, Latin-1）。
2. CUE Sheet 结构化语法解析（Album/Artist/Year/Genre, Tracks, INDEX 00/01 时间码换算）。
3. 关联母带音频文件智能解析与模糊定位。
4. 音频元数据内嵌 CUESHEET 标签提取。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

# 支持的母带音频格式扩展名
AUDIO_EXTS: tuple[str, ...] = (
    ".flac", ".ape", ".wav", ".dts", ".dtshd",
    ".dsf", ".dff", ".aiff", ".aif", ".opus",
    ".wma", ".alac", ".m4a", ".mp3", ".ogg",
)


@dataclass
class CueTrack:
    track_no: int
    title: str
    performer: str | None = None
    index00_ms: int | None = None
    index01_ms: int = 0
    start_ms: int = 0
    end_ms: int | None = None
    duration_ms: int | None = None
    file_name: str | None = None


@dataclass
class CueSheet:
    title: str | None = None
    performer: str | None = None
    date: int | None = None
    genre: str | None = None
    disc_id: str | None = None
    files: list[str] = field(default_factory=list)
    tracks: list[CueTrack] = field(default_factory=list)


def detect_and_read_cue(path: Path) -> str | None:
    """以多重编码降级策略读取 CUE 文件内容。"""
    if not path.is_file():
        return None
    try:
        raw_bytes = path.read_bytes()
    except Exception:
        return None

    encodings = ("utf-8-sig", "utf-8", "gb18030", "big5", "shift_jis", "cp1252", "latin1")
    for enc in encodings:
        try:
            return raw_bytes.decode(enc)
        except UnicodeDecodeError:
            continue
    try:
        return raw_bytes.decode("utf-8", errors="replace")
    except Exception:
        return None


def timecode_to_ms(tc: str) -> int:
    """将 CUE 时间码 MM:SS:FF（每秒75帧）换算为毫秒。"""
    parts = tc.strip().split(":")
    if len(parts) == 2:
        minutes, seconds = int(parts[0]), int(parts[1])
        frames = 0
    elif len(parts) >= 3:
        minutes, seconds, frames = int(parts[0]), int(parts[1]), int(parts[2])
    else:
        return 0
    return (minutes * 60 + seconds) * 1000 + int(round(frames * 1000 / 75.0))


def _unquote(val: str) -> str:
    val = val.strip()
    if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
        return val[1:-1].strip()
    return val


def parse_cue_sheet(content: str) -> CueSheet:
    """解析 CUE Sheet 文本，提取专辑级信息、音频文件引用以及各曲目分轨。"""
    sheet = CueSheet()
    current_file: str | None = None
    current_track: CueTrack | None = None

    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        # 注释与 REM 字段
        rem_m = re.match(r"^REM\s+(\w+)\s+(.+)$", line, re.IGNORECASE)
        if rem_m:
            key, val = rem_m.group(1).upper(), _unquote(rem_m.group(2))
            if key in ("DATE", "YEAR"):
                year_digits = re.search(r"\d{4}", val)
                if year_digits:
                    sheet.date = int(year_digits.group(0))
            elif key == "GENRE":
                sheet.genre = val
            elif key == "DISCID":
                sheet.disc_id = val
            continue

        # FILE 命令
        file_m = re.match(r'^FILE\s+(.+?)\s+(\w+)$', line, re.IGNORECASE)
        if file_m:
            current_file = _unquote(file_m.group(1))
            if current_file not in sheet.files:
                sheet.files.append(current_file)
            continue

        # TRACK 命令
        track_m = re.match(r"^TRACK\s+(\d+)\s+AUDIO", line, re.IGNORECASE)
        if track_m:
            t_no = int(track_m.group(1))
            current_track = CueTrack(
                track_no=t_no,
                title=f"Track {t_no:02d}",
                performer=sheet.performer,
                file_name=current_file,
            )
            sheet.tracks.append(current_track)
            continue

        # 曲目内部字段
        if current_track is not None:
            if line.upper().startswith("TITLE"):
                val = _unquote(line[5:])
                if val:
                    current_track.title = val
                continue
            if line.upper().startswith("PERFORMER"):
                val = _unquote(line[9:])
                if val:
                    current_track.performer = val
                continue
            idx00_m = re.match(r"^INDEX\s+00\s+([\d:]+)", line, re.IGNORECASE)
            if idx00_m:
                current_track.index00_ms = timecode_to_ms(idx00_m.group(1))
                continue
            idx01_m = re.match(r"^INDEX\s+01\s+([\d:]+)", line, re.IGNORECASE)
            if idx01_m:
                current_track.index01_ms = timecode_to_ms(idx01_m.group(1))
                current_track.start_ms = current_track.index01_ms
                continue
        else:
            # 专辑全局字段
            if line.upper().startswith("TITLE"):
                val = _unquote(line[5:])
                if val:
                    sheet.title = val
                continue
            if line.upper().startswith("PERFORMER"):
                val = _unquote(line[9:])
                if val:
                    sheet.performer = val
                continue

    # 计算曲目起止时间与时长（最后一首需后续结合音频真实总时长填充）
    for i, trk in enumerate(sheet.tracks):
        trk.start_ms = trk.index01_ms
        if i + 1 < len(sheet.tracks):
            next_trk = sheet.tracks[i + 1]
            # 若下首曲目具备 INDEX 00 前间隙且在该曲之后，优先作为分界
            if next_trk.index00_ms is not None and next_trk.index00_ms > trk.start_ms:
                trk.end_ms = next_trk.index00_ms
            else:
                trk.end_ms = next_trk.index01_ms
            if trk.end_ms is not None and trk.end_ms >= trk.start_ms:
                trk.duration_ms = trk.end_ms - trk.start_ms

    return sheet


def resolve_audio_file(cue_path: Path, sheet: CueSheet) -> Path | None:
    """多级容错定位 CUE 对应的母带音频文件。"""
    folder = cue_path.parent
    if not folder.is_dir():
        return None

    # 1. 尝试 CUE 内记录的 FILE 命令文件名（精确匹配）
    for f in sheet.files:
        cand = folder / f
        if cand.is_file():
            return cand
        # 大小写不敏感匹配
        for sibling in folder.iterdir():
            if sibling.is_file() and sibling.name.lower() == f.lower():
                return sibling

    # 2. 尝试 CUE 内 FILE 文件名主干替换为已支持音频扩展名（常见如 CUE 记录 .wav 实际压制为 .flac/.ape）
    for f in sheet.files:
        f_stem = Path(f).stem.lower()
        for sibling in folder.iterdir():
            if sibling.is_file() and sibling.stem.lower() == f_stem and sibling.suffix.lower() in AUDIO_EXTS:
                return sibling

    # 3. 尝试与 CUE 同名主干的音频文件（如 Jay.cue 匹配 Jay.flac / Jay.ape）
    cue_stem = cue_path.stem.lower()
    for sibling in folder.iterdir():
        if sibling.is_file() and sibling.stem.lower() == cue_stem and sibling.suffix.lower() in AUDIO_EXTS:
            return sibling

    # 4. 同目录下唯一音频文件容错绑定
    audio_candidates = [
        p for p in folder.iterdir()
        if p.is_file() and p.suffix.lower() in AUDIO_EXTS and p.suffix.lower() != ".cue"
    ]
    if len(audio_candidates) == 1:
        return audio_candidates[0]

    return None


def extract_embedded_cuesheet(tags: object) -> str | None:
    """从音频标签（FLAC/APE/ID3 等）中提取内嵌 CUESHEET 文本。"""
    if tags is None:
        return None
    cand_keys = ("cuesheet", "CUESHEET", "cuesheet_file", "CUE_SHEET")
    for k in cand_keys:
        if hasattr(tags, "get"):
            val = tags.get(k)
            if val:
                if isinstance(val, (list, tuple)) and len(val) > 0:
                    val = val[0]
                if isinstance(val, bytes):
                    try:
                        return val.decode("utf-8")
                    except UnicodeDecodeError:
                        try:
                            return val.decode("gb18030")
                        except Exception:
                            pass
                elif isinstance(val, str) and "TRACK" in val:
                    return val
    return None
