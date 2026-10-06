"""指纹策略（详细设计 §3.1）：≤512MB 全文件 sha256；更大用 size+mtime+首尾 1MB。"""

import hashlib

QUICK_LIMIT = 512 * 1024 * 1024
EDGE = 1024 * 1024


def compute_fingerprint(path, size: int, mtime_ns: int) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        if size <= QUICK_LIMIT:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                h.update(chunk)
            return f"sha256:{h.hexdigest()}"
        h.update(f.read(EDGE))
        f.seek(max(0, size - EDGE))
        h.update(f.read(EDGE))
        return f"quick:{size}-{mtime_ns}-{h.hexdigest()}"
