from functools import lru_cache
from typing import List

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Application ───────────────────────────────────────────────────────────
    APP_NAME: str = "Horizon"
    APP_ENV: str = "development"
    DEBUG: bool = True
    FRONTEND_URL: str = "http://localhost:5173"

    # ── MongoDB ───────────────────────────────────────────────────────────────
    MONGO_URI: str
    DB_NAME: str = "virtual_tour"

    # ── JWT ───────────────────────────────────────────────────────────────────
    JWT_SECRET: str
    JWT_REFRESH_SECRET: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # ── Cloudinary ────────────────────────────────────────────────────────────
    CLOUDINARY_CLOUD_NAME: str = ""
    CLOUDINARY_API_KEY: str = ""
    CLOUDINARY_API_SECRET: str = ""

    # ── Redis ─────────────────────────────────────────────────────────────────
    REDIS_URL: str = "redis://localhost:6379/0"

    # ── Email ─────────────────────────────────────────────────────────────────
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    EMAIL_FROM: str = "noreply@yourdomain.com"
    EMAIL_FROM_NAME: str = "Horizon"

    # ── Cookies ───────────────────────────────────────────────────────────────
    # SameSite policy for the refresh-token cookie. When the frontend and backend
    # are served from different sites (e.g. *.onrender.com frontend + separate
    # backend host), the browser only sends the cookie on cross-site requests if
    # this is "none" — and "none" additionally requires Secure=True (HTTPS).
    # Leave blank to auto-select: "none" in production, "lax" in development.
    COOKIE_SAMESITE: str = ""

    # ── CORS ──────────────────────────────────────────────────────────────────
    # Stored as a comma-separated string in .env; parsed into a list below.
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:5174,http://localhost:3000"

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: str) -> str:
        # Keep as string; get_cors_origins() below splits for use.
        return v

    def get_cors_origins(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    # ── Derived helpers ───────────────────────────────────────────────────────
    @property
    def is_production(self) -> bool:
        return self.APP_ENV == "production"

    @property
    def is_development(self) -> bool:
        return self.APP_ENV == "development"

    @property
    def cookie_samesite(self) -> str:
        """
        Effective SameSite policy for the refresh cookie.
        Explicit COOKIE_SAMESITE wins; otherwise "none" in production (so the
        cross-site refresh request on page load carries the cookie) and "lax"
        in development (same-site localhost, avoids needing Secure/HTTPS).
        """
        explicit = self.COOKIE_SAMESITE.strip().lower()
        if explicit in {"none", "lax", "strict"}:
            return explicit
        return "none" if self.is_production else "lax"

    @property
    def cookie_secure(self) -> bool:
        """
        Whether the refresh cookie is marked Secure. Browsers REQUIRE Secure when
        SameSite=None, so force it on in that case regardless of environment.
        """
        return self.is_production or self.cookie_samesite == "none"


@lru_cache
def get_settings() -> Settings:
    """
    Returns a cached singleton Settings instance.
    lru_cache ensures .env is read only once at startup, not on every request.
    """
    return Settings()
