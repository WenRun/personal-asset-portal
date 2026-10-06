"""任务系统（详细设计 §4.3）：DB 队列 + SKIP LOCKED 领取 + 指数退避重试。"""

import asyncio
import datetime as dt
import json
import logging
import os
import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import SessionLocal

log = logging.getLogger("portal.jobs")

CLAIM_SQL = text(
    """
    UPDATE jobs SET status='running', worker_id=:wid, attempts=attempts+1
    WHERE id = (
      SELECT id FROM jobs
      WHERE status='queued' AND run_at <= now()
      ORDER BY priority, run_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, kind, payload, attempts
    """
)

BACKOFFS = [30, 300, 1800]  # 30s / 5min / 30min


async def enqueue(db: AsyncSession, kind: str, payload: dict, priority: int = 5) -> uuid.UUID:
    """入队并立即提交：调用方常在自身 commit 之后入队（如 PATCH 后重索引），
    若只 flush 会随请求会话结束被回滚（曾导致上传/编辑的索引任务丢失）。"""
    from app.core.models import Job

    job = Job(kind=kind, payload=payload, priority=priority)
    db.add(job)
    await db.flush()
    await db.commit()
    return job.id


async def _finish(job_id, status: str, error: str | None = None, requeue_in: int | None = None) -> None:
    async with SessionLocal() as db:
        if requeue_in is not None:
            await db.execute(
                text("UPDATE jobs SET status='queued', last_error=:e, run_at=now() + make_interval(secs=>:s) WHERE id=:id"),
                {"e": error, "s": requeue_in, "id": job_id},
            )
        else:
            await db.execute(
                text("UPDATE jobs SET status=:s, last_error=:e, finished_at=now() WHERE id=:id"),
                {"s": status, "e": error, "id": job_id},
            )
        await db.commit()


async def claim(db: AsyncSession, worker_id: str):
    row = (await db.execute(CLAIM_SQL, {"wid": worker_id})).first()
    await db.commit()
    return row


async def run_one(db: AsyncSession, row, worker_id: str) -> None:
    from app.core.pipeline import HANDLERS

    job_id, kind, payload_raw, attempts = row[0], row[1], row[2], row[3]
    payload = payload_raw if isinstance(payload_raw, dict) else json.loads(payload_raw)
    handler = HANDLERS.get(kind)
    try:
        if handler is None:
            raise LookupError(f"未注册的任务类型: {kind}")
        await handler(db, payload)
        await db.commit()
        await _finish(job_id, "done")
    except Exception as exc:  # noqa: BLE001
        await db.rollback()
        log.warning("job %s(%s) failed: %s", job_id, kind, exc)
        if attempts < len(BACKOFFS):
            await _finish(job_id, "queued", str(exc), requeue_in=BACKOFFS[attempts - 1])
        else:
            await _finish(job_id, "failed", str(exc))


async def worker_loop(poll_interval: float = 1.5) -> None:
    worker_id = f"{os.getpid()}-{uuid.uuid4().hex[:8]}"
    log.info("worker started: %s", worker_id)
    while True:
        try:
            async with SessionLocal() as db:
                row = await claim(db, worker_id)
                if row is None:
                    await asyncio.sleep(poll_interval)
                    continue
                await run_one(db, row, worker_id)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001  建表竞态/连接抖动：记录后继续轮询
            log.exception("worker loop error, retrying")
            await asyncio.sleep(2)
