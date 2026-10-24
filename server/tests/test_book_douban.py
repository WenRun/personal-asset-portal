"""豆瓣读书刮削解析单测：suggest 响应、详情页（#info/JSON-LD/评分/丛书/内容简介/og:image）、
ISBN 提取复用。夹具取自 2026-10 真实页面结构（book.douban.com/subject/26979890）。"""

import unittest

from app.domains.books.douban import parse_subject_html, parse_suggest

SUGGEST_FIXTURE = [
    {"title": "算法图解", "url": "https://book.douban.com/subject/26979890/",
     "pic": "https://img9.doubanio.com/view/subject/s/public/s29358625.jpg",
     "author_name": "[美] Aditya Bhargava", "year": "2017", "type": "b", "id": "26979890"},
    {"title": "算法图解（第2版）", "url": "https://book.douban.com/subject/36100953/",
     "pic": "https://img2.doubanio.com/view/subject/s/public/s33835527.jpg",
     "author_name": "[美] Aditya Bhargava", "year": "2022-8", "type": "b", "id": "36100953"},
    {"title": "某电影", "url": "https://movie.douban.com/subject/123/", "type": "movie", "id": "123"},
]

SUBJECT_FIXTURE = """<!DOCTYPE html>
<html>
<head><meta property="og:image" content="https://img9.doubanio.com/view/subject/l/public/s29358625.jpg">
<meta property="og:title" content="算法图解"></head>
<body>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Book",
"name":"算法图解","author":[{"@type":"Person","name":"[美] Aditya Bhargava"}],
"isbn":"9787115447630"}</script>
<div id="info">
    作者:<br/> [美] Aditya Bhargava<br/>
    译者:<br/> 袁国忠<br/>
    出版社:<br/> 人民邮电出版社<br/>
    出品方: 图灵教育<br/>
    出版年: 2017-3<br/>
    ISBN: 9787115447630<br/>
    页数: 196<br/>
    装帧: 平装<br/>
    丛书:&nbsp;图灵程序设计丛书
</div>
<strong class="ll rating_num" property="v:average"> 8.5 </strong>
<h2>内容简介</h2>
<div class="intro"><p>本书示例丰富，图文并茂，以让人容易理解的方式阐释了算法。</p><p>前三章将帮助你打下基础。</p></div>
<div class="intro"><p>关于作者的介绍（不应被当成内容简介）。</p></div>
</body></html>
"""


class TestParseSuggest(unittest.TestCase):
    def test_filters_books_only(self):
        cands = parse_suggest(SUGGEST_FIXTURE)
        self.assertEqual(len(cands), 2)  # 电影条目被过滤
        c = cands[0]
        self.assertEqual(c.source, "douban")
        self.assertEqual(c.source_id, "douban:26979890")
        self.assertEqual(c.title, "算法图解")
        self.assertEqual(c.authors, ["[美] Aditya Bhargava"])
        self.assertEqual(c.pub_year, 2017)
        self.assertIn("doubanio.com", c.cover_url)
        # suggest 只有建议级字段：出版社/评分/ISBN 为空（详情页补全）
        self.assertIsNone(c.publisher)
        self.assertIsNone(c.rating)
        self.assertIsNone(c.isbn)

    def test_year_with_month(self):
        self.assertEqual(parse_suggest(SUGGEST_FIXTURE)[1].pub_year, 2022)

    def test_empty(self):
        self.assertEqual(parse_suggest([]), [])
        self.assertEqual(parse_suggest({}), [])


class TestParseSubject(unittest.TestCase):
    def setUp(self):
        self.c = parse_subject_html(SUBJECT_FIXTURE, "26979890")

    def test_core_fields(self):
        self.assertIsNotNone(self.c)
        self.assertEqual(self.c.title, "算法图解")
        self.assertEqual(self.c.authors, ["[美] Aditya Bhargava"])
        self.assertEqual(self.c.publisher, "人民邮电出版社")
        self.assertEqual(self.c.pub_year, 2017)
        self.assertEqual(self.c.pages, 196)
        self.assertEqual(self.c.isbn, "9787115447630")
        self.assertEqual(self.c.series_name, "图灵程序设计丛书")

    def test_rating_and_cover(self):
        self.assertEqual(self.c.rating, 8.5)
        self.assertEqual(self.c.rating_source, "douban")
        self.assertEqual(self.c.source, "douban")
        self.assertEqual(self.c.cover_url, "https://img9.doubanio.com/view/subject/l/public/s29358625.jpg")

    def test_description_is_first_intro(self):
        # 第一个 intro 是内容简介；作者简介（第二个 intro）不能串进来
        self.assertIn("图文并茂", self.c.description)
        self.assertNotIn("关于作者", self.c.description)

    def test_minimal_page(self):
        html = '<meta property="og:title" content="只有题名"><div id="info"></div>'
        c = parse_subject_html(html, "1")
        self.assertEqual(c.title, "只有题名")
        self.assertIsNone(c.rating)


if __name__ == "__main__":
    unittest.main()
