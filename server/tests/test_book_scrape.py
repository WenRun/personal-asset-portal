"""图书刮削第一期单测：ISBN 提取/校验、Google Books 响应解析、封面 URL 放大、
只填空缺落库策略、自动入队门槛、PDF 版权页 ISBN 抓取（内存对象 + 临时文件，不依赖数据库）。"""

import tempfile
import unittest
from pathlib import Path

from app.core.models import Asset, BookDetail
from app.domains.books.parser import _parse_pdf
from app.domains.books.scrape import (
    BookCandidate,
    _cover_is_synthetic,
    _pick_by_year,
    _pick_candidate,
    _title_matches,
    cover_urls,
    candidates_from_response,
    extract_isbn_from_text,
    fill_missing,
    needs_scrape,
    normalize_isbn,
    upscale_cover_url,
)


def make_book(title="测试书", *, meta=None, note=None) -> tuple[Asset, BookDetail]:
    a = Asset(asset_type="book", title=title, file_name=f"{title}.txt", meta=dict(meta or {}), note=note)
    d = BookDetail(asset_id=a.id)
    return a, d


class TestIsbn(unittest.TestCase):
    def test_normalize_valid_13(self):
        # 校验位正确（9787111421900，权位 1/3 交替求和取模）
        self.assertEqual(normalize_isbn("978-7-111-42190-0"), "9787111421900")
        self.assertEqual(normalize_isbn("ISBN:978 7 111 42190 0"), "9787111421900")
        self.assertEqual(normalize_isbn("isbn:9787111421900"), "9787111421900")

    def test_normalize_rejects_bad_checksum(self):
        self.assertIsNone(normalize_isbn("9787111421901"))  # 13 位但校验位错
        self.assertIsNone(normalize_isbn("978711"))         # 位数不对

    def test_normalize_valid_10(self):
        self.assertEqual(normalize_isbn("0-13-110362-8"), "0131103628")

    def test_extract_from_copyright_page(self):
        text = "流畅的Python\nLuciano Ramalho 著\nISBN 978-7-111-42190-0\n人民邮电出版社"
        self.assertEqual(extract_isbn_from_text(text), "9787111421900")

    def test_extract_prefers_13_over_10(self):
        text = "ISBN 0-13-110362-8\n版权所有\nISBN 978-7-111-42190-0"
        self.assertEqual(extract_isbn_from_text(text), "9787111421900")

    def test_extract_labeled_isbn10(self):
        self.assertEqual(extract_isbn_from_text("出版说明\nISBN 0-13-110362-8"), "0131103628")

    def test_extract_ignores_phone_like_numbers(self):
        # 裸 10 位数字（电话/单号）不带 ISBN 标签不应误报
        self.assertIsNone(extract_isbn_from_text("客服电话 010-62780000 转人工"))

    def test_extract_none(self):
        self.assertIsNone(extract_isbn_from_text(None))
        self.assertIsNone(extract_isbn_from_text(""))


class TestGoogleBooksParsing(unittest.TestCase):
    def test_candidates_from_response(self):
        data = {
            "items": [
                {
                    "id": "abc123",
                    "volumeInfo": {
                        "title": "流畅的Python",
                        "authors": ["Luciano Ramalho"],
                        "publisher": "人民邮电出版社",
                        "publishedDate": "2023-05",
                        "industryIdentifiers": [
                            {"type": "ISBN_10", "identifier": "7115421900"},
                            {"type": "ISBN_13", "identifier": "9787115421906"},
                        ],
                        "pageCount": 636,
                        "language": "zh",
                        "description": "本书介绍 <b>Python</b> 特性<br>与最佳实践",
                        "imageLinks": {"thumbnail": "https://books.google.com/books/content?id=abc123&printsec=frontcover&img=1&zoom=1&edge=curl"},
                        "averageRating": 4.5,
                    },
                },
                {"id": "empty", "volumeInfo": {}},  # 无题名的条目应被过滤
            ]
        }
        cands = candidates_from_response(data)
        self.assertEqual(len(cands), 1)
        c = cands[0]
        self.assertEqual(c.source_id, "abc123")
        self.assertEqual(c.title, "流畅的Python")
        self.assertEqual(c.publisher, "人民邮电出版社")
        self.assertEqual(c.pub_year, 2023)
        self.assertEqual(c.isbn, "9787115421906")  # 优先 ISBN_13 且通过校验
        self.assertEqual(c.pages, 636)
        self.assertIn("Python", c.description)
        self.assertNotIn("<", c.description)  # HTML 已剥
        # 解析阶段保留原始缩略图 URL（确认队列预览用）；zoom 放大在下载时才做
        self.assertIn("zoom=1", c.cover_url)
        self.assertIn("zoom=3", upscale_cover_url(c.cover_url))
        self.assertEqual(c.rating, 4.5)

    def test_candidates_empty(self):
        self.assertEqual(candidates_from_response({}), [])
        self.assertEqual(candidates_from_response({"items": []}), [])


