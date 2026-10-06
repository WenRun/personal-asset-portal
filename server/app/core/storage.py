"""存储抽象（详细设计 §3）：storage_key = "{root_alias}:{relative_path}"。

一期实现 LocalStorage；原始文件只读（save 仅上传暂存使用）。所有路径 resolve 后
校验仍位于对应根目录内，拒绝 `..` 与符号链接逃逸。
"""

import io
import os
from dataclasses import dataclass
from pathlib import Path

from app.core.errors import bad_request, not_found


@dataclass
class FileStat:
    key: str
    name: str
    size: int
    mtime_ns: int


class LocalStorage:
    def __init__(self, roots: dict[str, str]):
        # roots: alias -> 绝对路径；构造时统一 resolve
        self.roots = {alias: Path(p).expanduser().resolve() for alias, p in roots.items()}
        for alias, root in self.roots.items():
            root.mkdir(parents=True, exist_ok=True)

    def _split(self, key: str) -> tuple[Path, str]:
        if ":" not in key:
            raise bad_request(f"非法 storage_key: {key}")
        alias, rel = key.split(":", 1)
        root = self.roots.get(alias)
        if root is None:
            raise not_found(f"未注册的资源根目录: {alias}")
        if rel.startswith("/") or ".." in Path(rel).parts:
            raise bad_request("非法路径")
        return root, rel

    def resolve(self, key: str) -> Path:
        root, rel = self._split(key)
        p = (root / rel).resolve()
        if not p.is_relative_to(root):
            raise bad_request("路径逃逸")
        return p

    def stat(self, key: str) -> FileStat:
        p = self.resolve(key)
        if not p.is_file():
            raise not_found(f"文件不存在: {key}")
        st = p.stat()
        return FileStat(key=key, name=p.name, size=st.st_size, mtime_ns=st.st_mtime_ns)

    def open(self, key: str) -> io.BufferedReader:
        return open(self.resolve(key), "rb")

    def iter_files(self, alias: str) -> list[FileStat]:
        root = self.roots.get(alias)
        if root is None:
            raise not_found(f"未注册的资源根目录: {alias}")
        out: list[FileStat] = []
        for dirpath, _dirnames, filenames in os.walk(root):
            for name in filenames:
                full = Path(dirpath) / name
                rel = full.relative_to(root).as_posix()
                st = full.stat()
                if st.st_size > 0:
                    out.append(FileStat(key=f"{alias}:{rel}", name=name, size=st.st_size, mtime_ns=st.st_mtime_ns))
        return out

    def save(self, key: str, data: bytes) -> None:
        p = self.resolve(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def delete(self, key: str) -> None:
        p = self.resolve(key)
        if p.is_file():
            p.unlink()
