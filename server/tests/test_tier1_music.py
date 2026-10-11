"""第一梯队无损与发烧友音乐格式（DSF/DFF/APE/AIFF/Opus/WMA/ALAC）解析、探测、转码与串流测试。"""

import os
import struct
import subprocess
import tempfile
import unittest
import uuid
from pathlib import Path
from dotenv import load_dotenv

# 加载开发环境 .env
load_dotenv(Path(__file__).parent.parent / ".env")

from app.core.registry import asset_type_of, ext_of, mime_of
from app.domains.music.probe import probe_audio
from app.domains.music.transcode import ensure_transcoded_stream
from app.domains.music.parser import PLAYABLE, NEED_TRANSCODE


def create_minimal_dsf(path: Path) -> None:
    """生成合法的 1 秒立体声 DSD64 (.dsf) 文件。"""
    block_size = 4096
    num_channels = 2
    sample_rate = 2822400
    data_bytes = b"\xaa" * (block_size * num_channels)
    data_chunk_size = 12 + len(data_bytes)
    fmt_chunk_size = 52
    dsd_chunk_size = 28

    total_file_size = dsd_chunk_size + fmt_chunk_size + data_chunk_size
    dsd_chunk = struct.pack("<4sQQQ", b"DSD ", dsd_chunk_size, total_file_size, 0)
    fmt_chunk = struct.pack(
        "<4sQIIIIIIQII",
        b"fmt ", fmt_chunk_size, 1, 0, 2, num_channels, sample_rate, 1, sample_rate, block_size, 0
    )
    data_chunk = struct.pack("<4sQ", b"data", data_chunk_size) + data_bytes
    path.write_bytes(dsd_chunk + fmt_chunk + data_chunk)


def create_minimal_dff(path: Path) -> None:
    """生成合法的 DSDIFF (.dff) 文件。"""
    fver_chunk = b"FVER" + struct.pack(">Q", 4) + b"\x01\x05\x00\x00"
    fs_chunk = b"FS  " + struct.pack(">Q", 4) + struct.pack(">I", 2822400)
    chnl_chunk = b"CHNL" + struct.pack(">Q", 10) + struct.pack(">H4s4s", 2, b"SLFT", b"SRGT")
    cmpr_chunk = b"CMPR" + struct.pack(">Q", 4) + b"DSD "
    prop_data = b"SND " + fs_chunk + chnl_chunk + cmpr_chunk
    prop_chunk = b"PROP" + struct.pack(">Q", len(prop_data)) + prop_data

    raw_audio = b"\xaa" * 4096
    dsd_chunk = b"DSD " + struct.pack(">Q", len(raw_audio)) + raw_audio
    frm8_data = b"DSD " + fver_chunk + prop_chunk + dsd_chunk
    frm8_chunk = b"FRM8" + struct.pack(">Q", len(frm8_data)) + frm8_data
    path.write_bytes(frm8_chunk)


