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
_register((
    ".mp4", ".m4v", ".mkv", ".mov", ".webm", ".avi", ".ts",
    # 第二批常见格式：能入库/下载/搜索；在线播放仍由 probe 编码门槛判定（多数仅下载）
    ".f4v", ".flv", ".rm", ".rmvb", ".wmv", ".mpg", ".mpeg", ".m2ts", ".mts",
    ".3gp", ".3g2", ".vob", ".asf",
), "video")
_register((".epub", ".pdf", ".mobi", ".azw3", ".txt"), "book")
_register((
    ".jpg", ".jpeg", ".jfif", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff",
    ".heic", ".heif", ".avif",
    ".svg", ".ico", ".psd", ".ai",
    # 相机 RAW（LibRaw 全覆盖，按品牌惯例命名）
    ".crw", ".cr2", ".cr3", ".nef", ".nrw", ".arw", ".srf", ".sr2", ".raf",
    ".orf", ".rw2", ".rwl", ".pef", ".srw", ".x3f", ".3fr", ".erf", ".iiq",
    ".mrw", ".dng",
), "image")

MIME_OVERRIDES = {
    ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2",
    ".flac": "audio/flac", ".m4a": "audio/mp4", ".dts": "audio/vnd.dts", ".dtshd": "audio/vnd.dts",
    ".ape": "audio/x-ape", ".dsf": "audio/x-dsf", ".dff": "audio/x-dff",
    ".aiff": "audio/x-aiff", ".aif": "audio/x-aiff", ".opus": "audio/opus",
    ".wma": "audio/x-ms-wma", ".alac": "audio/x-alac",
    ".cue": "application/x-cue",
    ".epub": "application/epub+zip",
    ".pdf": "application/pdf", ".mkv": "video/x-matroska", ".m4v": "video/mp4",
    ".ts": "video/mp2t", ".heic": "image/heic",
    # 第二批视频格式（多数仅下载，MIME 用于存储与下载口径）
    ".f4v": "video/mp4", ".flv": "video/x-flv",
    ".rm": "application/vnd.rn-realmedia", ".rmvb": "application/vnd.rn-realmedia-vbr",
    ".wmv": "video/x-ms-wmv", ".mpg": "video/mpeg", ".mpeg": "video/mpeg",
    ".m2ts": "video/mp2t", ".mts": "video/mp2t",
    ".3gp": "video/3gpp", ".3g2": "video/3gpp2", ".vob": "video/mpeg",
    ".asf": "video/x-ms-asf",
    ".heif": "image/heif", ".avif": "image/avif",
    ".jfif": "image/jpeg", ".bmp": "image/bmp", ".tif": "image/tiff", ".tiff": "image/tiff",
    ".svg": "image/svg+xml", ".ico": "image/x-icon", ".psd": "image/vnd.adobe.photoshop",
    ".ai": "application/illustrator",
    # 相机 RAW：浏览器均无法直接显示，MIME 仅用于存储与下载口径
    ".crw": "image/x-canon-crw", ".cr2": "image/x-canon-cr2", ".cr3": "image/x-canon-cr3",
    ".nef": "image/x-nikon-nef", ".nrw": "image/x-nikon-nrw",
    ".arw": "image/x-sony-arw", ".srf": "image/x-sony-srf", ".sr2": "image/x-sony-sr2",
    ".raf": "image/x-fuji-raf", ".orf": "image/x-olympus-orf",
    ".rw2": "image/x-panasonic-rw2", ".rwl": "image/x-leica-rwl",
    ".pef": "image/x-pentax-pef", ".srw": "image/x-samsung-srw",
    ".x3f": "image/x-sigma-x3f", ".3fr": "image/x-hasselblad-3fr",
    ".erf": "image/x-epson-erf", ".iiq": "image/x-phaseone-iiq",
    ".mrw": "image/x-minolta-mrw", ".dng": "image/x-adobe-dng",
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
