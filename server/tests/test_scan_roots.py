"""资源根目录白名单与设置配置测试。

验证：
1. ScanRoot 模型与 put_settings_api 的类型白名单校验（合法资产类型、别名去重）。
2. get_app_settings 默认配置与历史配置向下兼容（自动补充 types）。
3. scan_root 管道执行时的白名单过滤：非白名单文件（如音乐目录下的 cover.jpg）自动跳过。
4. scan_root 对账逻辑：历史错误入库的非白名单文件在重扫时自动软删除（deleted_at 标记）。
"""

import shutil
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from app.api.admin import ScanRoot, SettingsBody, put_settings_api
from app.core.deps import DEFAULT_ALIAS_TYPES, get_app_settings
from app.core.errors import ApiError
from app.core.models import Asset, Setting
from app.core.pipeline import scan_root
from app.core.registry import ASSET_TYPES, asset_type_of


class TestScanRootsValidation(unittest.TestCase):
    def test_scan_root_model(self):
        """验证 ScanRoot 模型接受 types 列表，默认可为空。"""
        sr = ScanRoot(alias="music", path="/data/library/music", types=["music"])
        self.assertEqual(sr.alias, "music")
        self.assertEqual(sr.types, ["music"])

        sr_default = ScanRoot(alias="all", path="/data/library/all")
        self.assertEqual(sr_default.types, [])

    def test_default_alias_types(self):
        """验证系统预设别名类型映射。"""
        self.assertEqual(DEFAULT_ALIAS_TYPES["fonts"], ["font"])
        self.assertEqual(DEFAULT_ALIAS_TYPES["music"], ["music"])
        self.assertEqual(DEFAULT_ALIAS_TYPES["videos"], ["video"])
        self.assertEqual(DEFAULT_ALIAS_TYPES["books"], ["book"])
        self.assertEqual(DEFAULT_ALIAS_TYPES["images"], ["image"])
        self.assertCountEqual(DEFAULT_ALIAS_TYPES["uploads"], list(ASSET_TYPES))

    def test_asset_type_matching(self):
        """验证文件扩展名与白名单过滤逻辑。"""
        music_allowed = {"music"}
        self.assertEqual(asset_type_of("song.flac"), "music")
        self.assertIn(asset_type_of("song.flac"), music_allowed)

        # 封面图片被扩展名映射为 image，不在 music 白名单中
        self.assertEqual(asset_type_of("cover.jpg"), "image")
        self.assertNotIn(asset_type_of("cover.jpg"), music_allowed)

        self.assertEqual(asset_type_of("folder.png"), "image")
        self.assertNotIn(asset_type_of("folder.png"), music_allowed)


