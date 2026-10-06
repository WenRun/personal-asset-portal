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

COOKIE_NAME = "portal_session"


async def get_app_settings(db: AsyncSession) -> dict:
    """settings 表 KV（扫描根、注册开关等）；缺省给默认值。"""
    rows = (await db.execute(select(Setting))).scalars().all()
    kv = {r.key: r.value for r in rows}
    kv.setdefault(
        "scan_roots",
        [
            {"alias": "fonts", "path": str(get_settings().data_root / "library" / "fonts")},
            {"alias": "music", "path": str(get_settings().data_root / "library" / "music")},
            {"alias": "videos", "path": str(get_settings().data_root / "library" / "videos")},
            {"alias": "books", "path": str(get_settings().data_root / "library" / "books")},
            {"alias": "images", "path": str(get_settings().data_root / "library" / "images")},
            {"alias": "uploads", "path": str(get_settings().data_root / "library" / "uploads")},
        ],
    )
    kv.setdefault("registration_open", True)
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
