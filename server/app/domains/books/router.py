"""书籍端点（详细设计 §5.4/§6.3）：文件流（登录，Range 由 Starlette FileResponse 支持）、封面（公开）、阅读进度。"""

import uuid

from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import require_member
from app.core.db import get_db
from app.core.errors import not_found
from app.core.models import Asset, User, UserProgress
from app.core.pipeline import build_storage, roots_of

router = APIRouter(prefix="/api/books", tags=["书籍"])
progress_router = APIRouter(prefix="/api/progress", tags=["阅读进度"])


@router.get("/{asset_id}/file", summary="书籍文件流",
            description="登录用户。返回书籍原文件（支持 Range 分段），供 pdf.js / epub.js / 自建阅读器拉取。")
async def book_file(asset_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: object = Depends(require_member)):
    """书籍文件流（pdf.js / epub.js 拉取）；需登录。"""
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
    """公开：封面属于浏览页的一部分（§5.5 同款口径）。"""
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
                      description="登录用户。保存当前用户在某资产上的阅读 / 观看位置（position 结构由前端自定义，如 {\"seconds\": 123}）。")
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


# ---------- M3 自建阅读器：章节目录 + zip 内资源服务（详细设计 §5.4；foliate-js 方案换成自实现） ----------

import posixpath
import zipfile
import xml.etree.ElementTree as ET

from fastapi import Response

CT_BY_EXT = {
    ".xhtml": "application/xhtml+xml", ".html": "text/html", ".htm": "text/html",
    ".css": "text/css", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".svg": "image/svg+xml", ".gif": "image/gif", ".webp": "image/webp", ".ncx": "application/x-dtbncx+xml",
}


async def _open_epub_zip(a: Asset, db: AsyncSession) -> tuple[zipfile.ZipFile, str, dict, list, str | None]:
    storage = build_storage(await roots_of(db))
    path = storage.resolve(a.storage_key)
    z = zipfile.ZipFile(path)
    container = ET.fromstring(z.read("META-INF/container.xml"))
    rootfile = container.find(".//{urn:oasis:names:tc:opendocument:xmlns:container}rootfile")
    opf_path = rootfile.get("full-path")
    opf = ET.fromstring(z.read(opf_path))
    opf_dir = posixpath.dirname(opf_path)
    manifest = {it.get("id"): it.get("href") for it in opf.find("{http://www.idpf.org/2007/opf}manifest").findall("{http://www.idpf.org/2007/opf}item")}
    spine = [manifest.get(ref.get("idref"), "") for ref in opf.find("{http://www.idpf.org/2007/opf}spine").findall("{http://www.idpf.org/2007/opf}itemref")]
    # 章节标题：优先 ncx navMap
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


@router.get("/{asset_id}/contents", summary="EPUB 章节目录",
            description="登录用户。解析 EPUB 返回章节列表（index / href / 标题）；仅 epub 支持，其他格式返回 404。")
async def book_contents(asset_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: object = Depends(require_member)):
    a = await db.get(Asset, asset_id)
    if a is None or a.deleted_at is not None or a.asset_type != "book":
        raise not_found()
    ext = (a.file_name.rsplit(".", 1)[-1] or "").lower()
    if ext != "epub":
        raise not_found("仅 epub 支持章节阅读")
    z, opf_dir, _manifest, spine, titles = await _open_epub_zip(a, db)
    chapters = []
    for i, href in enumerate(spine):
        full = posixpath.join(opf_dir, href) if opf_dir else href
        key = posixpath.normpath(full)
        chapters.append({"index": i, "href": key, "title": titles.get(posixpath.normpath(href), titles.get(key)) or f"第 {i + 1} 节"})
    z.close()
    return {"chapters": chapters}


@router.get("/{asset_id}/resource", summary="EPUB 内部资源",
            description="登录用户。按 zip 内相对路径返回章节 XHTML / CSS / 图片等资源，供自建阅读器渲染。")
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
    media = CT_BY_EXT.get(posixpath.splitext(key)[1].lower(), "application/octet-stream")
    return Response(content=data, media_type=media)
