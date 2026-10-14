"""CUE 音乐分轨（.cue）解析、多编码自适应、母带关联、音轨派生与切片串流测试。"""

import os
import shutil
import subprocess
import tempfile
import unittest
import uuid
from pathlib import Path
from dotenv import load_dotenv

# 加载开发环境 .env
load_dotenv(Path(__file__).parent.parent / ".env")

from sqlalchemy import select
from app.core.db import SessionLocal
from app.core.models import Asset, MusicAlbum, MusicArtist, MusicTrack
from app.core.registry import asset_type_of, ext_of, mime_of
from app.domains.music.cue import (
    CueSheet,
    detect_and_read_cue,
    normalize_track_title,
    normalize_track_title_and_artist,
    parse_cue_sheet,
    resolve_audio_file,
    timecode_to_ms,
)
from app.domains.music.transcode import ensure_cue_track_stream, derived_music_dir
from app.domains.music.parser import _parse_cue_asset


def create_test_tone_audio(path: Path, duration_sec: int = 6) -> None:
    """生成测试用音频文件（6秒 44.1kHz 双声道正弦波）。"""
    subprocess.run(
        [
            "ffmpeg", "-y", "-v", "error",
            "-f", "lavfi", "-i", f"sine=frequency=440:duration={duration_sec}",
            "-ar", "44100", "-ac", "2",
            str(path),
        ],
        check=True,
    )


class DummyStorage:
    def __init__(self, root: Path):
        self.root = root
        self.roots = {"main": root}

    def resolve(self, key: str) -> Path:
        if ":" in key:
            alias, rel = key.split(":", 1)
            if alias == "cue":
                from app.core.config import get_settings
                return (get_settings().data_root / "derived" / "music" / rel).resolve()
            if alias == "main":
                return (self.root / rel).resolve()
        return (self.root / key).resolve()


