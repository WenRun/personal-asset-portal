"""标签路由（详细设计 §6.3）：读公开、写 admin。"""

import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.errors import bad_request, conflict, not_found
from app.core.jobs import enqueue
from app.core.models import AssetTag, Tag, User
from app.core.deps import require_admin

router = APIRouter(prefix="/api/tags", tags=["标签"])


async def _tagged_asset_ids(db: AsyncSession, tag_id: uuid.UUID) -> list[uuid.UUID]:
    return list(
        (await db.execute(select(AssetTag.asset_id).where(AssetTag.tag_id == tag_id))).scalars().all()
    )


async def _reindex_assets(db: AsyncSession, asset_ids: list[uuid.UUID]) -> None:
    """标签名变更/解除后，重建受影响资产的 Meili 文档（tags 字段）。"""
    for aid in asset_ids:
        await enqueue(db, "index_meili", {"asset_id": str(aid)}, priority=8)


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


@router.patch("/{tag_id}", summary="重命名 / 移动标签",
               description="管理员。可改名或把标签挂到新父标签下（parent_id 传 null 变为顶级）；形成循环层级时返回 400。改动后异步重建受影响资产的搜索索引。")
async def rename_tag(tag_id: uuid.UUID, body: TagBody, db: AsyncSession = Depends(get_db),
                     _: User = Depends(require_admin)):
    t = await db.get(Tag, tag_id)
    if t is None:
        raise not_found()
    if body.parent_id is not None:
        if body.parent_id == tag_id or await _is_descendant(db, tag_id, body.parent_id):
            raise bad_request("父标签不能是自己或自己的后代")
    t.name = body.name
    t.parent_id = body.parent_id
    await db.commit()
    await _reindex_assets(db, await _tagged_asset_ids(db, tag_id))
    return {"id": str(t.id), "name": t.name, "parent_id": str(t.parent_id) if t.parent_id else None}


async def _is_descendant(db: AsyncSession, ancestor_id: uuid.UUID, node_id: uuid.UUID) -> bool:
    """判断 node_id 是否位于 ancestor_id 的子树内（防环）。"""
    with_parent = (
        await db.execute(select(Tag.id, Tag.parent_id))
    ).all()  # 全表很小，载入内存做指针 chasing
    parent_of = {tid: pid for tid, pid in with_parent}
    cur = parent_of.get(node_id)
    seen: set[uuid.UUID] = set()
    while cur is not None and cur not in seen:
        if cur == ancestor_id:
            return True
        seen.add(cur)
        cur = parent_of.get(cur)
    return False


@router.delete("/{tag_id}", summary="删除标签",
               description="管理员。同时解除所有资产上的该标签挂载，并异步重建受影响资产的搜索索引。")
async def delete_tag(tag_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    if await db.get(Tag, tag_id) is None:
        raise not_found()
    tagged = await _tagged_asset_ids(db, tag_id)  # 级联删除会清掉 asset_tags，须先取
    await db.execute(delete(Tag).where(Tag.id == tag_id))
    await db.commit()
    await _reindex_assets(db, tagged)
    return {"ok": True}
