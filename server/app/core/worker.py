"""M0 worker 入口：python -m app.core.worker（详细设计 §1.1 独立容器/进程）。"""

import asyncio
import logging

from app.core.config import get_settings
from app.core.jobs import worker_loop
from app.core.pipeline import HANDLERS  # noqa: F401  确保内核任务处理器注册
import app.domains.images.parser  # noqa: F401  M1: parse:image（EXIF）
import app.domains.images.parser  # noqa: F401  M1: parse:image（EXIF）
import app.domains.images.thumbs  # noqa: F401  M1: derive:thumb_image
import app.domains.fonts.parser  # noqa: F401  M2: parse:font
import app.domains.fonts.specimen  # noqa: F401  M2: derive:font_specimen
import app.domains.fonts.charset  # noqa: F401  M2: derive:font_charset
import app.domains.books.parser  # noqa: F401  M3: parse:book
import app.domains.books.thumbs  # noqa: F401  M3: derive:book_cover
import app.domains.music.parser  # noqa: F401  M4: parse:music
import app.domains.music.thumbs  # noqa: F401  M4: derive:music_cover

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
