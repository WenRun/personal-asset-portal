"""AI 元数据识别单测：JSON 容错解析、key 掩码、配置合并/就绪判定、结果归一、
只填空缺落库策略、批量入队门槛（内存对象 + 临时文件，不依赖数据库与外网）。"""

import tempfile
import unittest
from pathlib import Path

from PIL import Image

from app.core.ai import (
    DEFAULT_AI_CONFIG, ai_config_ready, image_to_data_url, mask_key,
    parse_json_content, save_ai_config,
)
from app.core.ai_enrich import apply_result, needs_ai_enrich, normalize_result
from app.core.models import Asset


def make_asset(atype="image", *, note=None, meta=None, title="测试", suggested=None) -> Asset:
    return Asset(asset_type=atype, title=title, file_name=f"{title}.jpg",
                 meta=dict(meta or {}), note=note, suggested_category=suggested)


class TestParseJsonContent(unittest.TestCase):
    def test_plain_json(self):
        self.assertEqual(parse_json_content('{"a": 1}'), {"a": 1})

    def test_fenced_json(self):
        content = '好的，这是结果：\n```json\n{"description": "风景照"}\n```'
        self.assertEqual(parse_json_content(content), {"description": "风景照"})

    def test_fenced_without_lang_tag(self):
        self.assertEqual(parse_json_content('```\n{"a": [1,2]}\n```'), {"a": [1, 2]})

    def test_json_with_chatter_around(self):
        content = '根据图片判断如下：{"description": "猫咪", "tags": ["宠物"]} 希望有帮助！'
        self.assertEqual(parse_json_content(content)["tags"], ["宠物"])

    def test_nested_braces_balanced(self):
        content = '回答 {"a": {"b": 1}, "c": "}奇怪字符串{"} 结束'
        self.assertEqual(parse_json_content(content)["a"], {"b": 1})

    def test_invalid_returns_none(self):
        self.assertIsNone(parse_json_content("这不是 JSON"))
        self.assertIsNone(parse_json_content('["数组不是对象"]'))
        self.assertIsNone(parse_json_content(None))
        self.assertIsNone(parse_json_content(""))

    def test_array_root_takes_first_object(self):
        # 某些模型的批量输出习惯是数组：取第一个对象（宽松策略，好过整次作废）
        self.assertEqual(parse_json_content('```json\n[{"a":1},{"b":2}]\n```'), {"a": 1})


class TestMaskAndConfig(unittest.TestCase):
    def test_mask_key(self):
        self.assertEqual(mask_key("sk-abcdef1234567890"), "sk-****7890")
        self.assertEqual(mask_key("short"), "****")
        self.assertEqual(mask_key(""), "")
        self.assertEqual(mask_key(None), "")

    def test_save_merges_and_keeps_empty_key(self):
        current = {**DEFAULT_AI_CONFIG, "base_url": "https://a/v4", "api_key": "sk-old"}
        # api_key 留空 = 保持不变（前端密码框掩码回显，永远拿不回原文）
        merged = save_ai_config(current, {"api_key": "", "model": "glm-4.5v"})
        self.assertEqual(merged["api_key"], "sk-old")
        self.assertEqual(merged["model"], "glm-4.5v")
        self.assertEqual(merged["base_url"], "https://a/v4")

    def test_save_new_key_overwrites(self):
        merged = save_ai_config({"api_key": "sk-old"}, {"api_key": "sk-new"})
        self.assertEqual(merged["api_key"], "sk-new")

    def test_ready_requires_enabled_and_fields(self):
        ok, hint = ai_config_ready({"enabled": False, "base_url": "", "api_key": "", "model": ""})
        self.assertFalse(ok)
        self.assertIn("未启用", hint)
        ok, hint = ai_config_ready({"enabled": True, "base_url": "", "api_key": "", "model": ""})
        self.assertFalse(ok)
        self.assertIn("接口地址", hint)
        ok, hint = ai_config_ready({"enabled": True, "base_url": "https://a", "api_key": "k", "model": "m"})
        self.assertTrue(ok)


