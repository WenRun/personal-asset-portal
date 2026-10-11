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


@lru_cache
def get_settings() -> Settings:
    return Settings()
