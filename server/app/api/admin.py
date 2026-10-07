"""管理路由（详细设计 §6.5/§6.6）：扫描、任务、设置；任务进度 SSE 实时推送。"""

import asyncio
import json
import logging
import uuid
from pathlib import Path

import asyncpg
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import get_app_settings, require_admin
from app.core.db import SessionLocal, get_db
from app.core.errors import bad_request, not_found
from app.core.jobs import JOB_NOTIFY_CHANNEL, enqueue, notify_job_changed
from app.core.models import Asset, DownloadPack, Job, MusicTrack, Setting, User

log = logging.getLogger("portal.admin")

router = APIRouter(prefix="/api/admin", tags=["管理"])


# ---------- 扫描 ----------

class ScanBody(BaseModel):
    root_alias: str


@router.post("/scan", summary="触发目录扫描",
             description="管理员。对已注册的资源根目录发起扫描入库任务，返回任务 ID；alias 未注册时返回 400。")
async def trigger_scan(body: ScanBody, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    kv = await get_app_settings(db)
    if body.root_alias not in {r["alias"] for r in kv["scan_roots"]}:
        raise bad_request(f"未注册的资源根目录: {body.root_alias}")
    job_id = await enqueue(db, "scan_root", {"root_alias": body.root_alias}, priority=5)
    await db.commit()
    return {"job_id": str(job_id)}


# ---------- 任务中心 ----------

def _job_dict(j: Job) -> dict:
    return {
        "id": str(j.id), "kind": j.kind, "payload": j.payload, "status": j.status,
        "priority": j.priority, "attempts": j.attempts, "last_error": j.last_error,
        "run_at": j.run_at.isoformat(), "worker_id": j.worker_id,
        "started_at": j.started_at.isoformat() if j.started_at else None,
        "created_at": j.created_at.isoformat(),
        "finished_at": j.finished_at.isoformat() if j.finished_at else None,
    }


def _as_uuid(v) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(v))
    except (TypeError, ValueError):
        return None


async def _resolve_targets(db: AsyncSession, rows: list[Job]) -> dict[str, dict]:
    """批量把 payload 里的 asset_id / storage_key / pack_id 反查成可读对象，返回 {job_id: target}。
    一次列表快照只发 3 条查询（资产、音乐曲目→专辑、打包），SSE 高频推送也可承受。"""
    asset_ids: set[uuid.UUID] = set()
    storage_keys: set[str] = set()
    pack_ids: set[uuid.UUID] = set()
    for j in rows:
        p = j.payload if isinstance(j.payload, dict) else {}
        if "asset_id" in p and (u := _as_uuid(p["asset_id"])):
            asset_ids.add(u)
        if p.get("storage_key"):
            storage_keys.add(str(p["storage_key"]))
        if "pack_id" in p and (u := _as_uuid(p["pack_id"])):
            pack_ids.add(u)

    assets: list[Asset] = []
    if asset_ids or storage_keys:
        cond = []
        if asset_ids:
            cond.append(Asset.id.in_(asset_ids))
        if storage_keys:
            cond.append(Asset.storage_key.in_(storage_keys))
        assets = list((await db.execute(select(Asset).where(or_(*cond)))).scalars().all())

    # 音乐资产无独立详情页，跳专辑页：顺路把 track → album 一次查出来
    album_of: dict[uuid.UUID, uuid.UUID] = {}
    music_ids = {a.id for a in assets if a.asset_type == "music"}
    if music_ids:
        trows = (await db.execute(
            select(MusicTrack.asset_id, MusicTrack.album_id).where(MusicTrack.asset_id.in_(music_ids))
        )).all()
        album_of = {aid: alid for aid, alid in trows if alid is not None}

    packs: dict[uuid.UUID, DownloadPack] = {}
    if pack_ids:
        packs = {p.id: p for p in (await db.execute(select(DownloadPack).where(DownloadPack.id.in_(pack_ids)))).scalars().all()}

    by_id = {a.id: a for a in assets}
    by_key = {a.storage_key: a for a in assets}
    targets: dict[str, dict] = {}
    for j in rows:
        p = j.payload if isinstance(j.payload, dict) else {}
        if j.kind == "scan_root" or "root_alias" in p:
            targets[str(j.id)] = {"type": "root", "root_alias": p.get("root_alias")}
        elif "pack_id" in p:
            pack = packs.get(_as_uuid(p["pack_id"]))  # type: ignore[arg-type]
            targets[str(j.id)] = {"type": "pack", "file_count": pack.file_count if pack else None}
        else:
            a = by_id.get(u) if (u := _as_uuid(p.get("asset_id"))) else by_key.get(str(p.get("storage_key")))
            if a is not None:
                t = {
                    "type": "asset", "asset_id": str(a.id), "title": a.title, "file_name": a.file_name,
                    "asset_type": a.asset_type, "deleted": a.deleted_at is not None,
                }
                if a.id in album_of:
                    t["album_id"] = str(album_of[a.id])
                targets[str(j.id)] = t
    return targets


async def _jobs_response(db: AsyncSession, rows: list[Job]) -> list[dict]:
    """任务列表出参：序列化 + 附加可读对象（列表接口与 SSE 快照共用）。"""
    targets = await _resolve_targets(db, rows)
    out = []
    for j in rows:
        d = _job_dict(j)
        d["target"] = targets.get(d["id"])
        out.append(d)
    return out


