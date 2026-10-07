"""标签路由（详细设计 §6.3）：读公开、写 admin。"""

import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.errors import conflict, not_found
from app.core.models import AssetTag, Tag, User
from app.core.deps import require_admin

router = APIRouter(prefix="/api/tags", tags=["标签"])


@router.get("", summary="标签列表", description="公开。返回全部标签及其挂载的资产数量，按名称排序。")
async def list_tags(db: AsyncSession = Depends(get_db)):
    rows = (
        await db.execute(
            select(Tag.id, Tag.name, Tag.parent_id, func.count(AssetTag.asset_id).label("count"))
            .outerjoin(AssetTag, AssetTag.tag_id == Tag.id)
            .group_by(Tag.id)
            .order_by(Tag.name)
        )
    ).all()
    return [
        {"id": str(r.id), "name": r.name, "parent_id": str(r.parent_id) if r.parent_id else None, "count": r.count}
        for r in rows
    ]


class TagBody(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    parent_id: uuid.UUID | None = None


@router.post("", summary="新建标签", description="管理员。标签名全局唯一，重复时返回 409。")
async def create_tag(body: TagBody, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    exists = (await db.execute(select(Tag).where(Tag.name == body.name))).scalar_one_or_none()
    if exists is not None:
        raise conflict("同名标签已存在")
    t = Tag(name=body.name, parent_id=body.parent_id)
    db.add(t)
    await db.commit()
    return {"id": str(t.id), "name": t.name}


@router.patch("/{tag_id}", summary="重命名标签", description="管理员。标签不存在时返回 404。")
async def rename_tag(tag_id: uuid.UUID, body: TagBody, db: AsyncSession = Depends(get_db),
                     _: User = Depends(require_admin)):
    t = await db.get(Tag, tag_id)
    if t is None:
        raise not_found()
    t.name = body.name
    await db.commit()
    return {"id": str(t.id), "name": t.name}


@router.delete("/{tag_id}", summary="删除标签", description="管理员。同时解除所有资产上的该标签挂载。")
async def delete_tag(tag_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    await db.execute(delete(Tag).where(Tag.id == tag_id))
    await db.commit()
    return {"ok": True}
