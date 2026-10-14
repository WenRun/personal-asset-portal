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


def normalize_track_title_and_artist(
    title: str | None,
    artist: str | None = None,
) -> tuple[str, str | None]:
    """清洗曲目标题与歌手信息：
    1. 清除冗余音轨号前缀（如 '01. '、'02 - '）
    2. 若已知歌手，精准剥离标题中前置或后置的歌手名字（如 '稻香 - 周杰伦'、'独角戏 - 许茹芸-'、'周杰伦 - 稻香'）
    3. 若歌手未知，启发式拆分 'A - B' 结构，识别纯歌名与歌手
    返回 (clean_title, clean_artist)。
    """
    if not title:
        return ("", artist)
    text = title.strip()

    # 1. 清洗音轨序号前缀 (如 "01. ", "02 - ", "03、")
    cleaned = re.sub(r"^\s*\d{1,3}(?:\s*[-._、．]\s*|\s+)", "", text).strip()
    candidate = cleaned if cleaned else text

    # 2. 如果已知 artist，尝试匹配并剥离
    if artist and artist.strip() not in ("未知艺术家", "Unknown Artist", "Unknown", "群星", "Various Artists"):
        art_clean = artist.strip()
        art_candidates = [art_clean]
        for sub in re.split(r"[/&,、]|(?:\s+(?:feat\.?|ft\.?|with|vs\.?)\s+)", art_clean, flags=re.IGNORECASE):
            s = sub.strip()
            if len(s) >= 2 and s not in art_candidates:
                art_candidates.append(s)
        art_candidates.sort(key=len, reverse=True)

        for art in art_candidates:
            escaped = re.escape(art)
            # 2.1 后置歌手: 歌名 - 歌手 [尾部可能有冗余连字符/空格]
            post_pattern = rf"(?:[\s\-_—－~·/]+|\s+){escaped}[\s\-_—－~·]*$"
            m_post = re.search(post_pattern, candidate, flags=re.IGNORECASE)
            if m_post and m_post.start() > 0:
                stripped = candidate[:m_post.start()].strip(" -_—－~·")
                if stripped:
                    return (stripped, artist)

            # 2.2 前置歌手: 歌手 - 歌名
            pre_pattern = rf"^[\s\-_—－~·]*{escaped}(?:[\s\-_—－~·]+|\s+)"
            m_pre = re.search(pre_pattern, candidate, flags=re.IGNORECASE)
            if m_pre and m_pre.end() < len(candidate):
                stripped = candidate[m_pre.end():].strip(" -_—－~·")
                if stripped:
                    return (stripped, artist)

    # 3. 未知 artist 或未匹配上已知 artist 时，启发式检测 A - B 结构
    sep_match = re.search(r"\s+[-_—－~·]\s+|\s*[-—－]\s*", candidate)
    if sep_match:
        part_a = candidate[:sep_match.start()].strip()
        part_b = candidate[sep_match.end():].strip(" -_—－~·")
        if part_a and part_b:
            title_features = r"[（(].*?(?:主题曲|片尾曲|插曲|电影|电视剧|Remix|Live|伴奏|原声|Cover|翻唱|版)[)）]|《.*?》|\[.*?\]"
            has_feat_a = bool(re.search(title_features, part_a, flags=re.IGNORECASE))
            has_feat_b = bool(re.search(title_features, part_b, flags=re.IGNORECASE))
            artist_features = r"&|feat\.?|ft\.?|与|和"
            has_art_a = bool(re.search(artist_features, part_a, flags=re.IGNORECASE))
            has_art_b = bool(re.search(artist_features, part_b, flags=re.IGNORECASE))

            if (has_feat_a and not has_feat_b) or (has_art_b and not has_art_a):
                return (part_a, part_b if not artist or artist == "未知艺术家" else artist)
            if (has_feat_b and not has_feat_a) or (has_art_a and not has_art_b):
                return (part_b, part_a if not artist or artist == "未知艺术家" else artist)

    return (candidate, artist)


def normalize_track_title(title: str | None, artist: str | None = None) -> str:
    """清洗曲目标题中的冗余音轨号前缀与歌手名（无论歌手名在前还是在后）。"""
    clean_title, _ = normalize_track_title_and_artist(title, artist)
    return clean_title


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
                    art = current_track.performer or sheet.performer
                    current_track.title = normalize_track_title(val, art)
                continue
            if line.upper().startswith("PERFORMER"):
                val = _unquote(line[9:])
                if val:
                    current_track.performer = val
                    if current_track.title:
                        current_track.title = normalize_track_title(current_track.title, val)
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


def resolve_audio_file(cue_path: Path, sheet: CueSheet, track_file: str | None = None) -> Path | None:
    """多级容错定位 CUE 对应的母带音频文件。"""
    folder = cue_path.parent
    if not folder.is_dir():
        return None

    # 汇总待匹配的音频文件名列表（清洗 Windows 盘符与反斜杠路径）
    raw_files: list[str] = []
    if track_file:
        raw_files.append(track_file)
    for f in sheet.files:
        if f not in raw_files:
            raw_files.append(f)

    clean_targets: list[tuple[str, str]] = []  # (pure_name, pure_stem)
    for rf in raw_files:
        p_name = rf.replace("\\", "/").split("/")[-1].strip()
        if p_name:
            clean_targets.append((p_name.lower(), Path(p_name).stem.lower()))

    # 1. 尝试精确文件名匹配（不区分大小写）
    for p_name, _ in clean_targets:
        cand = folder / p_name
        if cand.is_file():
            return cand
        for sibling in folder.iterdir():
            if sibling.is_file() and sibling.name.lower() == p_name:
                return sibling

    # 2. 尝试 FILE 文件名主干替换为已支持音频扩展名（常见如 CUE 记录 .wav 实际压制为 .flac/.ape）
    for _, p_stem in clean_targets:
        for sibling in folder.iterdir():
            if sibling.is_file() and sibling.stem.lower() == p_stem and sibling.suffix.lower() in AUDIO_EXTS:
                return sibling

    # 3. 尝试与 CUE 同名主干的音频文件（如 Jay.cue 匹配 Jay.flac / Jay.ape）
    cue_stem = cue_path.stem.lower()
    for sibling in folder.iterdir():
        if sibling.is_file() and sibling.stem.lower() == cue_stem and sibling.suffix.lower() in AUDIO_EXTS:
            return sibling

    # 4. 尝试包含关系的模糊匹配（如 "Jay - Fantasy.cue" 匹配 "Fantasy.flac" 或 "CDImage.flac"）
    for sibling in folder.iterdir():
        if sibling.is_file() and sibling.suffix.lower() in AUDIO_EXTS and sibling.suffix.lower() != ".cue":
            s_stem = sibling.stem.lower()
            if s_stem and (s_stem in cue_stem or cue_stem in s_stem or "cdimage" in s_stem or "image" in s_stem):
                return sibling

    # 5. 目录下音频文件兜底：若有音频文件，优先选取体积最大的母带音频
    audio_candidates = [
        p for p in folder.iterdir()
        if p.is_file() and p.suffix.lower() in AUDIO_EXTS and p.suffix.lower() != ".cue"
    ]
    if audio_candidates:
        # 按文件大小倒序排序，最大的一般为整轨母带
        audio_candidates.sort(key=lambda p: p.stat().st_size, reverse=True)
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
