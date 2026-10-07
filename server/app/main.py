"""应用装配：生命周期（建表/引导管理员/Meili 索引）、统一错误、CORS、路由。"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select

from app.api import admin, assets, auth, search, tags
from app.domains.images.router import router as images_router
from app.domains.fonts.router import router as fonts_router
from app.domains.books.router import router as books_router, progress_router as books_progress_router
from app.domains.music.router import router as music_router
from app.domains.videos.router import router as videos_router, admin_router as videos_admin_router
from app.api.m6 import router as m6_router, share_public as share_public_router
from app.core.config import get_settings
from app.core.db import Base, SessionLocal, engine
from app.core.errors import ApiError, api_error_handler
from app.core.models import Asset, User  # noqa: F401
from app.core.security import hash_password

log = logging.getLogger("portal.main")


async def bootstrap() -> None:
    """建表 + 引导管理员 + 默认设置（幂等）。生产迁移切 Alembic（规划 D 决策）。"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with SessionLocal() as db:
        count = (await db.execute(select(func.count()).select_from(User))).scalar_one()
        s = get_settings()
        if count == 0:
            db.add(User(
                username=s.bootstrap_admin_username,
                password_hash=hash_password(s.bootstrap_admin_password),
                role="admin",
            ))
            log.info("bootstrap admin created: %s", s.bootstrap_admin_username)
        await db.commit()
    try:
        from app.core import search as meili

        await meili.ensure_indexes()
    except Exception as exc:  # noqa: BLE001
        log.warning("Meilisearch 不可达，搜索暂不可用: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await bootstrap()
    yield


app = FastAPI(
    title="个人资产门户 API",
    description="个人资产管理门户（字体 / 音乐 / 视频 / 书籍 / 图片）的后端接口："
                "浏览、搜索、下载、打包、分享与后台管理。\n\n"
                "**权限三级**：公开（游客可访问）· 登录（member）· 管理员（admin），各接口的权限口径见其描述。",
    version="0.1.0",
    lifespan=lifespan,
    openapi_tags=[
        {"name": "认证", "description": "注册、登录、注销与当前用户信息。"},
        {"name": "资产", "description": "资产浏览 / 详情 / 下载 / 编辑 / 删除 / 标签挂载 / 上传入库。"},
        {"name": "标签", "description": "标签的增删改查（读公开、写需管理员）。"},
        {"name": "搜索", "description": "基于 Meilisearch 的全局聚合搜索（需登录）。"},
        {"name": "管理", "description": "目录扫描、任务中心与系统设置（管理员）。"},
        {"name": "图片", "description": "缩略图（公开）与原图（需登录）。"},
        {"name": "字体", "description": "字体文件流与字符集（需登录），样张预览（公开）。"},
        {"name": "书籍", "description": "书籍文件流 / 封面 / EPUB 章节与内部资源。"},
        {"name": "阅读进度", "description": "阅读、观看进度的保存与读取（需登录）。"},
        {"name": "音乐", "description": "专辑墙（公开）、曲目列表与音频流（需登录）。"},
        {"name": "视频", "description": "系列墙（公开）、集数与视频流（需登录）、封面与确认队列（管理员）。"},
        {"name": "打包与分享", "description": "打包下载、分享链接（带过期）与智能集合。"},
    ],
)
app.add_exception_handler(ApiError, api_error_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[get_settings().frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", summary="健康检查", description="服务存活探针，无需鉴权。")
async def health():
    return {"ok": True}


app.include_router(auth.router)
app.include_router(tags.router)
app.include_router(search.router)
app.include_router(admin.router)
app.include_router(images_router)  # M1：/api/images/{id}/thumbnail|original
app.include_router(fonts_router)   # M2：/api/fonts/{id}/file|charset|preview/specimen
app.include_router(books_router)        # M3：/api/books/{id}/file|cover
app.include_router(books_progress_router)  # M3：/api/progress
app.include_router(music_router)        # M4：/api/music/albums|tracks|{id}/stream
app.include_router(videos_router)        # M5：/api/videos/series|stream|cover
app.include_router(videos_admin_router)  # M5：确认队列与封面（挂在 /api/admin 下）
app.include_router(m6_router)             # M6：打包/分享/智能集合
app.include_router(share_public_router)   # M6：公开分享（token 鉴权）
app.include_router(assets.router)  # 注意：含 /{route} 兜底，需在最后注册
