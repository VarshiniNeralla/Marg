import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import uuid4

from jose import JWTError, jwt
from loguru import logger

from app.core.config import get_settings
from app.core.exceptions import InvalidTokenException

settings = get_settings()


# ── Password hashing ──────────────────────────────────────────────────────────
# bcrypt 5.x moved all public API into _bcrypt extension module.
# Import directly to avoid passlib's broken __about__ detection on bcrypt 4+.

try:
    from bcrypt import _bcrypt as _bcrypt_ext  # type: ignore[attr-defined]

    def hash_password(plain_password: str) -> str:
        salt = _bcrypt_ext.gensalt(12, b"2b")
        return _bcrypt_ext.hashpw(plain_password.encode("utf-8"), salt).decode("utf-8")

    def verify_password(plain_password: str, hashed_password: str) -> bool:
        try:
            return _bcrypt_ext.checkpw(
                plain_password.encode("utf-8"), hashed_password.encode("utf-8")
            )
        except Exception:
            return False

except (ImportError, AttributeError):
    # Fallback for older bcrypt or passlib
    from passlib.context import CryptContext  # type: ignore[import]

    _pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)

    def hash_password(plain_password: str) -> str:  # type: ignore[misc]
        return _pwd_context.hash(plain_password)

    def verify_password(plain_password: str, hashed_password: str) -> bool:  # type: ignore[misc]
        return _pwd_context.verify(plain_password, hashed_password)


# ── JWT token creation ────────────────────────────────────────────────────────

def create_access_token(
    subject: str,
    org_id: str,
    role: str,
    extra_claims: Optional[dict[str, Any]] = None,
) -> str:
    """
    Issues a short-lived access JWT.
    Claims:
      sub  — user ObjectId (string)
      org  — organization ObjectId (string)
      role — system role
      jti  — unique token ID (for future revocation if needed)
      iat  — issued-at
      exp  — expiry (ACCESS_TOKEN_EXPIRE_MINUTES from now)
    """
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)

    payload: dict[str, Any] = {
        "sub": subject,
        "org": org_id,
        "role": role,
        "jti": str(uuid4()),
        "iat": now,
        "exp": expire,
        "type": "access",
    }
    if extra_claims:
        payload.update(extra_claims)

    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(subject: str, org_id: str) -> tuple[str, str]:
    """
    Issues a long-lived refresh JWT.
    Returns a tuple of (encoded_token, jti) so the jti can be stored
    for revocation tracking.

    Signed with a SEPARATE secret from the access token — compromise of
    one signing secret does not compromise the other.
    """
    now = datetime.now(timezone.utc)
    expire = now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    jti = str(uuid4())

    payload: dict[str, Any] = {
        "sub": subject,
        "org": org_id,
        "jti": jti,
        "iat": now,
        "exp": expire,
        "type": "refresh",
    }

    token = jwt.encode(
        payload, settings.JWT_REFRESH_SECRET, algorithm=settings.JWT_ALGORITHM
    )
    return token, jti


# ── JWT token verification ────────────────────────────────────────────────────

def decode_access_token(token: str) -> dict[str, Any]:
    """
    Decodes and validates an access token.
    Raises InvalidTokenException on any failure (expired, wrong secret, wrong type).
    """
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
        )
    except JWTError as exc:
        logger.debug(f"Access token decode failed: {exc}")
        raise InvalidTokenException()

    if payload.get("type") != "access":
        raise InvalidTokenException("Wrong token type")

    return payload


def decode_refresh_token(token: str) -> dict[str, Any]:
    """
    Decodes and validates a refresh token.
    Raises InvalidTokenException on any failure.
    """
    try:
        payload = jwt.decode(
            token,
            settings.JWT_REFRESH_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
        )
    except JWTError as exc:
        logger.debug(f"Refresh token decode failed: {exc}")
        raise InvalidTokenException()

    if payload.get("type") != "refresh":
        raise InvalidTokenException("Wrong token type")

    return payload


# ── Password reset token ──────────────────────────────────────────────────────

def generate_reset_token() -> tuple[str, str]:
    """
    Generates a cryptographically secure password reset token.
    Returns (raw_token, hashed_token).
    - raw_token  → sent in the email link (never stored)
    - hashed_token → stored in the database (bcrypt hash)

    bcrypt caps at 72 bytes; the raw token is 128 hex chars (512 bits).
    We SHA-256 it first to produce a 64-byte digest that is safe to bcrypt.
    The raw token is still what the user receives — the SHA-256 step is internal.
    """
    raw_token = secrets.token_hex(64)
    sha256_digest = hashlib.sha256(raw_token.encode()).hexdigest()
    hashed = hash_password(sha256_digest)
    return raw_token, hashed


def verify_reset_token(raw_token: str, hashed_token: str) -> bool:
    """Verifies the raw reset token against the stored bcrypt hash."""
    sha256_digest = hashlib.sha256(raw_token.encode()).hexdigest()
    return verify_password(sha256_digest, hashed_token)