class TestUpscaleUrl(unittest.TestCase):
    def test_zoom_and_edge(self):
        url = "https://books.google.com/books/content?id=x&printsec=frontcover&img=1&zoom=1&edge=curl"
        u = upscale_cover_url(url)
        self.assertIn("zoom=3", u)
        self.assertNotIn("edge=curl", u)

    def test_passthrough(self):
        self.assertEqual(upscale_cover_url("https://example.com/a.jpg"), "https://example.com/a.jpg")


class TestFillMissing(unittest.TestCase):
    def setUp(self):
        self.cand = BookCandidate(
            source_id="x", title="网络书名", authors=["作者甲"], publisher="出版社乙",
            pub_year=2020, isbn="9787111421900", pages=300, language="zh",
            description="这是简介", cover_url=None, rating=4.0,
        )

    def test_fills_all_gaps(self):
        a, d = make_book()
        fill_missing(a, d, self.cand)
        self.assertEqual(d.authors, ["作者甲"])
        self.assertEqual(d.publisher, "出版社乙")
        self.assertEqual(d.pub_year, 2020)
        self.assertEqual(d.isbn, "9787111421900")
        self.assertEqual(d.pages, 300)
        self.assertEqual(a.note, "这是简介")

    def test_never_overwrites_existing(self):
        a, d = make_book(note="我的手填简介", meta={})
        d.authors = ["原作者"]
        d.publisher = "原出版社"
        d.pub_year = 1999
        d.isbn = "1111111111111"
        d.pages = 100
        fill_missing(a, d, self.cand)
        self.assertEqual(d.authors, ["原作者"])
        self.assertEqual(d.publisher, "原出版社")
        self.assertEqual(d.pub_year, 1999)
        self.assertEqual(d.pages, 100)
        self.assertEqual(a.note, "我的手填简介")  # 简介也只填空


class TestNeedsScrape(unittest.TestCase):
    def test_complete_never_scraped(self):
        a, d = make_book(note="有简介")
        d.authors, d.publisher, d.pub_year, d.isbn = ["甲"], "乙", 2020, "9787111421900"
        self.assertFalse(needs_scrape(a, d))

    def test_missing_fields_triggers(self):
        a, d = make_book(note=None)
        self.assertTrue(needs_scrape(a, d))
        a2, d2 = make_book(note="有简介", meta={"cover_synthetic": True})
        d2.authors, d2.publisher, d2.pub_year, d2.isbn = ["甲"], "乙", 2020, "9787111421900"
        self.assertTrue(needs_scrape(a2, d2))  # 合成封面也算缺口

    def test_terminal_status_blocks_auto(self):
        for st in ("ok", "not_found", "ambiguous", "skipped"):
            a, d = make_book(meta={"book_scrape": {"status": st}})
            self.assertFalse(needs_scrape(a, d), st)

    def test_none_detail(self):
        a, _ = make_book()
        self.assertTrue(needs_scrape(a, None))


class TestCoverSyntheticInference(unittest.TestCase):
    def test_mark_present_wins(self):
        a, d = make_book(meta={"cover_synthetic": True}, note="x")
        d.format = "epub"
        self.assertTrue(_cover_is_synthetic(a, d))
        a2, d2 = make_book(meta={"cover_synthetic": False}, note="x")
        d2.format = "txt"
        self.assertFalse(_cover_is_synthetic(a2, d2))

    def test_legacy_null_by_format(self):
        # 一期上线前解析的老书无标记：txt 必为合成；epub/pdf/mobi 保守按真封面
        a, d = make_book(meta={}, note="x"); d.format = "txt"
        self.assertTrue(_cover_is_synthetic(a, d))
        for fmt in ("epub", "pdf", "mobi"):
            a2, d2 = make_book(meta={}, note="x"); d2.format = fmt
            self.assertFalse(_cover_is_synthetic(a2, d2), fmt)


