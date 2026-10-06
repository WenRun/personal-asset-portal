from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://portal:portal@localhost:5432/portal"
    meili_url: str = "http://localhost:7700"
    meili_master_key: str | None = None
    meili_enabled: bool = True

    data_root: Path = Path("./data")

    bootstrap_admin_username: str = "admin"
    bootstrap_admin_password: str = "admin1234"

    session_ttl_days: int = 30
    max_upload_gb: int = 8
    cookie_secure: bool = False
    frontend_origin: str = "http://localhost:5173"
    worker_concurrency: int = 2


@lru_cache
def get_settings() -> Settings:
    return Settings()
