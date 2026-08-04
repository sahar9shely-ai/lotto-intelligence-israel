from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    project_name: str = "תזרים — מעקב השקעות"
    environment: str = "development"
    log_level: str = "INFO"

    postgres_db: str = "lotto_intelligence"
    postgres_user: str = "lotto_user"
    postgres_password: str = "lotto_password"
    postgres_host: str = "db"
    postgres_port: int = 5432

    jwt_secret: str = "tazrim-dev-secret-change-me-32chars!"
    jwt_expire_hours: int = 72
    app_public_url: str = "http://localhost:5173"
    reset_token_hours: int = 48

    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_use_tls: bool = True

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )


settings = Settings()

