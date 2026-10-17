"""Pillow 额外图片格式解码器注册：HEIC/HEIF、AVIF，以及相机 RAW 解码入口。

import 即生效（幂等）。依赖未安装时静默跳过——对应格式的文件仍会入库，
但解析/缩略图任务会按「损坏文件」路径处理（parse_warning），不影响其他格式。
"""

import logging

logger = logging.getLogger(__name__)

# 由 rawpy/LibRaw 解码的相机 RAW 扩展名（与 registry 注册表保持一致的子集）
RAW_EXTENSIONS = frozenset({
    ".crw", ".cr2", ".cr3", ".nef", ".nrw", ".arw", ".srf", ".sr2", ".raf",
    ".orf", ".rw2", ".rwl", ".pef", ".srw", ".x3f", ".3fr", ".erf", ".iiq",
    ".mrw", ".dng",
})

try:
    from pillow_heif import register_heif_opener

    register_heif_opener()
except ImportError:
    logger.warning("pillow-heif 未安装：.heic/.heif 无法生成缩略图与 EXIF")

try:
    import pillow_avif  # noqa: F401  import 即注册 AVIF 插件
except ImportError:
    logger.warning("pillow-avif-plugin 未安装：.avif 无法生成缩略图与尺寸")