class TestPickByYear(unittest.TestCase):
    def test_unique_year_match_wins(self):
        a, d = make_book(note="x"); d.pub_year = 2017
        cands = [BookCandidate(source_id="1", title="书", pub_year=2022),
                 BookCandidate(source_id="2", title="书", pub_year=2017)]
        self.assertEqual(_pick_by_year(cands, d).source_id, "2")

    def test_ambiguous_or_missing_year(self):
        a, d = make_book(note="x"); d.pub_year = None
        self.assertIsNone(_pick_by_year([BookCandidate(source_id="1", title="书", pub_year=2017)], d))
        d.pub_year = 2020  # 两个同年后选：仍无法唯一确定
        cands = [BookCandidate(source_id="1", title="书", pub_year=2020),
                 BookCandidate(source_id="2", title="书", pub_year=2020)]
        self.assertIsNone(_pick_by_year(cands, d))


class TestPickCandidate(unittest.TestCase):
    """回归：条件短路导致 pick 未赋值（线上 6 本 NameError）；统一走 _pick_candidate。"""

    def _mk(self, **kw):
        return BookCandidate(source_id=kw.pop("sid", "x"), title=kw.pop("title", "书"), **kw)

    def test_single_candidate(self):
        a, d = make_book(note="x"); d.pub_year = None
        only = [self._mk(sid="1")]
        self.assertEqual(_pick_candidate(a.title, only, d).source_id, "1")

    def test_single_exact(self):
        a, d = make_book(note="x"); d.pub_year = None
        cands = [self._mk(sid="1", title="测试书"), self._mk(sid="2", title="别的书")]
        self.assertEqual(_pick_candidate("测试书", cands, d).source_id, "1")

    def test_year_unique(self):
        a, d = make_book(note="x"); d.pub_year = 2017
        cands = [self._mk(sid="1", title="测试书", pub_year=2017), self._mk(sid="2", title="测试书", pub_year=2022)]
        self.assertEqual(_pick_candidate("测试书", cands, d).source_id, "1")

    def test_no_pick(self):
        a, d = make_book(note="x"); d.pub_year = None
        cands = [self._mk(sid="1", title="测试书"), self._mk(sid="2", title="测试书")]
        self.assertIsNone(_pick_candidate("测试书", cands, d))
        self.assertIsNone(_pick_candidate("测试书", [], d))


class TestCoverUrls(unittest.TestCase):
    def test_google_url_https_and_zoom(self):
        urls = cover_urls("http://books.google.com/books/content?id=x&printsec=frontcover&img=1&zoom=1&edge=curl", None)
        self.assertEqual(len(urls), 1)
        self.assertTrue(urls[0].startswith("https://"))       # 明文 http 强制 https
        self.assertIn("zoom=3", urls[0])
        self.assertNotIn("edge=curl", urls[0])

    def test_isbn_appends_openlibrary(self):
        urls = cover_urls("https://books.google.com/books/content?id=x&zoom=1", "9787111421900")
        self.assertEqual(len(urls), 2)
        self.assertEqual(urls[1], "https://covers.openlibrary.org/b/isbn/9787111421900-L.jpg?default=false")


class TestTitleMatches(unittest.TestCase):
    def test_exact_and_subtitle(self):
        self.assertTrue(_title_matches("算法图解", "算法图解"))
        self.assertTrue(_title_matches("算法图解", "算法图解（图解系列）"))  # 括号后缀
        self.assertTrue(_title_matches("流畅的Python", "流畅的Python（原书第2版）"))

    def test_punctuation_and_space(self):
        self.assertTrue(_title_matches("JavaScript 高级程序设计", "JavaScript高级程序设计"))
        self.assertTrue(_title_matches("C++ Primer中文版", "C++ Primer 中文版（第5版）"))

    def test_mismatch(self):
        self.assertFalse(_title_matches("算法图解", "管理者的数字化转型"))
        self.assertFalse(_title_matches("", "算法图解"))
        self.assertFalse(_title_matches(None, None))


class TestPdfIsbnExtraction(unittest.TestCase):
    def test_parse_pdf_pulls_isbn_from_front_pages(self):
        import pymupdf

        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "sample.pdf"
            doc = pymupdf.open()
            page = doc.new_page()
            page.insert_text((72, 72), "某本中文技术书\n\nISBN 978-7-111-42190-0\n人民邮电出版社")
            doc.save(str(path))
            doc.close()

            meta: dict = {}
            r = _parse_pdf(path, meta)
            self.assertEqual(r["fields"]["isbn"], "9787111421900")
            self.assertEqual(r["fields"]["format"], "pdf")
            self.assertIn("pages", meta)

    def test_parse_pdf_without_isbn(self):
        import pymupdf

        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "plain.pdf"
            doc = pymupdf.open()
            doc.new_page().insert_text((72, 72), "没有版权页信息的普通文档")
            doc.save(str(path))
            doc.close()

            r = _parse_pdf(path, {})
            self.assertIsNone(r["fields"]["isbn"])


if __name__ == "__main__":
    unittest.main()