class TestCueMusicSupport(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp_dir = Path(tempfile.mkdtemp(prefix="cue_test_"))

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    async def asyncTearDown(self):
        from app.core.db import engine
        await engine.dispose()

    def test_registry_and_mime(self):
        """测试 .cue 格式正确注册在 music 资产类型下与 MIME 映射。"""
        self.assertEqual(asset_type_of("album.cue"), "music")
        self.assertEqual(asset_type_of("ALBUM.CUE"), "music")
        self.assertEqual(ext_of("disc.cue"), ".cue")
        self.assertEqual(mime_of("disc.cue"), "application/x-cue")

    def test_normalize_track_title(self):
        """测试曲目标题清洗规范（去除冗余数字/点号序号，以及前置/后置歌手名剥离）。"""
        # 1. 常见数字带点/分隔符模式
        self.assertEqual(normalize_track_title("01.你若无情休怪我无义"), "你若无情休怪我无义")
        self.assertEqual(normalize_track_title("02. 你的眼神出卖你的心"), "你的眼神出卖你的心")
        self.assertEqual(normalize_track_title("03 - 爱情骗子"), "爱情骗子")
        self.assertEqual(normalize_track_title("04-我还爱着你"), "我还爱着你")
        self.assertEqual(normalize_track_title("05_两个人的世界一个人睡"), "两个人的世界一个人睡")
        self.assertEqual(normalize_track_title("06、唱不完的情歌"), "唱不完的情歌")
        self.assertEqual(normalize_track_title("07．不想回家的女人"), "不想回家的女人")
        self.assertEqual(normalize_track_title("08 爱的供养"), "爱的供养")
        self.assertEqual(normalize_track_title("10.小三续集"), "小三续集")
        self.assertEqual(normalize_track_title("  09.  测试歌曲  "), "测试歌曲")

        # 2. 剥离后置歌手名（如 "歌名 - 歌手"、"独角戏 - 许茹芸-"）
        self.assertEqual(normalize_track_title("老人与海 - 海鸣威", "海鸣威"), "老人与海")
        self.assertEqual(normalize_track_title("第一次爱的人 - 王心凌", "王心凌"), "第一次爱的人")
        self.assertEqual(normalize_track_title("稻香 - 周杰伦", "周杰伦"), "稻香")
        self.assertEqual(normalize_track_title("秋天不回来 - 王强", "王强"), "秋天不回来")
        self.assertEqual(normalize_track_title("电台情歌 - 莫文蔚", "莫文蔚"), "电台情歌")
        self.assertEqual(normalize_track_title("独角戏 - 许茹芸-", "许茹芸"), "独角戏")
        self.assertEqual(normalize_track_title("浪花 - 刘德华", "刘德华"), "浪花")
        self.assertEqual(normalize_track_title("此时此刻 - 许巍", "许巍"), "此时此刻")
        self.assertEqual(normalize_track_title("浪人情歌 - 伍佰", "伍佰"), "浪人情歌")
        self.assertEqual(normalize_track_title("曲终人散 - 张宇", "张宇"), "曲终人散")
        self.assertEqual(normalize_track_title("拒绝再玩(超级混音版) - 张国荣", "张国荣"), "拒绝再玩(超级混音版)")
        self.assertEqual(normalize_track_title("情已逝 - 张学友", "张学友"), "情已逝")

        # 3. 剥离前置歌手名（如 "歌手 - 歌名"、"01. 歌手 - 歌名"）
        self.assertEqual(normalize_track_title("周杰伦 - 稻香", "周杰伦"), "稻香")
        self.assertEqual(normalize_track_title("01. 周杰伦 - 稻香", "周杰伦"), "稻香")
        self.assertEqual(normalize_track_title("02 - 稻香 - 周杰伦", "周杰伦"), "稻香")
        self.assertEqual(normalize_track_title("王菲 - 红豆", "王菲"), "红豆")

        # 4. 未知歌手启发式识别（如 "清澈见底(电影《快乐到家》主题曲) - 刀郎&云朵"）
        self.assertEqual(
            normalize_track_title("清澈见底(电影《快乐到家》主题曲) - 刀郎&云朵", "未知艺术家"),
            "清澈见底(电影《快乐到家》主题曲)",
        )
        t, a = normalize_track_title_and_artist("清澈见底(电影《快乐到家》主题曲) - 刀郎&云朵", "未知艺术家")
        self.assertEqual(t, "清澈见底(电影《快乐到家》主题曲)")
        self.assertEqual(a, "刀郎&云朵")

        # 5. 防误伤测试（真实歌名以数字开头，不应被截断）
        self.assertEqual(normalize_track_title("1984"), "1984")
        self.assertEqual(normalize_track_title("2002年的第一场雪"), "2002年的第一场雪")
        self.assertEqual(normalize_track_title("3天2夜"), "3天2夜")
        self.assertEqual(normalize_track_title("365个祝福"), "365个祝福")
        self.assertEqual(normalize_track_title("周杰伦", "周杰伦"), "周杰伦")
        self.assertEqual(normalize_track_title("01"), "01")
        self.assertEqual(normalize_track_title("01."), "01.")
        self.assertEqual(normalize_track_title(""), "")
        self.assertEqual(normalize_track_title(None), "")

    def test_timecode_to_ms(self):
        """测试 CUE 75帧/秒标准时间戳到毫秒的精确转换。"""
        self.assertEqual(timecode_to_ms("00:00:00"), 0)
        # 1秒整 = 1000ms
        self.assertEqual(timecode_to_ms("00:01:00"), 1000)
        # 00:00:75 -> 1000ms (75帧为1秒)
        self.assertEqual(timecode_to_ms("00:00:75"), 1000)
        # 01:23:45 -> (1*60+23)*1000 + round(45*1000/75) = 83000 + 600 = 83600
        self.assertEqual(timecode_to_ms("01:23:45"), 83600)

    def test_cue_parser_utf8_and_gbk(self):
        """测试 CUE 多编码（UTF-8 与 GB18030/GBK）自适应解析。"""
        # 1. UTF-8
        utf8_content = """
TITLE "Fantasy"
PERFORMER "Jay Chou"
FILE "Fantasy.flac" WAVE
  TRACK 01 AUDIO
    TITLE "Love Before BC"
    PERFORMER "Jay Chou"
    INDEX 01 00:00:00
  TRACK 02 AUDIO
    TITLE "Simple Love"
    PERFORMER "Jay Chou"
    INDEX 01 03:45:00
"""
        sheet1 = parse_cue_sheet(utf8_content)
        self.assertEqual(sheet1.title, "Fantasy")
        self.assertEqual(sheet1.performer, "Jay Chou")
        self.assertEqual(len(sheet1.tracks), 2)
        self.assertEqual(sheet1.tracks[0].title, "Love Before BC")
        self.assertEqual(sheet1.tracks[0].start_ms, 0)
        self.assertEqual(sheet1.tracks[0].end_ms, 225000)
        self.assertEqual(sheet1.tracks[0].duration_ms, 225000)
        self.assertEqual(sheet1.tracks[1].title, "Simple Love")
        self.assertEqual(sheet1.tracks[1].start_ms, 225000)

        # 2. GB18030 编码文件探测与解析
        gbk_file = self.tmp_dir / "chinese.cue"
        gbk_text = """
REM DATE 2001
PERFORMER "周杰伦"
TITLE "范特西"
FILE "CDImage.wav" WAVE
  TRACK 01 AUDIO
    TITLE "爱在西元前"
    INDEX 01 00:00:00
  TRACK 02 AUDIO
    TITLE "爸我回来了"
    INDEX 01 03:50:30
"""
        gbk_file.write_bytes(gbk_text.encode("gb18030"))
        detected = detect_and_read_cue(gbk_file)
        self.assertIsNotNone(detected)
        self.assertIn("周杰伦", detected)
        self.assertIn("爱在西元前", detected)

        sheet2 = parse_cue_sheet(detected)
        self.assertEqual(sheet2.title, "范特西")
        self.assertEqual(sheet2.performer, "周杰伦")
        self.assertEqual(sheet2.date, 2001)
        self.assertEqual(len(sheet2.tracks), 2)
        self.assertEqual(sheet2.tracks[0].title, "爱在西元前")
        self.assertEqual(sheet2.tracks[1].title, "爸我回来了")

    def test_audio_file_pairing_fallbacks(self):
        """测试多级音频文件关联回退策略：精确匹配、扩展名修正、主干同名与单音频匹配。"""
        cue_path = self.tmp_dir / "Album.cue"

        # 策略 1: FILE 声明为 Album.wav，磁盘实际为 Album.flac
        flac_path = self.tmp_dir / "Album.flac"
        flac_path.touch()

        sheet = CueSheet(files=["Album.wav"])
        resolved = resolve_audio_file(cue_path, sheet)
        self.assertEqual(resolved, flac_path)

        # 策略 2: FILE 声明为 CDImage.wav，磁盘为 CDImage.ape
        flac_path.unlink()
        ape_path = self.tmp_dir / "CDImage.ape"
        ape_path.touch()

        sheet = CueSheet(files=["CDImage.wav"])
        resolved = resolve_audio_file(cue_path, sheet)
        self.assertEqual(resolved, ape_path)

        # 策略 3: CUE 名为 Album.cue，磁盘音频为同名 Album.dts
        ape_path.unlink()
        dts_path = self.tmp_dir / "Album.dts"
        dts_path.touch()

        sheet = CueSheet(files=["WrongName.wav"])
        resolved = resolve_audio_file(cue_path, sheet)
        self.assertEqual(resolved, dts_path)

        # 策略 4: Windows 盘符与反斜杠路径清洗匹配 (如 C:\Music\Rips\Master.wav 匹配本地 Master.flac)
        dts_path.unlink()
        master_flac = self.tmp_dir / "Master.flac"
        master_flac.touch()

        sheet_win = CueSheet(files=[r"C:\Music\Rips\Master.wav"])
        resolved_win = resolve_audio_file(cue_path, sheet_win)
        self.assertEqual(resolved_win, master_flac)
        master_flac.unlink()

    def test_cue_track_slicing(self):
        """测试基于 ffmpeg 的毫秒级 CUE 分轨无损/MP3高速切片。"""
        audio_file = self.tmp_dir / "disc.flac"
        create_test_tone_audio(audio_file, duration_sec=6)

        cue_id = str(uuid.uuid4())
        # 切片曲目 1: 0.0s - 3.0s (0 - 3000ms)
        slice1 = ensure_cue_track_stream(
            audio_path=audio_file,
            cue_asset_id=cue_id,
            track_no=1,
            start_ms=0,
            end_ms=3000,
            original=False,
            audio_format="flac",
        )
        self.assertIsNotNone(slice1)
        self.assertTrue(slice1.exists())
        self.assertEqual(slice1.suffix, ".mp3")
        self.assertGreater(slice1.stat().st_size, 1024)

        # 切片曲目 2: 3.0s - 6.0s (3000 - 6000ms)
        slice2 = ensure_cue_track_stream(
            audio_path=audio_file,
            cue_asset_id=cue_id,
            track_no=2,
            start_ms=3000,
            end_ms=6000,
            original=False,
            audio_format="flac",
        )
        self.assertIsNotNone(slice2)
        self.assertTrue(slice2.exists())
        self.assertEqual(slice2.suffix, ".mp3")

        # 缓存命中验证：再次调用直接返回已有文件且不重新生成
        mtime_before = slice1.stat().st_mtime_ns
        cached = ensure_cue_track_stream(
            audio_path=audio_file,
            cue_asset_id=cue_id,
            track_no=1,
            start_ms=0,
            end_ms=3000,
            original=False,
        )
        self.assertEqual(cached, slice1)
        self.assertEqual(cached.stat().st_mtime_ns, mtime_before)

        # 清理派生目录
        shutil.rmtree(derived_music_dir(cue_id), ignore_errors=True)

    async def test_end_to_end_parse_cue_asset(self):
        """测试端到端 CUE 资产入库解析：子资产创建、音轨录入、专辑归一与母带打标。"""
        # 创建测试大音频与 CUE 文件
        audio_file = self.tmp_dir / "GoldMaster.flac"
        create_test_tone_audio(audio_file, duration_sec=8)

        cue_content = """
TITLE "The Golden Concert"
PERFORMER "Herbert von Karajan"
REM DATE 1987
FILE "GoldMaster.flac" WAVE
  TRACK 01 AUDIO
    TITLE "Symphony No. 5 Allegro"
    INDEX 01 00:00:00
  TRACK 02 AUDIO
    TITLE "Symphony No. 5 Andante"
    INDEX 01 00:04:00
"""
        cue_file = self.tmp_dir / "GoldMaster.cue"
        cue_file.write_text(cue_content, encoding="utf-8")

        storage = DummyStorage(self.tmp_dir)

        from sqlalchemy import text
        try:
            async with SessionLocal() as test_conn:
                await test_conn.execute(text("SELECT 1"))
        except Exception as e:
            self.skipTest(f"数据库连接不可达 ({e})，跳过端到端入库测试")

        async with SessionLocal() as db:
            # 1. 模拟母带大音频资产
            master_id = uuid.uuid4()
            master_asset = Asset(
                id=master_id,
                asset_type="music",
                title="GoldMaster",
                storage_key="main:GoldMaster.flac",
                file_name="GoldMaster.flac",
                size_bytes=audio_file.stat().st_size,
                file_mtime=audio_file.stat().st_mtime_ns,
                mime_type="audio/flac",
                status="ready",
                meta={},
            )
            db.add(master_asset)
            await db.commit()

            # 2. 模拟 CUE 资产入库
            cue_id = uuid.uuid4()
            cue_asset = Asset(
                id=cue_id,
                asset_type="music",
                title="The Golden Concert",
                storage_key="main:GoldMaster.cue",
                file_name="GoldMaster.cue",
                size_bytes=cue_file.stat().st_size,
                file_mtime=cue_file.stat().st_mtime_ns,
                mime_type="application/x-cue",
                status="pending",
                meta={},
            )
            db.add(cue_asset)
            await db.commit()

            # 3. 执行 CUE 解析
            await _parse_cue_asset(db, cue_asset, cue_file, storage)

            # 4. 验证 CUE 资产就绪
            reloaded_cue = await db.get(Asset, cue_id)
            self.assertEqual(reloaded_cue.status, "ready")
            self.assertEqual(reloaded_cue.title, "The Golden Concert")
            self.assertEqual(reloaded_cue.meta.get("track_count"), 2)

            # 5. 验证母带标记
            reloaded_master = await db.get(Asset, master_id)
            self.assertTrue(reloaded_master.meta.get("is_cue_master"))
            self.assertEqual(reloaded_master.meta.get("cue_asset_id"), str(cue_id))

            # 6. 验证子音轨生成（2 首分轨）
            t1_id = uuid.uuid5(cue_id, "track_1")
            t2_id = uuid.uuid5(cue_id, "track_2")

            a1 = await db.get(Asset, t1_id)
            self.assertIsNotNone(a1)
            self.assertEqual(a1.title, "Symphony No. 5 Allegro")
            self.assertTrue(a1.meta.get("is_cue_track"))
            self.assertEqual(a1.meta.get("track_no"), 1)
            self.assertEqual(a1.meta.get("start_ms"), 0)
            self.assertEqual(a1.meta.get("end_ms"), 4000)
            self.assertEqual(a1.meta.get("duration_ms"), 4000)

            tr1 = await db.get(MusicTrack, t1_id)
            self.assertIsNotNone(tr1)
            self.assertEqual(tr1.track_no, 1)
            self.assertEqual(tr1.duration_ms, 4000)
            self.assertEqual(tr1.format, "flac")

            a2 = await db.get(Asset, t2_id)
            self.assertIsNotNone(a2)
            self.assertEqual(a2.title, "Symphony No. 5 Andante")
            self.assertEqual(a2.meta.get("start_ms"), 4000)
            # 第二首根据音频总长（8000ms）自动推算
            self.assertGreaterEqual(a2.meta.get("duration_ms"), 3900)

            # 7. 验证专辑与艺术家聚合
            album = await db.get(MusicAlbum, tr1.album_id)
            self.assertIsNotNone(album)
            self.assertEqual(album.name, "The Golden Concert")
            self.assertEqual(album.year, 1987)

            artist = await db.get(MusicArtist, tr1.artist_id)
            self.assertIsNotNone(artist)
            self.assertEqual(artist.name, "Herbert von Karajan")

            # 清理测试派生缓存与 DB 记录
            shutil.rmtree(derived_music_dir(str(cue_id)), ignore_errors=True)
            await db.delete(a1)
            await db.delete(a2)
            await db.delete(cue_asset)
            await db.delete(master_asset)
            await db.delete(album)
            await db.delete(artist)
            await db.commit()


if __name__ == "__main__":
    unittest.main()
