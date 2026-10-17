"""分类体系测试（三合一方案：目录分类 A、手动批量 B、智能推荐 C）"""

import unittest

from app.core.pipeline import category_from_key
from app.domains.books.parser import suggest_book_category
from app.domains.fonts.parser import suggest_font_category
from app.domains.images.parser import suggest_image_category
from app.domains.music.parser import suggest_music_category
from app.domains.videos.parser import suggest_video_category


class TestCategorySystem(unittest.TestCase):

    def test_scheme_a_directory_category_from_key(self):
        """方案 A：由相对路径物理目录提取多级资产分类。"""
        # 单层子目录
        self.assertEqual(category_from_key("books:计算机/流畅的Python.epub"), "计算机")
        self.assertEqual(category_from_key("fonts:等宽字体/JetBrainsMono.ttf"), "等宽字体")

        # 多层子目录
        self.assertEqual(category_from_key("books:计算机/Python/Web/流畅的Python.epub"), "计算机/Python/Web")
        self.assertEqual(category_from_key("music:周杰伦/范特西/01.爱在西元前.flac"), "周杰伦/范特西")
        self.assertEqual(category_from_key("images:2024旅行/云南/洱海/IMG_001.jpg"), "2024旅行/云南/洱海")
        self.assertEqual(category_from_key("videos:教学视频/Docker入门/01.mp4"), "教学视频/Docker入门")

        # 根目录下单文件：应无分类（待归类池）
        self.assertIsNone(category_from_key("music:单曲.mp3"))
        self.assertIsNone(category_from_key("books:手册.pdf"))
        self.assertIsNone(category_from_key(""))
        self.assertIsNone(category_from_key("cue:music:01.flac:track01"))

    def test_scheme_c_music_recommendation(self):
        """方案 C 音乐：流派规范化映射与关键词启发推测。"""
        # ID3 genre 映射
        self.assertEqual(suggest_music_category("OST", "天空之城", "久石让精选"), "影视原声")
        self.assertEqual(suggest_music_category("Anime", "残酷天使的行动纲领", "EVA"), "动漫游戏")
        self.assertEqual(suggest_music_category("Classical", "月光奏鸣曲", "贝多芬作品集"), "古典音乐")
        self.assertEqual(suggest_music_category("Jazz", "Autumn Leaves", "Blue Note"), "爵士蓝调")
        self.assertEqual(suggest_music_category("Rock", "Smells Like Teen Spirit", "Nevermind"), "摇滚金属")
        self.assertEqual(suggest_music_category("Pop", "Mojito", "周杰伦"), "流行音乐")
        self.assertEqual(suggest_music_category("Ambient", "森林晨雨", "白噪音"), "轻音乐/纯音")

        # 无 genre，由标题或专辑关键词推测
        self.assertEqual(suggest_music_category(None, "泰坦尼克号 电影原声大碟", None), "影视原声")
        self.assertEqual(suggest_music_category(None, "火影忍者 动漫插曲", None), "动漫游戏")
        self.assertEqual(suggest_music_category(None, "贝多芬 钢琴交响乐", None), "古典音乐")

    def test_scheme_c_book_recommendation(self):
        """方案 C 书籍：元数据学科 subjects 与书名关键词分析。"""
        # 关键词与学科判断
        self.assertEqual(suggest_book_category("TCP/IP 详解", subjects=["Computer Science"]), "计算机与技术")
        self.assertEqual(suggest_book_category("深入理解计算机系统"), "计算机与技术")
        self.assertEqual(suggest_book_category("百年孤独", subjects=["Fiction"]), "文学艺术")
        self.assertEqual(suggest_book_category("聪明的投资者", desc="投资与理财宝典"), "经济管理")
        self.assertEqual(suggest_book_category("被讨厌的勇气", desc="阿德勒心理学"), "人文社科")
        self.assertEqual(suggest_book_category("时间简史", desc="宇宙与物理科普"), "科学科普")
        self.assertEqual(suggest_book_category("日食记家庭烹饪食谱"), "生活休闲")

    def test_scheme_c_font_recommendation(self):
        """方案 C 字体：fontTools 属性与字族命名风格推测。"""
        # 等宽代码
        self.assertEqual(suggest_font_category("FiraCode-Regular", "Fira Code", is_mono=True), "等宽/代码")
        self.assertEqual(suggest_font_category("JetBrainsMono", "JetBrains Mono"), "等宽/代码")

        # 无衬线 / 黑体
        self.assertEqual(suggest_font_category("NotoSansSC", "思源黑体"), "无衬线/黑体")

        # 衬线 / 宋体
        self.assertEqual(suggest_font_category("SourceHanSerif", "思源宋体"), "衬线/宋体")

        # 书法 / 手写
        self.assertEqual(suggest_font_category("Kaiti-SC", "华文楷体"), "手写/书法")

        # 西文字体
        self.assertEqual(suggest_font_category("LatinFont", "Regular", languages=["拉丁"]), "西文字体")

    def test_scheme_c_video_recommendation(self):
        """方案 C 视频：视频种类与系列名称判断。"""
        self.assertEqual(suggest_video_category("tutorial", "Python 零基础入门 第01讲"), "编程技术教程")
        self.assertEqual(suggest_video_category("tutorial", "PR 剪辑调色教程"), "影视设计教程")
        self.assertEqual(suggest_video_category("tutorial", "健身动作分解 01"), "教程系列")
        self.assertEqual(suggest_video_category("clip", "自然风景 空镜航拍"), "剪辑素材")
        self.assertEqual(suggest_video_category("clip", "流浪地球 电影花絮"), "影视片段")

    def test_scheme_c_image_recommendation(self):
        """方案 C 图片：EXIF 设备型号与分辨率宽高比推断。"""
        # 有相机信息 -> 摄影相片
        self.assertEqual(suggest_image_category("Sony", "A7M4", 6000, 4000, ".jpg"), "摄影相片")

        # 无相机信息，高分辨率宽屏 -> 电脑壁纸
        self.assertEqual(suggest_image_category(None, None, 3840, 2160, ".png"), "电脑壁纸")
        self.assertEqual(suggest_image_category(None, None, 1920, 1080, ".jpg"), "电脑壁纸")

        # 手机壁纸
        self.assertEqual(suggest_image_category(None, None, 1080, 2400, ".jpg"), "手机壁纸")

        # 矢量格式 -> 设计矢量
        self.assertEqual(suggest_image_category(None, None, 800, 600, ".svg"), "设计矢量")

        # 小图表情
        self.assertEqual(suggest_image_category(None, None, 128, 128, ".png"), "图标表情")


if __name__ == "__main__":
    unittest.main()
