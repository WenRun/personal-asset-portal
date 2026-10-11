"""DTS 音乐格式解析、探测与串流转码测试（标准 unittest 实现）。"""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from dotenv import load_dotenv

# 加载开发环境 .env 配置
load_dotenv(Path(__file__).parent.parent / ".env")

from app.core.registry import asset_type_of, ext_of, mime_of
from app.domains.music.probe import probe_audio
from app.domains.music.transcode import ensure_transcoded_stream


class TestDtsMusicSupport(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        """生成合法的 5.1 声道 DTS 测试音频文件。"""
        cls.dts_fd, cls.dts_file = tempfile.mkstemp(suffix=".dts")
        os.close(cls.dts_fd)
        cls.dts_path = Path(cls.dts_file)

        cmd = [
            "ffmpeg", "-y", "-v", "error",
            "-f", "lavfi", "-i", "sine=frequency=1000:duration=2",
            "-ac", "6",
            "-strict", "-2",
            "-c:a", "dca",
            str(cls.dts_path),
        ]
        subprocess.run(cmd, check=True)

    @classmethod
    def tearDownClass(cls):
        if cls.dts_path.exists():
            cls.dts_path.unlink()

    async def asyncTearDown(self):
        from app.core.db import engine
        await engine.dispose()

    def test_registry_dts(self):
        """验证 .dts 与 .dtshd 注册为音乐资产及正确 MIME 类型。"""
        self.assertEqual(asset_type_of("song.dts"), "music")
        self.assertEqual(asset_type_of("album_track.DTS"), "music")
        self.assertEqual(asset_type_of("master.dtshd"), "music")
        self.assertEqual(ext_of("track.dts"), ".dts")
        self.assertEqual(mime_of("track.dts"), "audio/vnd.dts")
        self.assertEqual(mime_of("track.dtshd"), "audio/vnd.dts")

    def test_probe_audio_dts(self):
        """验证 probe_audio 对 5.1 声道 DTS 音频的探测能力。"""
        info = probe_audio(self.dts_path)
        self.assertIsNotNone(info)
        self.assertEqual(info["codec_name"], "dts")
        self.assertEqual(info["channels"], 6)
        self.assertEqual(info["surround"], "5.1")
        self.assertEqual(info["sample_rate_hz"], 44100)
        self.assertIsNotNone(info["duration_ms"])
        self.assertGreater(info["duration_ms"], 1500)
        self.assertIsNotNone(info["bitrate_kbps"])
        self.assertGreater(info["bitrate_kbps"], 500)

    def test_ensure_transcoded_stream(self):
        """验证 DTS 下混转码生成 320k MP3 串流文件。"""
        preview = ensure_transcoded_stream(self.dts_path, "test_dts_asset_123")
        self.assertIsNotNone(preview)
        self.assertTrue(preview.exists())
        self.assertGreater(preview.stat().st_size, 0)
        # 清理测试生成的派生物
        try:
            preview.unlink()
            preview.parent.rmdir()
        except Exception:
            pass

    async def test_parse_music_integration(self):
        """验证 parse_music 完整入库链路：从 Asset 到 MusicTrack/MusicAlbum 及 meta 环绕声标记。"""
        import uuid
        from app.core.db import SessionLocal
        from app.core.models import Asset, MusicTrack
        from app.core.pipeline import build_storage, roots_of
        from app.domains.music.parser import parse_music

        async with SessionLocal() as db:
            storage = build_storage(await roots_of(db))
            key = f"uploads:test_suite/{uuid.uuid4().hex}.dts"
            storage.save(key, self.dts_path.read_bytes())

            asset = Asset(
                asset_type="music",
                status="pending",
                title="5.1环绕声测试曲目",
                storage_key=key,
                file_name="5.1环绕声测试曲目.dts",
                size_bytes=self.dts_path.stat().st_size,
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
                self.assertEqual(a.meta.get("channels"), 6)
                self.assertEqual(a.meta.get("surround"), "5.1")
                self.assertEqual(a.meta.get("audio_codec"), "dts")
                self.assertEqual(t.format, "dts")
                self.assertTrue(t.streamable)
                self.assertEqual(t.sample_rate_hz, 44100)
                self.assertIsNotNone(t.duration_ms)
                self.assertGreater(t.duration_ms, 1500)

                # 验证流接口行为：默认转码下混立体声 MP3 串流，original=True 返回原样 DTS
                from app.domains.music.router import stream as stream_api
                res = await stream_api(asset_id=asset_id, original=False, db=db, _=None)
                self.assertEqual(res.media_type, "audio/mpeg")
                self.assertTrue(res.filename.endswith(".mp3"))

                res_orig = await stream_api(asset_id=asset_id, original=True, db=db, _=None)
                self.assertEqual(res_orig.media_type, "audio/vnd.dts")
                self.assertTrue(res_orig.filename.endswith(".dts"))
            finally:
                await db.delete(asset)
                await db.commit()
                try:
                    storage.resolve(key).unlink(missing_ok=True)
                except Exception:
                    pass

    async def test_settings_max_upload_gb(self):
        """验证设置接口支持读写 max_upload_gb。"""
        from app.core.db import SessionLocal
        from app.core.deps import get_app_settings
        from app.api.admin import put_settings_api, SettingsBody

        async with SessionLocal() as db:
            orig_s = await get_app_settings(db)
            orig_gb = orig_s.get("max_upload_gb", 8)
            try:
                # 更新为 16GB
                updated = await put_settings_api(SettingsBody(max_upload_gb=16), db=db, _=None)
                self.assertEqual(updated.get("max_upload_gb"), 16)
            finally:
                # 恢复原值
                await put_settings_api(SettingsBody(max_upload_gb=orig_gb), db=db, _=None)


if __name__ == "__main__":
    unittest.main()
