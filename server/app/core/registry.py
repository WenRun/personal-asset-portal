"""扩展名注册表（详细设计 §4.2）：扩展名 → 资产类型。

M0 使用 GenericParser（标题=文件名、mime 推断）；M1–M5 各领域在此挂接专用解析器。
"""

ASSET_TYPES = ("font", "music", "video", "book", "image")

# 浏览页路由名（复数）→ asset_type
ROUTE_TO_TYPE = {
    "fonts": "font",
    "music": "music",
    "videos": "video",
    "books": "book",
    "images": "image",
}
TYPE_TO_ROUTE = {v: k for k, v in ROUTE_TO_TYPE.items()}

EXT_TO_TYPE: dict[str, str] = {}


def _register(exts: tuple[str, ...], asset_type: str) -> None:
    for e in exts:
        EXT_TO_TYPE[e] = asset_type


_register((".ttf", ".otf", ".woff", ".woff2"), "font")
_register((
    ".mp3", ".flac", ".m4a", ".ogg", ".wav", ".dts", ".dtshd",
    ".ape", ".dsf", ".dff", ".aiff", ".aif", ".opus", ".wma", ".alac",
    ".cue",
), "music")
_register((".mp4", ".mkv", ".mov", ".webm", ".avi"), "video")
_register((".epub", ".pdf", ".mobi", ".azw3", ".txt"), "book")
_register((".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic"), "image")

MIME_OVERRIDES = {
    ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2",
    ".flac": "audio/flac", ".m4a": "audio/mp4", ".dts": "audio/vnd.dts", ".dtshd": "audio/vnd.dts",
    ".ape": "audio/x-ape", ".dsf": "audio/x-dsf", ".dff": "audio/x-dff",
    ".aiff": "audio/x-aiff", ".aif": "audio/x-aiff", ".opus": "audio/opus",
    ".wma": "audio/x-ms-wma", ".alac": "audio/x-alac",
    ".cue": "application/x-cue",
    ".epub": "application/epub+zip",
    ".pdf": "application/pdf", ".mkv": "video/x-matroska", ".heic": "image/heic",
    ".md": "text/markdown", ".txt": "text/plain",
}


def ext_of(file_name: str) -> str:
    return ("." + file_name.rsplit(".", 1)[-1].lower()) if "." in file_name else ""


def asset_type_of(file_name: str) -> str | None:
    return EXT_TO_TYPE.get(ext_of(file_name))


def mime_of(file_name: str) -> str:
    ext = ext_of(file_name)
    if ext in MIME_OVERRIDES:
        return MIME_OVERRIDES[ext]
    import mimetypes

    return mimetypes.types_map.get(ext, "application/octet-stream")
