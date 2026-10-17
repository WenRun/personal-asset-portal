"""图片格式扩展测试：新扩展名注册、MIME 覆盖、SVG 尺寸解析、解码器注册、AI 与相机 RAW。"""

import datetime as dt
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from app.core.registry import EXT_TO_TYPE, asset_type_of, ext_of, mime_of
from app.domains.images import decoders  # noqa: F401  断言 HEIF/AVIF 已注册
from app.domains.images.decoders import RAW_EXTENSIONS
from app.domains.images.parser import _ai_dimensions, _raw_exif, _raw_fields, _svg_dimensions
from app.domains.images.thumbs import _load_source

FIXTURES = Path(__file__).parent / "fixtures"


class TestImageExtensionRegistry(unittest.TestCase):

    def test_new_extensions_registered_as_image(self):
        """bmp/tiff/jfif/heif/avif/svg/ico/psd/ai 及各品牌 RAW 均应识别为图片资产。"""
        names = ["a.bmp", "a.tif", "a.tiff", "a.jfif", "a.heif",
                 "a.avif", "a.svg", "a.ICO", "a.psd", "a.AI", "a.dng"]
        names += [f"x{e}" for e in RAW_EXTENSIONS]
        for name in names:
            with self.subTest(file=name):
                self.assertEqual(asset_type_of(name), "image")

    def test_raw_set_matches_registry(self):
        """decoders.RAW_EXTENSIONS 应是注册表中 RAW 扩展名的准确集合。"""
        registered = {e for e, t in EXT_TO_TYPE.items() if t == "image"}
        self.assertEqual(set(RAW_EXTENSIONS), registered & {
            ".crw", ".cr2", ".cr3", ".nef", ".nrw", ".arw", ".srf", ".sr2", ".raf",
            ".orf", ".rw2", ".rwl", ".pef", ".srw", ".x3f", ".3fr", ".erf", ".iiq",
            ".mrw", ".dng"})

    def test_pillow_can_open_registered_raster_formats(self):
        """注册的栅格格式应能被 Pillow 实际解码（含 HEIF/AVIF 插件）。"""
        cases = {
            "t.bmp": "BMP", "t.tif": "TIFF", "t.jfif": "JPEG",
            "t.heic": "HEIF", "t.heif": "HEIF", "t.avif": "AVIF",
            "t.png": "PNG", "t.ico": "ICO",
        }
        for name, fmt in cases.items():
            with self.subTest(file=name):
                img = Image.new("RGB", (16, 16), "red")
                buf = Path(tempfile.mkdtemp()) / name
                img.save(buf)
                self.assertEqual(Image.open(buf).format, fmt)

    def test_mime_overrides(self):
        self.assertEqual(mime_of("a.jfif"), "image/jpeg")
        self.assertEqual(mime_of("a.bmp"), "image/bmp")
        self.assertEqual(mime_of("a.tiff"), "image/tiff")
        self.assertEqual(mime_of("a.heif"), "image/heif")
        self.assertEqual(mime_of("a.avif"), "image/avif")
        self.assertEqual(mime_of("a.svg"), "image/svg+xml")
        self.assertEqual(mime_of("a.ico"), "image/x-icon")
        self.assertEqual(mime_of("a.psd"), "image/vnd.adobe.photoshop")
        self.assertEqual(mime_of("a.ai"), "application/illustrator")
        self.assertEqual(mime_of("a.dng"), "image/x-adobe-dng")
        self.assertEqual(mime_of("a.nef"), "image/x-nikon-nef")
        self.assertEqual(mime_of("a.cr3"), "image/x-canon-cr3")

    def test_svg_dimensions(self):
        """SVG 尺寸：width/height 属性优先，缺失时回退 viewBox；带单位可解析。"""
        cases = [
            ('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"/>', (800, 600)),
            ('<svg xmlns="http://www.w3.org/2000/svg" width="100px" height="50px"/>', (100, 50)),
            ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900"/>', (1200, 900)),
            ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0,0,300,150"/>', (300, 150)),
            ('<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"/>', (None, None)),
        ]
        for content, expected in cases:
            with self.subTest(svg=content[:60]):
                f = Path(tempfile.mkdtemp()) / "t.svg"
                f.write_text(content)
                self.assertEqual(_svg_dimensions(f), expected)


