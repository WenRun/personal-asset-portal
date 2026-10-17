"""认证路由（详细设计 §6.1）：注册 / 登录 / 登出 / me / 修改个人资料。"""

import datetime as dt
import re

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import COOKIE_NAME, create_session, get_app_settings, get_current_user, require_member
from app.core.db import get_db
from app.core.errors import bad_request, conflict, unauthenticated
from app.core.models import SessionToken, User
from app.core.security import hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["认证"])


class Credentials(BaseModel):
    username: str = Field(min_length=2, max_length=32)
    password: str = Field(min_length=8, max_length=128)


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _payload(user: User) -> dict:
    return {"id": str(user.id), "username": user.username, "role": user.role,
            "email": user.email, "phone": user.phone}


def _set_cookie(response: Response, token: str, expires: dt.datetime) -> None:
    response.set_cookie(
        COOKIE_NAME, token,
        max_age=max(1, int((expires - dt.datetime.now(dt.timezone.utc)).total_seconds())),
        httponly=True, samesite="lax", secure=get_settings().cookie_secure,
    )


@router.post("/register", summary="注册新账号",
             description="创建 member 角色用户并自动登录（写入会话 Cookie）。系统设置关闭注册时返回 400。")
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
    return _payload(user)


@router.post("/login", summary="登录",
             description="校验用户名密码，成功后设置会话 Cookie；失败统一返回 401（不区分用户名/密码错误）。")
async def login(body: Credentials, response: Response, db: AsyncSession = Depends(get_db)):
    user = (await db.execute(select(User).where(User.username == body.username))).scalar_one_or_none()
    # 统一 401，不区分用户名/密码错误（详细设计 §6.1）
    if user is None or not user.is_active or not verify_password(body.password, user.password_hash):
        raise unauthenticated("用户名或密码错误")
    user.last_login_at = dt.datetime.now(dt.timezone.utc)
    await db.commit()
    token, expires = await create_session(db, user.id)
    _set_cookie(response, token, expires)
    return _payload(user)


@router.post("/logout", summary="注销", description="删除服务端会话记录并清除 Cookie。")
async def logout(request: Request, response: Response, db: AsyncSession = Depends(get_db),
                 user: User | None = Depends(get_current_user)):
    token = request.cookies.get(COOKIE_NAME)
    if token:
        await db.execute(delete(SessionToken).where(SessionToken.id == token))
        await db.commit()
    response.delete_cookie(COOKIE_NAME)
    return {"ok": True}


@router.get("/me", summary="当前用户信息",
            description="返回当前登录用户的 id / 用户名 / 角色；未登录返回 401。")
async def me(user: User | None = Depends(get_current_user)):
    if user is None:
        raise unauthenticated()
    return _payload(user)


class ProfileUpdate(BaseModel):
    """各项均可选：只传哪个改哪个；改密码必须同时携带 current_password。
    email/phone：缺省=不改动；传空串=清除；传值=设置（服务端做轻量格式校验）。"""
    username: str | None = Field(default=None, min_length=2, max_length=32)
    current_password: str | None = Field(default=None, max_length=128)
    new_password: str | None = Field(default=None, min_length=8, max_length=128)
    email: str | None = Field(default=None, max_length=254)
    phone: str | None = Field(default=None, max_length=32)


@router.patch("/me", summary="修改个人资料（用户名 / 密码 / 邮箱 / 手机号）",
              description="改密码需先校验当前密码（错误返回 400）；新用户名重复返回 409；"
                          "邮箱/手机号缺省不改动、空串清除、格式非法返回 400。改密码后当前会话保持有效。")
async def update_me(body: ProfileUpdate, db: AsyncSession = Depends(get_db),
                    user: User = Depends(require_member)):
    provided = body.model_fields_set
    if body.new_password is not None:
        if body.current_password is None or not verify_password(body.current_password, user.password_hash):
            raise bad_request("当前密码不正确")
        user.password_hash = hash_password(body.new_password)
    if body.username is not None and body.username != user.username:
        exists = (await db.execute(select(User).where(User.username == body.username))).scalar_one_or_none()
        if exists is not None:
            raise conflict("用户名已存在")
        user.username = body.username
    if "email" in provided:
        email = (body.email or "").strip()
        if email and not _EMAIL_RE.match(email):
            raise bad_request("邮箱格式不正确")
        user.email = email or None
    if "phone" in provided:
        phone = re.fullmatch(r"\+?\d{5,20}", (body.phone or "").replace(" ", "").replace("-", ""))
        if body.phone and phone is None:
            raise bad_request("手机号格式不正确")
        user.phone = phone.group() if phone else None
    await db.commit()
    return _payload(user)
