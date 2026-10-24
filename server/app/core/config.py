from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

SERVER_DIR = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://portal:portal@localhost:5432/portal"
    meili_url: str = "http://localhost:7700"
    meili_master_key: str | None = None
    meili_enabled: bool = True

    data_root: Path = Path("./data")

    @field_validator("data_root", mode="after")
    @classmethod
    def resolve_data_root(cls, v: Path) -> Path:
        if not v.is_absolute():
            return (SERVER_DIR / v).resolve()
        return v.resolve()

    bootstrap_admin_username: str = "admin"
    bootstrap_admin_password: str = "admin1234"

    session_ttl_days: int = 30
    max_upload_gb: int = 8
    cookie_secure: bool = False
    frontend_origin: str = "http://localhost:5173"
    worker_concurrency: int = 2

    # 图书元数据刮削（Google Books）：NAS 出网受限/不想联网补信息时置 false，入库解析不受影响
    scrape_enabled: bool = True
    scrape_timeout_seconds: float = 15.0   # 单次外部请求超时（查询与封面下载共用）
    scrape_proxy_url: str | None = None    # 例 http://192.168.31.5:7890；空=直连
    # Google Books API key（可选）：免 key 走按 IP 共享的匿名配额，常被陌生 IP 用光导致 429；
    # 申请免费的独立 key 后配额为 1000 次/天（console.cloud.google.com 开启 Books API 并创建 API 密钥）
    scrape_google_books_key: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