async def _jobs_snapshot(limit: int = 100) -> list[dict]:
    """任务列表快照（SSE 用独立会话）。"""
    async with SessionLocal() as db:
        rows = (
            await db.execute(select(Job).order_by(Job.created_at.desc(), Job.id.desc()).limit(limit))
        ).scalars().all()
        return await _jobs_response(db, rows)


@router.get("/jobs", summary="任务列表（分页）",
            description="管理员。按创建时间倒序返回后台任务（扫描 / 指纹 / 索引 / 打包等），"
                        "可按状态与类型过滤；返回 {items, total, counts}：total 为当前过滤条件下的总数，"
                        "counts 为全表各状态计数（与过滤无关，供列表页筛选片显示）。")
async def list_jobs(status: str | None = Query(None, description="按状态过滤：queued / running / done / failed"),
                    kind: str | None = Query(None, description="按任务类型过滤，如 scan_root"),
                    limit: int = Query(50, description="每页条数，服务端截断为最大 200"),
                    offset: int = Query(0, ge=0, description="偏移量（翻页用）"),
                    db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    cond = []
    if status:
        cond.append(Job.status == status)
    if kind:
        cond.append(Job.kind == kind)
    # 排序带 id 兜底：created_at 相同（同批入队）时翻页不重不漏
    order = Job.created_at.desc(), Job.id.desc()
    total = (await db.execute(select(func.count()).select_from(Job).where(*cond))).scalar_one()
    counts = dict((await db.execute(select(Job.status, func.count()).group_by(Job.status))).all())
    rows = (
        await db.execute(select(Job).where(*cond).order_by(*order).offset(offset).limit(min(limit, 200)))
    ).scalars().all()
    return {"total": total, "counts": counts, "items": await _jobs_response(db, rows)}


@router.get("/jobs/stream", summary="任务事件流（SSE）",
            description="管理员。text/event-stream 实时推送任务列表快照：连接即推一次（snapshot 事件），"
                        "此后每次任务状态变更（入队/领取/完成/失败/重排）经 Postgres NOTIFY 触发再推全量快照；"
                        "每 15 秒发送 keepalive 注释。事件仅作信号，状态以快照为准，客户端断线由 EventSource 自动重连。")
async def jobs_stream(_: User = Depends(require_admin)):
    dsn = get_settings().database_url.replace("+asyncpg", "")

    def _sse(event: str, data: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

    async def gen():
        conn = await asyncpg.connect(dsn)
        queue: asyncio.Queue[str] = asyncio.Queue()

        def on_notify(_con, _pid, _channel, payload: str) -> None:
            queue.put_nowait(payload)  # asyncpg 回调线程；put_nowait 无锁安全

        await conn.add_listener(JOB_NOTIFY_CHANNEL, on_notify)
        try:
            yield _sse("snapshot", {"jobs": await _jobs_snapshot()})
            while True:
                try:
                    await asyncio.wait_for(queue.get(), timeout=15)
                    # 排空积压通知，合并为一次快照（高频入队时避免刷屏）
                    while not queue.empty():
                        queue.get_nowait()
                    yield _sse("snapshot", {"jobs": await _jobs_snapshot()})
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"  # 保活穿透代理空闲超时
        finally:
            try:
                await conn.remove_listener(JOB_NOTIFY_CHANNEL, on_notify)
                await conn.close()
            except Exception:  # noqa: BLE001  连接已断时忽略
                pass

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


@router.post("/jobs/{job_id}/retry", summary="重试任务",
             description="管理员。将任务重置为排队状态、清零重试次数并清除错误信息；同时推送任务事件。")
async def retry_job(job_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    job = await db.get(Job, job_id)
    if job is None:
        raise not_found()
    job.status = "queued"
    job.attempts = 0
    job.last_error = None
    await db.commit()
    await notify_job_changed(db, job.id)
    await db.commit()
    return {"ok": True}


# ---------- 系统设置 ----------

class ScanRoot(BaseModel):
    alias: str = Field(min_length=1, max_length=32)
    path: str = Field(min_length=1)


class SettingsBody(BaseModel):
    scan_roots: list[ScanRoot] | None = None
    registration_open: bool | None = None


@router.get("/settings", summary="查看系统设置",
            description="管理员。返回扫描根目录列表（alias / 路径）与注册开关。")
async def get_settings_api(db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    return await get_app_settings(db)


@router.put("/settings", summary="修改系统设置",
            description="管理员。可更新扫描根目录（alias 不得重复，路径自动创建）与注册开关；缺省字段保持不变。")
async def put_settings_api(body: SettingsBody, db: AsyncSession = Depends(get_db),
                           _: User = Depends(require_admin)):
    async def _upsert(key: str, value) -> None:
        row = await db.get(Setting, key)
        if row is None:
            db.add(Setting(key=key, value=value))
        else:
            row.value = value

    if body.scan_roots is not None:
        aliases = [r.alias for r in body.scan_roots]
        if len(aliases) != len(set(aliases)):
            raise bad_request("资源根目录 alias 重复")
        for r in body.scan_roots:
            Path(r.path).expanduser().mkdir(parents=True, exist_ok=True)
        await _upsert("scan_roots", [{"alias": r.alias, "path": str(Path(r.path).expanduser())} for r in body.scan_roots])
    if body.registration_open is not None:
        await _upsert("registration_open", body.registration_open)
    await db.commit()
    return await get_app_settings(db)
