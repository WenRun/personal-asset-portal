"""管理路由（详细设计 §6.5/§6.6）：扫描、任务、设置。SSE 与打包下载随 M5/M6 加入。"""

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_app_settings, require_admin
from app.core.db import get_db
from app.core.errors import bad_request, not_found
from app.core.jobs import enqueue
from app.core.models import Job, Setting, User

router = APIRouter(prefix="/api/admin", tags=["admin"])


# ---------- 扫描 ----------

class ScanBody(BaseModel):
    root_alias: str


@router.post("/scan")
async def trigger_scan(body: ScanBody, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    kv = await get_app_settings(db)
    if body.root_alias not in {r["alias"] for r in kv["scan_roots"]}:
        raise bad_request(f"未注册的资源根目录: {body.root_alias}")
    job_id = await enqueue(db, "scan_root", {"root_alias": body.root_alias}, priority=5)
    await db.commit()
    return {"job_id": str(job_id)}


# ---------- 任务中心 ----------

@router.get("/jobs")
async def list_jobs(status: str | None = None, kind: str | None = None, limit: int = 50,
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


@router.post("/jobs/{job_id}/retry")
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


@router.get("/settings")
async def get_settings_api(db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    return await get_app_settings(db)


@router.put("/settings")
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