class TestTier1MusicFormats(unittest.IsolatedAsyncioTestCase):
    async def asyncTearDown(self):
        from app.core.db import engine
        await engine.dispose()

    def test_registry_tier1_extensions_and_mimes(self):
        """验证所有第一梯队格式正确注册为音乐资产与对应的标准 MIME 类型。"""
        formats = [
            ("symphony.dsf", "music", ".dsf", "audio/x-dsf"),
            ("sacd_track.dff", "music", ".dff", "audio/x-dff"),
            ("audiophile.ape", "music", ".ape", "audio/x-ape"),
            ("studio_master.aiff", "music", ".aiff", "audio/x-aiff"),
            ("quick_take.aif", "music", ".aif", "audio/x-aiff"),
            ("modern_stream.opus", "music", ".opus", "audio/opus"),
            ("classic_rip.wma", "music", ".wma", "audio/x-ms-wma"),
            ("lossless_apple.alac", "music", ".alac", "audio/x-alac"),
        ]
        for name, expected_type, expected_ext, expected_mime in formats:
            self.assertEqual(asset_type_of(name), expected_type, f"asset_type mismatch for {name}")
            self.assertEqual(ext_of(name), expected_ext, f"ext mismatch for {name}")
            self.assertEqual(mime_of(name), expected_mime, f"mime mismatch for {name}")

        # 验证 PLAYABLE 与 NEED_TRANSCODE 集合覆盖
        for ext in ("ape", "dsf", "dff", "aiff", "aif", "opus", "wma", "alac"):
            self.assertIn(ext, PLAYABLE, f"{ext} should be in PLAYABLE")
        for ext in ("ape", "dsf", "dff", "aiff", "aif", "wma", "alac"):
            self.assertIn(ext, NEED_TRANSCODE, f"{ext} should be in NEED_TRANSCODE")

    async def test_dsd_dsf_ingest_and_transcode(self):
        """测试 DSD64 DSF 文件的元数据探测、入库聚合、MP3 转码派生与双模串流。"""
        with tempfile.NamedTemporaryFile(suffix=".dsf", delete=False) as tf:
            dsf_path = Path(tf.name)
        try:
            create_minimal_dsf(dsf_path)

            # 1. 探测测试
            info = probe_audio(dsf_path)
            self.assertIsNotNone(info)
            self.assertEqual(info["sample_rate_hz"], 2822400)
            self.assertEqual(info["channels"], 2)

            # 2. 转码派生测试
            stream_mp3 = ensure_transcoded_stream(dsf_path, "test_dsf_transcode")
            self.assertIsNotNone(stream_mp3)
            self.assertTrue(stream_mp3.is_file())
            self.assertGreater(stream_mp3.stat().st_size, 0)
            stream_mp3.unlink(missing_ok=True)
            try:
                stream_mp3.parent.rmdir()
            except Exception:
                pass

            # 3. 完整入库集成测试
            import uuid
            from app.core.db import SessionLocal
            from app.core.models import Asset, MusicTrack
            from app.core.pipeline import build_storage, roots_of
            from app.domains.music.parser import parse_music
            from app.domains.music.router import stream as stream_api

            async with SessionLocal() as db:
                storage = build_storage(await roots_of(db))
                key = f"uploads:test_suite/{uuid.uuid4().hex}.dsf"
                storage.save(key, dsf_path.read_bytes())

                asset = Asset(
                    asset_type="music",
                    status="pending",
                    title="DSD64母带交响曲",
                    storage_key=key,
                    file_name="DSD64母带交响曲.dsf",
                    size_bytes=dsf_path.stat().st_size,
                )
                db.add(asset)
                await db.commit()
                asset_id = asset.id

                try:
                    await parse_music(db, {"asset_id": str(asset_id)})
                    a = await db.get(Asset, asset_id)
                    t = await db.get(MusicTrack, asset_id)
                    self.assertIsNotNone(a)
                    self.assertIsNotNone(t)
                    self.assertEqual(a.status, "ready")
                    self.assertEqual(a.meta.get("dsd_rate"), "DSD64")
                    self.assertEqual(t.format, "dsf")
                    self.assertTrue(t.streamable)
                    self.assertEqual(t.sample_rate_hz, 2822400)

                    # 浏览器播放请求转码 MP3 流
                    res = await stream_api(asset_id=asset_id, original=False, db=db, _=None)
                    self.assertEqual(res.media_type, "audio/mpeg")
                    self.assertTrue(res.filename.endswith(".mp3"))

                    # 原样下载/播放请求原版 DSF 流
                    res_orig = await stream_api(asset_id=asset_id, original=True, db=db, _=None)
                    self.assertEqual(res_orig.media_type, "audio/x-dsf")
                    self.assertTrue(res_orig.filename.endswith(".dsf"))
                finally:
                    await db.delete(asset)
                    await db.commit()
                    try:
                        storage.resolve(key).unlink(missing_ok=True)
                    except Exception:
                        pass
        finally:
            dsf_path.unlink(missing_ok=True)

    async def test_dsd_dff_ingest_and_transcode(self):
        """测试 DSDIFF DFF 文件的探测与串流。"""
        with tempfile.NamedTemporaryFile(suffix=".dff", delete=False) as tf:
            dff_path = Path(tf.name)
        try:
            create_minimal_dff(dff_path)

            info = probe_audio(dff_path)
            self.assertIsNotNone(info)
            self.assertEqual(info["sample_rate_hz"], 2822400)

            stream_mp3 = ensure_transcoded_stream(dff_path, "test_dff_transcode")
            self.assertIsNotNone(stream_mp3)
            self.assertTrue(stream_mp3.is_file())
            stream_mp3.unlink(missing_ok=True)
            try:
                stream_mp3.parent.rmdir()
            except Exception:
                pass
        finally:
            dff_path.unlink(missing_ok=True)

    async def test_aiff_ingest_and_transcode(self):
        """测试 AIFF 苹果无损格式的元数据提取与转码串流。"""
        with tempfile.NamedTemporaryFile(suffix=".aiff", delete=False) as tf:
            aiff_path = Path(tf.name)
        try:
            subprocess.run([
                "ffmpeg", "-y", "-v", "error",
                "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
                "-c:a", "pcm_s16be",
                "-metadata", "title=AIFF标杆测试曲",
                "-metadata", "author=苹果声学实验室",
                "-metadata", "artist=苹果声学实验室",
                "-write_id3v2", "1",
                str(aiff_path),
            ], check=True)

            info = probe_audio(aiff_path)
            self.assertIsNotNone(info)
            self.assertEqual(info["title"], "AIFF标杆测试曲")
            self.assertEqual(info["artist"], "苹果声学实验室")
            self.assertEqual(info["sample_rate_hz"], 44100)

            # 验证转码派生
            stream_mp3 = ensure_transcoded_stream(aiff_path, "test_aiff_transcode")
            self.assertIsNotNone(stream_mp3)
            self.assertTrue(stream_mp3.is_file())
            stream_mp3.unlink(missing_ok=True)
            try:
                stream_mp3.parent.rmdir()
            except Exception:
                pass
        finally:
            aiff_path.unlink(missing_ok=True)

    async def test_opus_streamable_native(self):
        """测试现代高保真 Opus 格式原生可在线播放。"""
        with tempfile.NamedTemporaryFile(suffix=".opus", delete=False) as tf:
            opus_path = Path(tf.name)
        try:
            subprocess.run([
                "ffmpeg", "-y", "-v", "error",
                "-f", "lavfi", "-i", "sine=frequency=880:duration=1",
                "-c:a", "libopus",
                "-metadata", "title=现代Opus纯流",
                "-metadata", "artist=Opus开源声学",
                str(opus_path),
            ], check=True)

            info = probe_audio(opus_path)
            self.assertIsNotNone(info)
            self.assertEqual(info["title"], "现代Opus纯流")
            self.assertEqual(info["sample_rate_hz"], 48000)
            self.assertEqual(info["codec_name"], "opus")
        finally:
            opus_path.unlink(missing_ok=True)

    async def test_wma_support(self):
        """测试 WMA 格式探测与转码。"""
        with tempfile.NamedTemporaryFile(suffix=".wma", delete=False) as tf:
            wma_path = Path(tf.name)
        try:
            subprocess.run([
                "ffmpeg", "-y", "-v", "error",
                "-f", "lavfi", "-i", "sine=frequency=600:duration=1",
                "-c:a", "wmav2",
                "-metadata", "title=微软WMA经典音频",
                str(wma_path),
            ], check=True)

            info = probe_audio(wma_path)
            self.assertIsNotNone(info)
            self.assertEqual(info["title"], "微软WMA经典音频")

            stream_mp3 = ensure_transcoded_stream(wma_path, "test_wma_transcode")
            self.assertIsNotNone(stream_mp3)
            self.assertTrue(stream_mp3.is_file())
            stream_mp3.unlink(missing_ok=True)
            try:
                stream_mp3.parent.rmdir()
            except Exception:
                pass
        finally:
            wma_path.unlink(missing_ok=True)

    async def test_ape_support(self):
        """测试 APE (Monkey's Audio) 格式与 APEv2 标签解析。"""
        from mutagen.apev2 import APEv2
        from mutagen.monkeysaudio import MonkeysAudio

        with tempfile.NamedTemporaryFile(suffix=".ape", delete=False) as tf:
            ape_path = Path(tf.name)
        try:
            header = bytearray(76)
            header[0:4] = b"MAC "
            struct.pack_into("<H", header, 4, 3990)
            struct.pack_into("<IIIHHI", header, 56, 73728 * 4, 44100, 1, 16, 2, 44100)
            ape_path.write_bytes(header)

            tags = APEv2()
            tags["Title"] = "APE无损发烧乐"
            tags["Artist"] = "无损实验室"
            tags.save(str(ape_path))

            m = MonkeysAudio(str(ape_path))
            self.assertEqual(m.info.sample_rate, 44100)
            self.assertEqual(m.info.channels, 2)
            self.assertEqual(str(m.tags["Title"]), "APE无损发烧乐")
        finally:
            ape_path.unlink(missing_ok=True)

    async def test_alac_support(self):
        """测试 ALAC 苹果无损格式探测与转码。"""
        with tempfile.NamedTemporaryFile(suffix=".m4a", delete=False) as tf_m4a:
            m4a_path = Path(tf_m4a.name)
        with tempfile.NamedTemporaryFile(suffix=".alac", delete=False) as tf_alac:
            alac_path = Path(tf_alac.name)
        try:
            subprocess.run([
                "ffmpeg", "-y", "-v", "error",
                "-f", "lavfi", "-i", "sine=frequency=520:duration=1",
                "-c:a", "alac",
                "-metadata", "title=ALAC母带苹果格式",
                str(m4a_path),
            ], check=True)
            alac_path.write_bytes(m4a_path.read_bytes())

            info = probe_audio(alac_path)
            self.assertIsNotNone(info)
            self.assertEqual(info["title"], "ALAC母带苹果格式")

            stream_mp3 = ensure_transcoded_stream(alac_path, "test_alac_transcode")
            self.assertIsNotNone(stream_mp3)
            self.assertTrue(stream_mp3.is_file())
            stream_mp3.unlink(missing_ok=True)
            try:
                stream_mp3.parent.rmdir()
            except Exception:
                pass
        finally:
            m4a_path.unlink(missing_ok=True)
            alac_path.unlink(missing_ok=True)
