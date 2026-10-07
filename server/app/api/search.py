"""全局搜索代理（详细设计 §6.4）：member 专用，multi-search 聚合五索引。"""

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import search as meili
from app.core.db import get_db
from app.core.registry import ROUTE_TO_TYPE
from app.core.deps import require_member

router = APIRouter(prefix="/api/search", tags=["搜索"])


@router.get("", summary="全局搜索",
            description="登录用户。通过 Meilisearch multi-search 聚合字体/音乐/视频/书籍/图片五个索引，返回各类命中结果。")
async def search(q: str = Query("", description="搜索关键词"),
                 types: str | None = Query(None, description="限定资产类型，逗号分隔（fonts,music,videos,books,images），缺省查全部"),
                 limit: int = Query(8, description="单个索引返回条数上限，服务端截断为最大 50"),
                 _: uuid.UUID = Depends(require_member), db: AsyncSession = Depends(get_db)):
    if types:
        wanted = [t.strip() for t in types.split(",") if t.strip() in ROUTE_TO_TYPE]
    else:
        wanted = list(ROUTE_TO_TYPE.keys())
    results = await meili.multi_search(q, wanted, limit=min(limit, 50))
    return {
        "results": [
            {
                "index": r.get("indexUid"),
                "estimated_total": r.get("estimatedTotalHits", 0),
                "hits": r.get("hits", []),
            }
            for r in results
        ]
    }
