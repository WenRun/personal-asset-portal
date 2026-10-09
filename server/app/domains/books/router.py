"""书籍端点（详细设计 §5.4/§6.3）：文件流、封面、阅读进度、多格式流式章节与 PDF 极速分页渲染。"""

import posixpath
import re
import uuid
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import require_member
from app.core.db import get_db
from app.core.errors import not_found
from app.core.models import Asset, User, UserProgress
from app.core.pipeline import build_storage, roots_of
from app.domains.books.parser import ensure_reader_epub

router = APIRouter(prefix="/api/books", tags=["书籍"])
progress_router = APIRouter(prefix="/api/progress", tags=["阅读进度"])

CT_BY_EXT = {
    ".xhtml": "application/xhtml+xml",
    ".html": "text/html",
    ".htm": "text/html",
    ".css": "text/css",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ncx": "application/x-dtbncx+xml",
}


@router.get("/{asset_id}/file", summary="书籍文件流",
            description="登录用户。返回书籍原文件（支持 Range 分段），供客户端下载或直接读取。")
async def book_file(asset_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: object = Depends(require_member)):
    a = await db.get(Asset, asset_id)
    if a is None or a.deleted_at is not None or a.asset_type != "book":
        raise not_found()
    storage = build_storage(await roots_of(db))
    return FileResponse(storage.resolve(a.storage_key), filename=a.file_name,
                        media_type=a.mime_type or "application/octet-stream")


@router.get("/{asset_id}/cover", summary="书籍封面",
            description="公开。WebP 封面，size 支持 256 / 1024；长缓存一年（immutable）。")
async def book_cover(asset_id: uuid.UUID, size: int = Query(256, description="封面边长档位：256 / 1024"),
                     db: AsyncSession = Depends(get_db)):
    if size not in (256, 1024):
        raise not_found("size 仅支持 256/1024")
    a = await db.get(Asset, asset_id)
    if a is None or a.deleted_at is not None or a.asset_type != "book":
        raise not_found()
    p = get_settings().data_root / "derived" / "books" / str(a.id) / f"cover_{size}.webp"
    if not p.is_file():
        raise not_found("封面尚未生成")
    return FileResponse(p, media_type="image/webp",
                        headers={"Cache-Control": "public, max-age=31536000, immutable"})


class ProgressBody(BaseModel):
    asset_id: uuid.UUID
    position: dict


@progress_router.post("", summary="保存进度",
                      description="登录用户。保存当前用户在某资产上的阅读 / 观看位置。")
async def save_progress(body: ProgressBody, db: AsyncSession = Depends(get_db), user: User = Depends(require_member)):
    row = await db.get(UserProgress, {"user_id": user.id, "asset_id": body.asset_id})
    if row is None:
        row = UserProgress(user_id=user.id, asset_id=body.asset_id, position=body.position)
        db.add(row)
    else:
        row.position = body.position
    await db.commit()
    return {"ok": True}


@progress_router.get("", summary="读取进度",
                     description="登录用户。读取当前用户在某资产上的进度；无记录时返回 null。")
async def get_progress(asset_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: User = Depends(require_member)):
    row = await db.get(UserProgress, {"user_id": user.id, "asset_id": asset_id})
    if row is None:
        return None
    return {"position": row.position, "updated_at": row.updated_at.isoformat()}


# ---------- 流式书籍阅读器（EPUB / MOBI / AZW3 / TXT）：统一解析与资源服务 ----------

async def _open_epub_zip(a: Asset, db: AsyncSession) -> tuple[zipfile.ZipFile, str, dict, list, dict[str, str]]:
    storage = build_storage(await roots_of(db))
    raw_path = Path(storage.resolve(a.storage_key))
    epub_path = ensure_reader_epub(a, raw_path)

    z = zipfile.ZipFile(epub_path)
    container = ET.fromstring(z.read("META-INF/container.xml"))
    rootfile = container.find(".//{urn:oasis:names:tc:opendocument:xmlns:container}rootfile")
    opf_path = rootfile.get("full-path")
    opf = ET.fromstring(z.read(opf_path))
    opf_dir = posixpath.dirname(opf_path)
    manifest = {it.get("id"): it.get("href") for it in opf.find("{http://www.idpf.org/2007/opf}manifest").findall("{http://www.idpf.org/2007/opf}item")}
    spine = [manifest.get(ref.get("idref"), "") for ref in opf.find("{http://www.idpf.org/2007/opf}spine").findall("{http://www.idpf.org/2007/opf}itemref")]

    titles: dict[str, str] = {}
    ncx_id = opf.find("{http://www.idpf.org/2007/opf}spine").get("toc")
    if ncx_id and manifest.get(ncx_id):
        try:
            ncx_path = posixpath.join(opf_dir, manifest[ncx_id]) if opf_dir else manifest[ncx_id]
            ncx = ET.fromstring(z.read(ncx_path))
            for np in ncx.iter("{http://www.daisy.org/z3986/2005/ncx/}navPoint"):
                label = np.find("{http://www.daisy.org/z3986/2005/ncx/}navLabel/{http://www.daisy.org/z3986/2005/ncx/}text")
                src = np.find("{http://www.daisy.org/z3986/2005/ncx/}content")
                if label is not None and label.text and src is not None and src.get("src"):
                    titles[src.get("src").split("#")[0]] = label.text.strip()
        except ET.ParseError:
            pass
    return z, opf_dir, manifest, spine, titles


