"""鉴权依赖（详细设计 §2.1/§4.5）：session cookie → get_current_user → require_member/admin。"""

import datetime as dt
import secrets

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import forbidden, unauthenticated
from app.core.models import SessionToken, Setting, User
from app.core.registry import ASSET_TYPES

COOKIE_NAME = "portal_session"

DEFAULT_ALIAS_TYPES: dict[str, list[str]] = {
    "fonts": ["font"],
    "font": ["font"],
    "music": ["music"],
    "videos": ["video"],
    "video": ["video"],
    "books": ["book"],
    "book": ["book"],
    "images": ["image"],
    "image": ["image"],
    "uploads": list(ASSET_TYPES),
}


async def get_app_settings(db: AsyncSession) -> dict:
    """settings 表 KV（扫描根、注册开关等）；缺省给默认值。"""
    rows = (await db.execute(select(Setting))).scalars().all()
    kv = {r.key: r.value for r in rows}
    kv.setdefault(
        "scan_roots",
        [
            {"alias": "fonts", "path": str(get_settings().data_root / "library" / "fonts"), "types": ["font"]},
            {"alias": "music", "path": str(get_settings().data_root / "library" / "music"), "types": ["music"]},
            {"alias": "videos", "path": str(get_settings().data_root / "library" / "videos"), "types": ["video"]},
            {"alias": "books", "path": str(get_settings().data_root / "library" / "books"), "types": ["book"]},
            {"alias": "images", "path": str(get_settings().data_root / "library" / "images"), "types": ["image"]},
            {"alias": "uploads", "path": str(get_settings().data_root / "library" / "uploads"), "types": list(ASSET_TYPES)},
        ],
    )
    # 向下兼容历史缺少 types 字段的旧配置
    for r in kv["scan_roots"]:
        if "types" not in r or r["types"] is None:
            r["types"] = DEFAULT_ALIAS_TYPES.get(r["alias"], list(ASSET_TYPES))
    kv.setdefault("registration_open", True)
    kv.setdefault("max_upload_gb", get_settings().max_upload_gb)
    return kv


async def create_session(db: AsyncSession, user_id) -> tuple[str, dt.datetime]:
    """生成会话行，返回 (token, expires_at)；cookie 由路由层写入。"""
    token = secrets.token_urlsafe(32)
    expires = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=get_settings().session_ttl_days)
    db.add(SessionToken(id=token, user_id=user_id, expires_at=expires))
    await db.commit()
    return token, expires


async def get_current_user(request: Request, db: AsyncSession = Depends(get_db)) -> User | None:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    row = (
        await db.execute(
            select(SessionToken, User)
            .join(User, User.id == SessionToken.user_id)
            .where(SessionToken.id == token)
        )
    ).first()
    if row is None:
        return None
    sess, user = row
    now = dt.datetime.now(dt.timezone.utc)
    if not user.is_active or sess.expires_at <= now:
        return None
    # 滑动续期：剩余 < 7 天时刷新（详细设计 §2.1）
    if sess.expires_at - now < dt.timedelta(days=7):
        sess.expires_at = now + dt.timedelta(days=get_settings().session_ttl_days)
        await db.commit()
    return user


async def require_member(user: User | None = Depends(get_current_user)) -> User:
    if user is None:
        raise unauthenticated()
    return user


async def require_admin(user: User | None = Depends(get_current_user)) -> User:
    if user is None:
        raise unauthenticated()
    if user.role != "admin":
        raise forbidden()
    return user