class TestAiAndRaw(unittest.TestCase):

    def test_ai_pdf_compatible(self):
        """PDF 兼容的 .ai：尺寸取首页页面尺寸，缩略图渲染为 PIL 图。"""
        import pymupdf

        doc = pymupdf.open()
        page = doc.new_page(width=800, height=600)
        page.draw_circle((400, 300), 100, color=(1, 0, 0))
        f = Path(tempfile.mkdtemp()) / "logo.ai"
        doc.save(str(f))
        doc.close()

        self.assertEqual(_ai_dimensions(f), (800, 600))
        img = _load_source(f, ".ai")
        self.assertEqual(img.mode, "RGB")
        self.assertEqual(max(img.size), 2560)  # 长边渲染到 2560

    def test_ai_old_eps_format_marks_warning(self):
        """老式 EPS 格式 .ai 打不开时应抛异常（上层记 parse_warning 照常入库）。"""
        f = Path(tempfile.mkdtemp()) / "old.ai"
        f.write_text("%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 100 100\n")
        with self.assertRaises(Exception):
            _ai_dimensions(f)

    def test_raw_decode_from_dng_fixture(self):
        """真实 DNG：完整解码出像素（样本无内嵌预览，覆盖 postprocess 兜底路径）。"""
        img = _load_source(FIXTURES / "DNG.dng", ".dng")
        self.assertEqual((img.width, img.height), (3474, 2314))
        self.assertEqual(img.mode, "RGB")

    def test_raw_metadata_from_nef_fixture(self):
        """真实 NEF：exifread + rawpy 元数据（机身/型号/ISO/尺寸），不解码像素。"""
        fields = _raw_fields(FIXTURES / "Nikon.nef")
        self.assertEqual(fields["camera_make"], "NIKON CORPORATION")
        self.assertEqual(fields["camera_model"], "NIKON D70")
        self.assertEqual(fields["iso"], 200)
        self.assertEqual((fields["width"], fields["height"]), (3039, 2014))

    def test_raw_exif_mapping_synthetic_tiff(self):
        """exifread 标签映射：光圈/快门/焦距/时间/GPS 的换算逻辑（合成 TIFF 驱动）。"""
        img = Image.new("RGB", (40, 30), "blue")
        exif = Image.Exif()
        exif[271] = "Canon"
        exif[272] = "Canon EOS R6"
        exif[274] = 1
        exif[306] = "2024:05:01 12:34:56"
        ifd = exif.get_ifd(0x8769)
        ifd[36867] = "2024:05:01 12:34:56"
        ifd[34855] = 800
        ifd[33437] = 2.8
        ifd[33434] = 1 / 250
        ifd[37386] = 85.0
        ifd[42036] = "RF 85mm F1.2"
        gps = exif.get_ifd(0x8825)
        gps[1] = "N"
        gps[2] = (31.0, 22.0, 22.12)
        gps[3] = "E"
        gps[4] = (120.0, 37.0, 12.0)
        f = Path(tempfile.mkdtemp()) / "t.tif"
        img.save(f, exif=exif.tobytes())

        fields = _raw_exif(f)
        self.assertEqual(fields["camera_make"], "Canon")
        self.assertEqual(fields["camera_model"], "Canon EOS R6")
        self.assertEqual(fields["iso"], 800)
        self.assertEqual(fields["aperture"], 2.8)
        self.assertEqual(fields["shutter"], "1/250s")
        self.assertEqual(fields["focal_length_mm"], 85.0)
        self.assertEqual(fields["lens"], "RF 85mm F1.2")
        self.assertEqual(fields["orientation"], 1)
        self.assertEqual(fields["taken_at"], dt.datetime(2024, 5, 1, 12, 34, 56, tzinfo=dt.timezone.utc))
        self.assertAlmostEqual(fields["gps_lat"], 31.372811, places=5)  # 31°22′22.12″
        self.assertAlmostEqual(fields["gps_long"], 120.62, places=5)


if __name__ == "__main__":
    unittest.main()
