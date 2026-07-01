from functools import lru_cache
from typing import List

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Placeholder secret values shipped in .env.example — must never reach prod.
_PLACEHOLDER_SECRETS = {
    "change_me_use_openssl_rand_hex_64",
    "change_me_use_openssl_rand_hex_64_different",
    "",
}


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
    # Max upload size per file (bytes). Cloudinary's FREE plan hard-caps uploads
    # at 10 MB/file (image and raw) — a larger file transfers fully and is THEN
    # rejected, wasting ~15s and returning an opaque 422. So we cap at 10 MB and
    # fail fast with a clear message. Raise this (and set the env var) after
    # upgrading the Cloudinary plan, which allows larger files.
    MAX_UPLOAD_BYTES: int = 10 * 1024 * 1024
    # Seconds before a Cloudinary upload call is abandoned (frees the worker).
    CLOUDINARY_UPLOAD_TIMEOUT: int = 120

    # ── Redis ─────────────────────────────────────────────────────────────────
    REDIS_URL: str = "redis://localhost:6379/0"

    # ── Rate limiting ─────────────────────────────────────────────────────────
    # slowapi-format strings: "<count>/<period>" e.g. "5/15minutes".
    RATE_LIMIT_LOGIN: str = "5/15minutes"
    RATE_LIMIT_REGISTER: str = "10/hour"
    RATE_LIMIT_FORGOT_PASSWORD: str = "3/hour"
    RATE_LIMIT_ENABLED: bool = True

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

    # ── Production safety validation ──────────────────────────────────────────
    @model_validator(mode="after")
    def _validate_production_config(self) -> "Settings":
        """
        Fail fast at startup if production is misconfigured, instead of running
        silently with insecure defaults (forgeable JWTs, localhost CORS, reset
        emails that never send). Only enforced when APP_ENV=production so local
        development is unaffected.
        """
        if self.APP_ENV != "production":
            return self

        errors: List[str] = []

        for name, value in (
            ("JWT_SECRET", self.JWT_SECRET),
            ("JWT_REFRESH_SECRET", self.JWT_REFRESH_SECRET),
        ):
            if value in _PLACEHOLDER_SECRETS:
                errors.append(f"{name} is unset or still the example placeholder")
            elif len(value) < 32:
                errors.append(f"{name} is too short (<32 chars); use `openssl rand -hex 64`")

        if self.JWT_SECRET == self.JWT_REFRESH_SECRET:
            errors.append("JWT_SECRET and JWT_REFRESH_SECRET must differ")

        # CORS must name the real frontend origin, not localhost.
        if any("localhost" in o or "127.0.0.1" in o for o in self.get_cors_origins()):
            errors.append(
                "CORS_ORIGINS still contains localhost — set it to the deployed frontend origin"
            )

        if "localhost" in self.FRONTEND_URL:
            errors.append(
                "FRONTEND_URL still points at localhost — set it to the deployed frontend URL"
            )

        if self.DEBUG:
            errors.append("DEBUG must be false in production (reset emails are only logged when DEBUG=true)")

        if errors:
            raise ValueError(
                "Invalid production configuration:\n  - " + "\n  - ".join(errors)
            )
        return self

    @model_validator(mode="after")
    def _development_defaults(self) -> "Settings":
        """
        Local development should not share production Redis rate-limit buckets or
        lock engineers out after a few failed logins while the API is restarting.
        """
        if self.APP_ENV != "production":
            object.__setattr__(self, "RATE_LIMIT_ENABLED", False)
        return self

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
