"""M0 worker 入口：python -m app.core.worker（详细设计 §1.1 独立容器/进程）。"""

import asyncio
import logging

from app.core.config import get_settings
from app.core.jobs import worker_loop
from app.core.pipeline import HANDLERS  # noqa: F401  确保任务处理器注册

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")


async def main() -> None:
    for _ in range(get_settings().worker_concurrency):
        asyncio.create_task(worker_loop())
    await asyncio.Event().wait()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
