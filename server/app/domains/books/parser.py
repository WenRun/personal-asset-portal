"""书籍入库解析（详细设计 §5.4）：epub OPF / pdf PyMuPDF / mobi-azw3 尽力解析 → book_details + 封面。"""

import posixpath
import shutil
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime as dt

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import Asset, BookDetail
from app.core.pipeline import build_storage, register, roots_of
from app.core.registry import ext_of

NS = {
    "c": "urn:oasis:names:tc:opendocument:xmlns:container",
    "opf": "http://www.idpf.org/2007/opf",
    "dc": "http://purl.org/dc/elements/1.1/",
}

COVER_MIME_EXT = {"image/jpeg": "jpg", "image/png": "png"}


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

    try:
        if ext == "epub":
            r = _parse_epub(path, meta)
            fields.update(r["fields"]); desc = r["desc"]; cover_bytes = r["cover_bytes"]
            cover_ext = r["cover_ext"]; title = r["title"]
        elif ext == "pdf":
            r = _parse_pdf(path, meta)
            fields.update(r["fields"]); cover_bytes = r["cover_bytes"]
            cover_ext = r["cover_ext"]; title = r["title"]
        elif ext in ("mobi", "azw3"):
            import mobi  # 尽力解析（详细设计 §5.4）

            tmpdir, extracted = mobi.extract(str(path))
            try:
                cover_file = next(
                    (f for f in (__import__("os").listdir(tmpdir)) if f.lower().startswith("cover")),
                    None,
                )
                if cover_file:
                    cover_bytes = open(f"{tmpdir}/{cover_file}", "rb").read()
                    cover_ext = cover_file.rsplit(".", 1)[-1].lower()
            finally:
                shutil.rmtree(tmpdir, ignore_errors=True)
        else:
            meta["parse_warning"] = f"未知的书籍扩展名: {ext}"
    except Exception as exc:  # noqa: BLE001  解析失败：文件名兜底 + 警告
        meta["parse_warning"] = f"{type(exc).__name__}: {exc}"

    asset.title = (title or asset.title or asset.file_name.rsplit(".", 1)[0])
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

    if cover_bytes is not None:
        out_dir = derived_dir(asset.id)
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / f"cover_src.{cover_ext}").write_bytes(cover_bytes)
        await enqueue(db, "derive:book_cover", {"asset_id": str(asset.id)}, priority=5)
    await enqueue(db, "index_meili", {"asset_id": str(asset.id)}, priority=8)


def derived_dir(asset_id) -> "Path":  # noqa: F821
    from pathlib import Path

    from app.core.config import get_settings

    return Path(get_settings().data_root) / "derived" / "books" / str(asset_id)
