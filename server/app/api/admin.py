"""管理路由（详细设计 §6.5/§6.6）：扫描、任务、设置。SSE 与打包下载随 M5/M6 加入。"""

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_app_settings, require_admin
from app.core.db import get_db
from app.core.errors import bad_request, not_found
from app.core.jobs import enqueue
from app.core.models import Job, Setting, User

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

@router.get("/jobs", summary="任务列表",
            description="管理员。按创建时间倒序返回后台任务（扫描 / 指纹 / 索引 / 打包等），可按状态与类型过滤。")
async def list_jobs(status: str | None = Query(None, description="按状态过滤：queued / running / done / failed"),
                    kind: str | None = Query(None, description="按任务类型过滤，如 scan_root"),
                    limit: int = Query(50, description="返回条数上限，服务端截断为最大 200"),
                    db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    cond = []
    if status:
        cond.append(Job.status == status)
    if kind:
        cond.append(Job.kind == kind)
    rows = (
        await db.execute(select(Job).where(*cond).order_by(Job.created_at.desc()).limit(min(limit, 200)))
    ).scalars().all()
    return [
        {
            "id": str(j.id), "kind": j.kind, "payload": j.payload, "status": j.status,
            "priority": j.priority, "attempts": j.attempts, "last_error": j.last_error,
            "run_at": j.run_at.isoformat(), "created_at": j.created_at.isoformat(),
            "finished_at": j.finished_at.isoformat() if j.finished_at else None,
        }
        for j in rows
    ]


@router.post("/jobs/{job_id}/retry", summary="重试任务",
             description="管理员。将任务重置为排队状态、清零重试次数并清除错误信息。")
async def retry_job(job_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    job = await db.get(Job, job_id)
    if job is None:
        raise not_found()
    job.status = "queued"
    job.attempts = 0
    job.last_error = None
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