class TestScanRootsAsync(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp_dir = Path(tempfile.mkdtemp(prefix="portal_scan_roots_test_"))

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    async def test_put_settings_validation(self):
        """验证 put_settings_api 对 scan_roots 的校验：未知资产类型与重复别名。"""
        mock_db = AsyncMock()

        # 1. 未知资产类型校验
        body_invalid_type = SettingsBody(
            scan_roots=[ScanRoot(alias="test", path=str(self.tmp_dir), types=["invalid_type"])]
        )
        with self.assertRaises(ApiError) as ctx:
            await put_settings_api(body_invalid_type, db=mock_db, _=MagicMock())
        self.assertEqual(ctx.exception.status, 422)
        self.assertIn("未知资产类型", ctx.exception.message)

        # 2. 重复别名校验
        body_dup_alias = SettingsBody(
            scan_roots=[
                ScanRoot(alias="same", path=str(self.tmp_dir), types=["music"]),
                ScanRoot(alias="same", path=str(self.tmp_dir), types=["image"]),
            ]
        )
        with self.assertRaises(ApiError) as ctx:
            await put_settings_api(body_dup_alias, db=mock_db, _=MagicMock())
        self.assertEqual(ctx.exception.status, 422)
        self.assertIn("alias 重复", ctx.exception.message)

    async def test_get_app_settings_backward_compatibility(self):
        """验证从数据库读取旧版缺少 types 的 scan_roots 时，会自动根据别名填充 types。"""
        # 模拟数据库中已有的旧配置（无 types 键）
        legacy_scan_roots = [
            {"alias": "music", "path": str(self.tmp_dir / "music")},
            {"alias": "images", "path": str(self.tmp_dir / "images")},
            {"alias": "custom", "path": str(self.tmp_dir / "custom")},
        ]
        setting_row = Setting(key="scan_roots", value=legacy_scan_roots)

        mock_db = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [setting_row]
        mock_db.execute.return_value = mock_result

        settings = await get_app_settings(mock_db)
        roots = settings["scan_roots"]

        music_root = next(r for r in roots if r["alias"] == "music")
        self.assertEqual(music_root["types"], ["music"])

        images_root = next(r for r in roots if r["alias"] == "images")
        self.assertEqual(images_root["types"], ["image"])

        # 未知别名默认赋予全类型
        custom_root = next(r for r in roots if r["alias"] == "custom")
        self.assertCountEqual(custom_root["types"], list(ASSET_TYPES))

    async def test_scan_root_whitelist_filtering_and_reconciliation(self):
        """验证 scan_root 管道：白名单过滤只入库符合类型的文件，历史非白名单文件自动软删除。"""
        # 准备测试目录结构与文件
        music_dir = self.tmp_dir / "music_library"
        album_dir = music_dir / "JayChou" / "Fantasy"
        album_dir.mkdir(parents=True, exist_ok=True)

        song_file = album_dir / "01.Track.mp3"
        song_file.write_bytes(b"FAKE_AUDIO_DATA_MP3")

        cover_file = album_dir / "cover.jpg"
        cover_file.write_bytes(b"FAKE_IMAGE_DATA_JPG")

        # 构造模拟数据库状态
        # 假设库内已经有一条历史错误入库的 cover.jpg 记录（未软删）
        legacy_cover_asset = Asset(
            asset_type="image",
            status="ready",
            title="cover",
            storage_key="test_music:JayChou/Fantasy/cover.jpg",
            file_name="cover.jpg",
            size_bytes=cover_file.stat().st_size,
            file_mtime=cover_file.stat().st_mtime_ns,
            deleted_at=None,
        )

        mock_db = AsyncMock()
        mock_db.add = MagicMock()
        mock_exec_result = MagicMock()
        # existing 查询返回历史记录
        mock_exec_result.scalars.return_value.all.return_value = [legacy_cover_asset]
        mock_db.execute.return_value = mock_exec_result

        # 配置该根目录白名单仅允许 ['music']
        custom_settings = {
            "scan_roots": [
                {
                    "alias": "test_music",
                    "path": str(music_dir),
                    "types": ["music"],
                }
            ]
        }

        with patch("app.core.pipeline.get_app_settings", return_value=custom_settings), \
             patch("app.core.pipeline.enqueue", new_callable=AsyncMock) as mock_enqueue, \
             patch("app.core.pipeline.cleanup_derived", return_value=1) as mock_cleanup:

            await scan_root(mock_db, {"root_alias": "test_music"})

            # 1. 验证新添加入库的资产：仅 song_file（.mp3）被加入数据库
            added_assets = [
                call.args[0] for call in mock_db.add.call_args_list
                if isinstance(call.args[0], Asset)
            ]
            self.assertEqual(len(added_assets), 1)
            added_song = added_assets[0]
            self.assertEqual(added_song.file_name, "01.Track.mp3")
            self.assertEqual(added_song.asset_type, "music")
            self.assertEqual(added_song.storage_key, "test_music:JayChou/Fantasy/01.Track.mp3")

            # 2. 验证 cover.jpg 绝未作为新资产入库
            self.assertFalse(any(a.file_name == "cover.jpg" for a in added_assets))

            # 3. 验证历史非白名单 cover.jpg 资产被自动软删除（对账清理）
            self.assertIsNotNone(legacy_cover_asset.deleted_at)
            # 确认调用了 cleanup_derived 清理派生缩略图
            mock_cleanup.assert_called_once()
            # 确认向 Meili 派发了软删索引同步任务
            meili_calls = [
                call for call in mock_enqueue.call_args_list
                if call.args[1] == "index_meili"
            ]
            self.assertEqual(len(meili_calls), 1)


if __name__ == "__main__":
    unittest.main()
