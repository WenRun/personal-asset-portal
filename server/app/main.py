"""应用装配：生命周期（建表/引导管理员/Meili 索引）、统一错误、CORS、路由。"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select

from app.api import admin, assets, auth, search, tags
from app.domains.images.router import router as images_router
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


app = FastAPI(title="Asset Portal API", version="0.1.0", lifespan=lifespan)
app.add_exception_handler(ApiError, api_error_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[get_settings().frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"ok": True}


app.include_router(auth.router)
app.include_router(tags.router)
app.include_router(search.router)
app.include_router(admin.router)
app.include_router(images_router)  # M1：/api/images/{id}/thumbnail|original
app.include_router(assets.router)  # 注意：含 /{route} 兜底，需在最后注册
