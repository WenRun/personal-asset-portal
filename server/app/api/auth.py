"""认证路由（详细设计 §6.1）：注册 / 登录 / 登出 / me。"""

import datetime as dt

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import COOKIE_NAME, create_session, get_app_settings, get_current_user
from app.core.db import get_db
from app.core.errors import bad_request, conflict, unauthenticated
from app.core.models import SessionToken, User
from app.core.security import hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


class Credentials(BaseModel):
    username: str = Field(min_length=2, max_length=32)
    password: str = Field(min_length=8, max_length=128)


def _set_cookie(response: Response, token: str, expires: dt.datetime) -> None:
    response.set_cookie(
        COOKIE_NAME, token,
        max_age=max(1, int((expires - dt.datetime.now(dt.timezone.utc)).total_seconds())),
        httponly=True, samesite="lax", secure=get_settings().cookie_secure,
    )


@router.post("/register")
async def register(body: Credentials, response: Response, db: AsyncSession = Depends(get_db)):
    kv = await get_app_settings(db)
    if not kv.get("registration_open", True):
        raise bad_request("注册已关闭")
    exists = (await db.execute(select(User).where(User.username == body.username))).scalar_one_or_none()
    if exists is not None:
        raise conflict("用户名已存在")
    user = User(username=body.username, password_hash=hash_password(body.password), role="member")
    db.add(user)
    await db.commit()
    token, expires = await create_session(db, user.id)
    _set_cookie(response, token, expires)
    return {"id": str(user.id), "username": user.username, "role": user.role}


@router.post("/login")
async def login(body: Credentials, response: Response, db: AsyncSession = Depends(get_db)):
    user = (await db.execute(select(User).where(User.username == body.username))).scalar_one_or_none()
    # 统一 401，不区分用户名/密码错误（详细设计 §6.1）
    if user is None or not user.is_active or not verify_password(body.password, user.password_hash):
        raise unauthenticated("用户名或密码错误")
    user.last_login_at = dt.datetime.now(dt.timezone.utc)
    await db.commit()
    token, expires = await create_session(db, user.id)
    _set_cookie(response, token, expires)
    return {"id": str(user.id), "username": user.username, "role": user.role}


@router.post("/logout")
async def logout(request: Request, response: Response, db: AsyncSession = Depends(get_db),
                 user: User | None = Depends(get_current_user)):
    token = request.cookies.get(COOKIE_NAME)
    if token:
        await db.execute(delete(SessionToken).where(SessionToken.id == token))
        await db.commit()
    response.delete_cookie(COOKIE_NAME)
    return {"ok": True}


@router.get("/me")
async def me(user: User | None = Depends(get_current_user)):
    if user is None:
        raise unauthenticated()
    return {"id": str(user.id), "username": user.username, "role": user.role}