def _rewrite_html_resources(content_bytes: bytes, current_path: str, asset_id: str) -> bytes:
    """将 XHTML/HTML 内的图片和样式相对链接改写为 /api/books/{asset_id}/resource?path=..."""
    try:
        html_str = content_bytes.decode("utf-8", errors="replace")
        cur_dir = posixpath.dirname(current_path)

        def repl(m):
            attr = m.group(1)
            quote = m.group(2)
            target = m.group(3)
            if target.startswith(("http://", "https://", "data:", "/api/")):
                return m.group(0)
            norm = posixpath.normpath(posixpath.join(cur_dir, target)).lstrip("/")
            return f"{attr}={quote}/api/books/{asset_id}/resource?path={norm}{quote}"

        pattern = re.compile(r'(\b(?:src|href|xlink:href))=([\"\'])(.*?)\2', re.IGNORECASE)
        rewritten = pattern.sub(repl, html_str)
        return rewritten.encode("utf-8")
    except Exception:
        return content_bytes


@router.get("/{asset_id}/contents", summary="章节目录大纲",
            description="登录用户。返回 EPUB / MOBI / AZW3 / TXT 的结构化章节列表（index / href / 标题）。")
async def book_contents(asset_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: object = Depends(require_member)):
    a = await db.get(Asset, asset_id)
    if a is None or a.deleted_at is not None or a.asset_type != "book":
        raise not_found()
    ext = (a.file_name.rsplit(".", 1)[-1] or "").lower()
    if ext not in ("epub", "mobi", "azw3", "txt"):
        raise not_found(f"格式 {ext} 暂不支持流式章节阅读")

    z, opf_dir, _manifest, spine, titles = await _open_epub_zip(a, db)
    chapters = []
    for i, href in enumerate(spine):
        full = posixpath.join(opf_dir, href) if opf_dir else href
        key = posixpath.normpath(full)
        chapters.append({
            "index": i,
            "href": key,
            "title": titles.get(posixpath.normpath(href), titles.get(key)) or f"第 {i + 1} 节",
        })
    z.close()
    return {"chapters": chapters}


@router.get("/{asset_id}/resource", summary="书籍内部资源",
            description="登录用户。按相对路径读取书籍章节 XHTML / CSS / 插图等资源。")
async def book_resource(asset_id: uuid.UUID, path: str, db: AsyncSession = Depends(get_db), _: object = Depends(require_member)):
    a = await db.get(Asset, asset_id)
    if a is None or a.deleted_at is not None or a.asset_type != "book":
        raise not_found()
    z, _opf_dir, _m, _s, _t = await _open_epub_zip(a, db)
    key = posixpath.normpath(path).lstrip("/")
    if key not in z.namelist():
        z.close()
        raise not_found(f"资源不存在: {key}")
    data = z.read(key)
    z.close()

    ext = posixpath.splitext(key)[1].lower()
    if ext in (".xhtml", ".html", ".htm"):
        data = _rewrite_html_resources(data, key, str(asset_id))

    media = CT_BY_EXT.get(ext, "application/octet-stream")
    return Response(content=data, media_type=media)


# ---------- PDF 极速高清分页渲染与目录书签 ----------

@router.get("/{asset_id}/pdf/meta", summary="PDF 元数据与书签大纲",
            description="登录用户。返回 PDF 页数与目录书签大纲（TOC）。")
async def pdf_meta(asset_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: object = Depends(require_member)):
    a = await db.get(Asset, asset_id)
    if a is None or a.deleted_at is not None or a.asset_type != "book":
        raise not_found()
    ext = (a.file_name.rsplit(".", 1)[-1] or "").lower()
    if ext != "pdf":
        raise not_found("仅 PDF 支持此接口")

    storage = build_storage(await roots_of(db))
    raw_path = storage.resolve(a.storage_key)

    import pymupdf

    doc = pymupdf.open(str(raw_path))
    page_count = doc.page_count
    raw_toc = doc.get_toc()  # [[lvl, title, page, ...], ...]
    doc.close()

    toc = []
    for item in raw_toc:
        if len(item) >= 3:
            toc.append({
                "level": item[0],
                "title": (item[1] or "").strip() or "未命名书签",
                "page": item[2],
            })

    return {"page_count": page_count, "toc": toc}


@router.get("/{asset_id}/pdf/page/{page_num}", summary="PDF 极速分页渲染",
            description="登录用户。以指定 DPI 极速将 PDF 单页渲染为 WebP 图片直接输出。")
async def pdf_page(asset_id: uuid.UUID, page_num: int, dpi: int = Query(150, ge=72, le=300),
                   db: AsyncSession = Depends(get_db), _: object = Depends(require_member)):
    a = await db.get(Asset, asset_id)
    if a is None or a.deleted_at is not None or a.asset_type != "book":
        raise not_found()
    ext = (a.file_name.rsplit(".", 1)[-1] or "").lower()
    if ext != "pdf":
        raise not_found("仅 PDF 支持此接口")

    storage = build_storage(await roots_of(db))
    raw_path = storage.resolve(a.storage_key)

    import pymupdf

    doc = None
    try:
        doc = pymupdf.open(str(raw_path))
        if page_num < 1 or page_num > doc.page_count:
            raise not_found(f"页码超出范围: 1..{doc.page_count}")

        page = doc[page_num - 1]
        pix = page.get_pixmap(dpi=dpi)
        try:
            data = pix.tobytes("jpg")
            media = "image/jpeg"
        except Exception:
            data = pix.tobytes("png")
            media = "image/png"

        return Response(content=data, media_type=media,
                        headers={"Cache-Control": "public, max-age=86400"})
    finally:
        if doc is not None:
            doc.close()
