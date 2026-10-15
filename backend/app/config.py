from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgrespassword@localhost:5432/civic_spark"
    DATABASE_URL_SYNC: Optional[str] = None
    JWT_SECRET: str = "dev_default_jwt_secret_must_be_overridden_in_production"
    VOUCHER_ENCRYPTION_KEY: str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    UPLOAD_DIR: str = "./uploads"
    ENVIRONMENT: str = "development"

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def sync_database_url(self) -> str:
        if self.DATABASE_URL_SYNC:
            if self.DATABASE_URL_SYNC.startswith("postgresql://"):
                return self.DATABASE_URL_SYNC.replace("postgresql://", "postgresql+psycopg2://", 1)
            return self.DATABASE_URL_SYNC
        return self.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql+psycopg2://", 1)


settings = Settings()
