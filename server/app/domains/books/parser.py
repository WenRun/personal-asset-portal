"""书籍入库解析（详细设计 §5.4）：epub OPF / pdf PyMuPDF / mobi-azw3 / txt 解析 → book_details + 封面 + reader.epub 归一化。"""

import html
import io
import os
import posixpath
import re
import shutil
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime as dt
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.models import Asset, BookDetail
from app.core.pipeline import build_storage, register, roots_of
from app.core.registry import ext_of

NS = {
    "c": "urn:oasis:names:tc:opendocument:xmlns:container",
    "opf": "http://www.idpf.org/2007/opf",
    "dc": "http://purl.org/dc/elements/1.1/",
}

COVER_MIME_EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


def derived_dir(asset_id) -> Path:
    return Path(get_settings().data_root) / "derived" / "books" / str(asset_id)


def _get_cjk_font(size: int):
    candidates = [
        # macOS
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
        "/System/Library/Fonts/Supplemental/Songti.ttc",
        # Linux (Debian / Ubuntu / Docker)
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
    ]
    for p in candidates:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def _generate_synthetic_cover(title: str, author: str = "", format_name: str = "TXT") -> bytes:
    """使用 PIL 合成雅致图书封面（米黄纸质底、内框衬线、居中大字）"""
    w, h = 600, 800
    img = Image.new("RGB", (w, h), color=(246, 241, 231))
    draw = ImageDraw.Draw(img)

    # 边框装饰
    draw.rectangle([(22, 22), (w - 22, h - 22)], outline=(210, 195, 175), width=2)
    draw.rectangle([(28, 28), (w - 28, h - 28)], outline=(225, 215, 200), width=1)

    font_badge = _get_cjk_font(18)
    draw.text((w // 2, 75), f"· {format_name.upper()} 电子书 ·", fill=(150, 130, 110), anchor="mm", font=font_badge)

    font_title = _get_cjk_font(32)
    title_text = title if len(title) <= 30 else title[:28] + "…"
    lines = []
    while len(title_text) > 10:
        lines.append(title_text[:10])
        title_text = title_text[10:]
    if title_text:
        lines.append(title_text)

    start_y = 300 - (len(lines) * 26)
    for i, line in enumerate(lines):
        draw.text((w // 2, start_y + i * 52), line, fill=(45, 40, 35), anchor="mm", font=font_title)

    if author:
        font_author = _get_cjk_font(20)
        draw.text((w // 2, 510), f"著：{author}", fill=(115, 100, 85), anchor="mm", font=font_author)

    font_footer = _get_cjk_font(16)
    draw.text((w // 2, 725), "个人资产库 · 馆藏", fill=(175, 160, 145), anchor="mm", font=font_footer)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def _decode_text(raw_bytes: bytes) -> str:
    """级联探测编码：utf-8-sig -> utf-8 -> gb18030(兼容GBK) -> big5"""
    for enc in ("utf-8-sig", "utf-8", "gb18030", "big5"):
        try:
            return raw_bytes.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return raw_bytes.decode("utf-8", errors="replace")


def _txt_to_epub_bytes(text: str, title: str, author: str = "") -> bytes:
    """将纯文本内容正则分章并封装为标准的 EPUB 格式字节流"""
    lines = text.splitlines()
    chapter_pattern = re.compile(
        r"^\s*(第[0-9一二三四五六七八九十百千万]+[章回节卷集部篇话].*|Chapter\s+[0-9]+.*|引子|序言|楔子|尾声|后记|前言)\s*$",
        re.IGNORECASE,
    )

    chapters: list[tuple[str, list[str]]] = []
    current_title = "序言"
    current_paras: list[str] = []

    for line in lines:
        s = line.strip()
        if not s:
            continue
        if chapter_pattern.match(s):
            if current_paras:
                chapters.append((current_title, current_paras))
                current_paras = []
            current_title = s
        else:
            current_paras.append(s)

    if current_paras:
        chapters.append((current_title, current_paras))

    if not chapters:
        chapters = [("正文", ["暂无内容"])]
    elif len(chapters) == 1 and len(chapters[0][1]) > 80:
        all_paras = chapters[0][1]
        chunk_size = 50
        chapters = []
        for i in range(0, len(all_paras), chunk_size):
            chunk = all_paras[i : i + chunk_size]
            chapters.append((f"第 {len(chapters) + 1} 节", chunk))

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        )

        manifest_items = ['<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>']
        spine_items = []
        nav_items = []

        for idx, (chap_title, paras) in enumerate(chapters):
            href = f"chapter_{idx}.xhtml"
            manifest_items.append(f'<item id="c_{idx}" href="{href}" media-type="application/xhtml+xml"/>')
            spine_items.append(f'<itemref idref="c_{idx}"/>')
            safe_title = html.escape(chap_title)
            nav_items.append(f"""<navPoint id="np_{idx}" playOrder="{idx + 1}">
  <navLabel><text>{safe_title}</text></navLabel>
  <content src="{href}"/>
</navPoint>""")

            body_html = "".join(f"<p>{html.escape(p)}</p>\n" for p in paras)
            xhtml = f"""<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>{safe_title}</title>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <style type="text/css">
    body {{ font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; line-height: 1.8; margin: 1em; }}
    h2 {{ text-align: center; margin: 1.5em 0 1em; font-size: 1.3em; }}
    p {{ text-indent: 2em; margin: 0 0 0.8em; }}
  </style>
</head>
<body>
  <h2>{safe_title}</h2>
  {body_html}
</body>
</html>"""
            z.writestr(f"OEBPS/{href}", xhtml)

        opf = f"""<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>{html.escape(title)}</dc:title>
    <dc:creator>{html.escape(author)}</dc:creator>
    <dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>
    {''.join(manifest_items)}
  </manifest>
  <spine toc="ncx">
    {''.join(spine_items)}
  </spine>
</package>"""
        z.writestr("OEBPS/content.opf", opf)

        ncx = f"""<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <docTitle><text>{html.escape(title)}</text></docTitle>
  <navMap>
    {''.join(nav_items)}
  </navMap>
</ncx>"""
        z.writestr("OEBPS/toc.ncx", ncx)

    return buf.getvalue()


def _mobi7_to_epub_bytes(mobi7_dir: Path, title: str, author: str = "") -> bytes:
    """将解包出的旧版 mobi7 目录转换为标准 EPUB 字节流"""
    html_file = mobi7_dir / "book.html"
    raw_html = html_file.read_text(encoding="utf-8", errors="ignore") if html_file.exists() else "<html><body><p>正文</p></body></html>"

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("mimetype", "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        )

        manifest_items = [
            '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
            '<item id="c0" href="chapter_0.xhtml" media-type="application/xhtml+xml"/>',
        ]

        for f in mobi7_dir.iterdir():
            if f.is_file() and f.name != "book.html":
                ext = f.suffix.lower()
                mtype = "image/jpeg" if ext in (".jpg", ".jpeg") else "image/png" if ext == ".png" else "application/octet-stream"
                z.write(f, f"OEBPS/{f.name}")
                manifest_items.append(f'<item id="img_{f.stem}" href="{f.name}" media-type="{mtype}"/>')

        xhtml = f"""<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>{html.escape(title)}</title>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <style type="text/css">
    body {{ font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; line-height: 1.8; margin: 1em; }}
    img {{ max-width: 100%; height: auto; }}
  </style>
</head>
<body>
  {raw_html}
</body>
</html>"""
        z.writestr("OEBPS/chapter_0.xhtml", xhtml)

        opf = f"""<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>{html.escape(title)}</dc:title>
    <dc:creator>{html.escape(author)}</dc:creator>
    <dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>
    {''.join(manifest_items)}
  </manifest>
  <spine toc="ncx">
    <itemref idref="c0"/>
  </spine>
</package>"""
        z.writestr("OEBPS/content.opf", opf)

        ncx = f"""<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <docTitle><text>{html.escape(title)}</text></docTitle>
  <navMap>
    <navPoint id="np0" playOrder="1">
      <navLabel><text>正文</text></navLabel>
      <content src="chapter_0.xhtml"/>
    </navPoint>
  </navMap>
</ncx>"""
        z.writestr("OEBPS/toc.ncx", ncx)

    return buf.getvalue()


def _parse_epub(path, meta: dict) -> dict:
    with zipfile.ZipFile(path) as z:
        container = ET.fromstring(z.read("META-INF/container.xml"))
        rootfile = container.find(".//c:rootfile", NS)
        if rootfile is None:
            raise ValueError("epub 缺少 rootfile")
        opf_path = rootfile.get("full-path")
        opf = ET.fromstring(z.read(opf_path))
        opf_dir = posixpath.dirname(opf_path)
        md = opf.find("opf:metadata", NS)

        def dc(tag: str) -> str | None:
            el = md.find(f"dc:{tag}", NS)
            return el.text.strip() if el is not None and el.text and el.text.strip() else None

        authors = [el.text.strip() for el in md.findall("dc:creator", NS) if el.text and el.text.strip()]
        date = dc("date")
        meta["epub_title_raw"] = dc("title") or ""

        # 封面：manifest properties=cover-image 优先，回落 <meta name=cover>，再回落首个图片项
        items = {}
        for it in opf.find("opf:manifest", NS).findall("opf:item", NS):
            items[it.get("id")] = {"href": it.get("href"), "type": it.get("media-type"), "props": it.get("properties") or ""}
        cover_id = next((i for i, v in items.items() if "cover-image" in v["props"]), None)
        if cover_id is None:
            for m in md.findall("opf:meta", NS):
                if m.get("name") == "cover" and m.get("content") in items:
                    cover_id = m.get("content")
                    break
        cover_bytes = None
        cover_ext = "jpg"
        if cover_id:
            v = items[cover_id]
            cover_bytes = z.read(posixpath.join(opf_dir, v["href"]) if opf_dir else v["href"])
            cover_ext = COVER_MIME_EXT.get(v["type"] or "", "jpg")

        return {
            "fields": {
                "authors": authors,
                "publisher": dc("publisher"),
                "pub_year": int(date[:4]) if date and date[:4].isdigit() else None,
                "isbn": dc("identifier") if dc("identifier") and "isbn" in (dc("identifier") or "").lower() else dc("identifier"),
                "language": dc("language"),
                "format": "epub",
            },
            "desc": dc("description"),
            "cover_bytes": cover_bytes,
            "cover_ext": cover_ext,
            "title": dc("title"),
        }


def _parse_pdf(path, meta: dict) -> dict:
    import pymupdf

    doc = pymupdf.open(str(path))
    md = doc.metadata or {}
    pages = doc.page_count
    meta["pages"] = pages
    cover = doc[0].get_pixmap(dpi=110).tobytes("png")
    doc.close()
    return {
        "fields": {"authors": [md["author"]] if md.get("author") else [], "format": "pdf", "pages": pages},
        "desc": None,
        "cover_bytes": cover,
        "cover_ext": "png",
        "title": (md.get("title") or "").strip() or None,
    }


def _parse_txt(path: Path, meta: dict, title_hint: str) -> dict:
    """TXT 小说：解码、识别标题/作者、分章生成标准 reader.epub 与合成封面"""
    raw_bytes = path.read_bytes()
    text = _decode_text(raw_bytes)

    # 尝试从前 25 行提取书名与作者
    title = title_hint
    author = ""
    lines = [line.strip() for line in text.splitlines()[:25] if line.strip()]
    for line in lines:
        m_title = re.search(r"(?:《([^》]+)》|书名[:：]\s*(\S+))", line)
        if m_title and not title:
            title = m_title.group(1) or m_title.group(2)
        m_author = re.search(r"作者[:：]\s*(\S+)", line)
        if m_author and not author:
            author = m_author.group(1)

    title = title or title_hint
    epub_bytes = _txt_to_epub_bytes(text, title, author)
    cover_bytes = _generate_synthetic_cover(title, author, "TXT")

    return {
        "fields": {
            "authors": [author] if author else [],
            "format": "txt",
            "language": "zh-CN",
        },
        "desc": text[:300].strip(),
        "title": title,
        "cover_bytes": cover_bytes,
        "cover_ext": "jpg",
        "epub_bytes": epub_bytes,
    }


def _parse_mobi_azw3(path: Path, meta: dict, title_hint: str, ext: str) -> dict:
    """MOBI / AZW3：解包提取标准 EPUB 结构，提取封面与元数据"""
    import mobi

    tmpdir, extracted = mobi.extract(str(path))
    cover_bytes = None
    cover_ext = "jpg"
    epub_bytes = None
    parsed_meta = {}

    try:
        # 寻找封面文件
        for f in os.listdir(tmpdir):
            if f.lower().startswith("cover"):
                cover_bytes = (Path(tmpdir) / f).read_bytes()
                cover_ext = f.rsplit(".", 1)[-1].lower()
                break

        if extracted.endswith(".epub") and os.path.isfile(extracted):
            epub_bytes = Path(extracted).read_bytes()
            try:
                parsed_meta = _parse_epub(extracted, meta)
                if not cover_bytes and parsed_meta.get("cover_bytes"):
                    cover_bytes = parsed_meta["cover_bytes"]
                    cover_ext = parsed_meta.get("cover_ext", "jpg")
            except Exception:
                pass
        elif os.path.exists(extracted):
            extracted_path = Path(extracted)
            target_dir = extracted_path.parent if extracted_path.is_file() else extracted_path
            epub_bytes = _mobi7_to_epub_bytes(target_dir, title_hint, "")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    title = parsed_meta.get("title") or title_hint
    author_list = parsed_meta.get("fields", {}).get("authors", [])
    author = author_list[0] if author_list else ""

    if not cover_bytes:
        cover_bytes = _generate_synthetic_cover(title, author, ext.upper())
        cover_ext = "jpg"

    fields = {
        "format": ext,
        "authors": author_list,
        "publisher": parsed_meta.get("fields", {}).get("publisher"),
        "pub_year": parsed_meta.get("fields", {}).get("pub_year"),
        "isbn": parsed_meta.get("fields", {}).get("isbn"),
        "language": parsed_meta.get("fields", {}).get("language"),
    }

    return {
        "fields": fields,
        "desc": parsed_meta.get("desc"),
        "title": title,
        "cover_bytes": cover_bytes,
        "cover_ext": cover_ext,
        "epub_bytes": epub_bytes,
    }


def ensure_reader_epub(asset: Asset, raw_path: Path) -> Path:
    """确保书籍具有可供章节阅读器加载的 EPUB 文件（针对 mobi/azw3/txt 自动派生归一化缓存）"""
    ext = (asset.file_name.rsplit(".", 1)[-1] or "").lower()
    if ext == "epub":
        return raw_path

    out_epub = derived_dir(asset.id) / "reader.epub"
    if out_epub.is_file():
        return out_epub

    out_epub.parent.mkdir(parents=True, exist_ok=True)
    title_hint = asset.title or asset.file_name.rsplit(".", 1)[0]

    if ext == "txt":
        r = _parse_txt(raw_path, {}, title_hint)
        if r.get("epub_bytes"):
            out_epub.write_bytes(r["epub_bytes"])
            return out_epub
    elif ext in ("mobi", "azw3"):
        r = _parse_mobi_azw3(raw_path, {}, title_hint, ext)
        if r.get("epub_bytes"):
            out_epub.write_bytes(r["epub_bytes"])
            return out_epub

    raise ValueError(f"无法为格式 {ext} 派生 reader.epub")


@register("parse:book")
async def parse_book(db: AsyncSession, payload: dict) -> None:
    asset = await db.get(Asset, payload["asset_id"])
    if asset is None:
        return

    storage = build_storage(await roots_of(db))
    path = storage.resolve(asset.storage_key)
    ext = ext_of(asset.file_name).lstrip(".")

    meta: dict = {"ext": ext}
    fields: dict = {"format": ext}
    desc = None
    title = None
    cover_bytes = None
    cover_ext = "jpg"
    epub_bytes = None
    title_hint = asset.file_name.rsplit(".", 1)[0]

    try:
        if ext == "epub":
            r = _parse_epub(path, meta)
            fields.update(r["fields"])
            desc = r["desc"]
            cover_bytes = r["cover_bytes"]
            cover_ext = r["cover_ext"]
            title = r["title"]
        elif ext == "pdf":
            r = _parse_pdf(path, meta)
            fields.update(r["fields"])
            cover_bytes = r["cover_bytes"]
            cover_ext = r["cover_ext"]
            title = r["title"]
        elif ext == "txt":
            r = _parse_txt(Path(path), meta, title_hint)
            fields.update(r["fields"])
            desc = r["desc"]
            cover_bytes = r["cover_bytes"]
            cover_ext = r["cover_ext"]
            title = r["title"]
            epub_bytes = r.get("epub_bytes")
        elif ext in ("mobi", "azw3"):
            r = _parse_mobi_azw3(Path(path), meta, title_hint, ext)
            fields.update(r["fields"])
            desc = r["desc"]
            cover_bytes = r["cover_bytes"]
            cover_ext = r["cover_ext"]
            title = r["title"]
            epub_bytes = r.get("epub_bytes")
        else:
            meta["parse_warning"] = f"未知的书籍扩展名: {ext}"
    except Exception as exc:  # noqa: BLE001
        meta["parse_warning"] = f"{type(exc).__name__}: {exc}"

    asset.title = title or asset.title or title_hint
    asset.note = desc or asset.note
    asset.meta = {**asset.meta, **meta}
    asset.status = "ready"

    row = await db.get(BookDetail, asset.id)
    if row is None:
        row = BookDetail(asset_id=asset.id)
        db.add(row)
    for k, v in fields.items():
        setattr(row, k, v)

    await db.commit()
    from app.core.jobs import enqueue

    out_dir = derived_dir(asset.id)
    out_dir.mkdir(parents=True, exist_ok=True)

    if epub_bytes is not None:
        (out_dir / "reader.epub").write_bytes(epub_bytes)

    if cover_bytes is not None:
        (out_dir / f"cover_src.{cover_ext}").write_bytes(cover_bytes)
        await enqueue(db, "derive:book_cover", {"asset_id": str(asset.id)}, priority=5)

    await enqueue(db, "index_meili", {"asset_id": str(asset.id)}, priority=8)
