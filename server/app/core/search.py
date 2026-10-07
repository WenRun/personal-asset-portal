"""Meilisearch 客户端（详细设计 §4.4）：REST 直连（httpx），5 索引 + 增量/全量同步。"""

import httpx

from app.core.config import get_settings
from app.core.registry import TYPE_TO_ROUTE

INDEX_SETTINGS = {
    "searchableAttributes": ["title", "file_name", "note"],
    "filterableAttributes": ["type", "tags", "rating"],
    "sortableAttributes": ["created_at"],
}


def enabled() -> bool:
    return get_settings().meili_enabled


def _headers() -> dict[str, str]:
    key = get_settings().meili_master_key
    return {"Authorization": f"Bearer {key}"} if key else {}


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(base_url=get_settings().meili_url, headers=_headers(), timeout=10)


async def ensure_indexes() -> None:
    """启动时建索引 + 写设置；失败仅告警不阻塞（Meili 关闭/不可达时搜索降级为空）。"""
    if not enabled():
        return
    async with _client() as c:
        for uid in TYPE_TO_ROUTE.values():
            await c.post("/indexes", json={"uid": uid, "primaryKey": "id"})  # 已存在则忽略
            await c.patch(f"/indexes/{uid}/settings", json=INDEX_SETTINGS)


async def upsert_documents(asset_type: str, docs: list[dict]) -> None:
    if not enabled() or not docs:
        return
    uid = TYPE_TO_ROUTE[asset_type]
    async with _client() as c:
        await c.post(f"/indexes/{uid}/documents", json=docs)


async def delete_document(asset_type: str, asset_id: str) -> None:
    if not enabled():
        return
    uid = TYPE_TO_ROUTE[asset_type]
    async with _client() as c:
        await c.delete(f"/indexes/{uid}/documents/{asset_id}")


async def multi_search(q: str, index_uids: list[str], limit: int = 8, tag: str | None = None) -> list[dict]:
    """聚合搜索（§6.4）：每索引一个查询，返回按索引分组的结果（含 tags facet 分布）。"""
    if not enabled():
        return []
    # Meili 过滤表达式：标签名中的双引号转义（表达式本身用双引号包裹字符串字面量）
    filt = f'tags = "{tag.replace(chr(34), chr(92) + chr(34))}"' if tag else None
    queries = []
    for uid in index_uids:
        query: dict = {
            "q": q, "indexUid": uid, "limit": limit, "facets": ["tags"],
            "attributesToRetrieve": [
                "id", "type", "title", "file_name", "note", "tags", "rating", "created_at", "size_bytes",
            ],
        }
        if filt:
            query["filter"] = filt
        queries.append(query)
    async with _client() as c:
        r = await c.post("/multi-search", json={"queries": queries})
        r.raise_for_status()
        return r.json().get("results", [])


def doc_from_asset(a, tags: list[str] | None = None) -> dict:
    """assets 行 → Meili 文档；tags 由调用方查询 asset_tags 后传入。"""
    return {
        "id": str(a.id),
        "type": a.asset_type,
        "title": a.title,
        "file_name": a.file_name,
        "note": a.note or "",
        "tags": tags or [],
        "rating": a.rating,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "size_bytes": a.size_bytes,
    }