class TestNormalizeAndApply(unittest.TestCase):
    def test_normalize_full(self):
        r = normalize_result({
            "description": " 一张雪山日落照片 ", "category": "摄影相片/风景",
            "tags": ["雪山", "", "日落", "雪山", "旅行摄影"],
            "title_suggestion": "  ",  # 空 → None
            "kind": "tutorial", "series_guess": "Python 入门",
        }, "video")
        self.assertEqual(r["description"], "一张雪山日落照片")
        self.assertEqual(r["category"], "摄影相片/风景")
        self.assertIsNone(r["title"])
        # 空串与重复标签被清掉
        self.assertEqual(r["tags"], ["雪山", "日落", "旅行摄影"])
        self.assertEqual(r["video"], {"kind": "tutorial", "series": "Python 入门"})

    def test_normalize_video_bad_kind(self):
        r = normalize_result({"kind": "movie", "series_guess": ""}, "video")
        self.assertEqual(r["video"], {"kind": None, "series": None})

    def test_normalize_book(self):
        r = normalize_result({"authors": ["张三", "", "李四"], "publisher": " 人民出版社 ",
                              "pub_year": "2019"}, "book")
        self.assertEqual(r["book"]["authors"], ["张三", "李四"])
        self.assertEqual(r["book"]["publisher"], "人民出版社")
        self.assertEqual(r["book"]["pub_year"], 2019)
        # 非法年份丢弃
        r2 = normalize_result({"pub_year": 99999}, "book")
        self.assertIsNone(r2["book"]["pub_year"])

    def test_apply_fills_only_empty_note(self):
        a = make_asset(note="")
        applied, sug = apply_result(a, {"description": "AI 简介", "category": "摄影相片", "title": None, "tags": ["风光"]})
        self.assertEqual(applied, ["note", "suggested_category"])
        self.assertEqual(a.note, "AI 简介")
        self.assertEqual(a.suggested_category, "摄影相片")

        # 用户已有简介：绝不覆盖
        b = make_asset(note="我手写的备注")
        applied2, _ = apply_result(b, {"description": "AI 简介", "category": None, "title": None, "tags": []})
        self.assertEqual(b.note, "我手写的备注")
        self.assertNotIn("note", applied2)

    def test_apply_keeps_identity_fields_in_suggestions(self):
        a = make_asset(note="")
        _, sug = apply_result(a, {"description": "d", "category": "c", "title": "新标题", "tags": ["t1"],
                                  "video": {"kind": "tutorial", "series": "S"}, "book": None})
        # 标题/标签/视频归属只进建议区，不动资产本体
        self.assertEqual(a.title, "测试")
        self.assertEqual(sug["title"], "新标题")
        self.assertEqual(sug["tags"], ["t1"])
        self.assertEqual(sug["video"], {"kind": "tutorial", "series": "S"})
        self.assertNotIn("book", sug)

    def test_needs_ai_enrich(self):
        fresh = make_asset(note=None)
        self.assertTrue(needs_ai_enrich(fresh))
        has_note = make_asset(note="已有简介")
        self.assertFalse(needs_ai_enrich(has_note))
        done = make_asset(note=None, meta={"ai_enrich": {"status": "ok"}})
        self.assertFalse(needs_ai_enrich(done))  # 跑过一次即终态，批量不再花钱


class TestImageEncoding(unittest.TestCase):
    def test_downscales_to_jpeg_data_url(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "big.png"
            Image.new("RGB", (3000, 2000), (10, 20, 30)).save(p)
            url = image_to_data_url(p, max_side=768)
            self.assertTrue(url.startswith("data:image/jpeg;base64,"))
            img = Image.open(__import__("io").BytesIO(__import__("base64").b64decode(url.split(",", 1)[1])))
            self.assertLessEqual(max(img.size), 768)

    def test_missing_file_returns_none(self):
        self.assertIsNone(image_to_data_url(Path("/nonexistent/x.webp")))


if __name__ == "__main__":
    unittest.main()
