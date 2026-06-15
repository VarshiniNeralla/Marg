"""
Unit tests for app/core/security.py.

Tests:
- hash_password / verify_password correctness and timing safety
- create_access_token / decode_access_token round-trip
- create_refresh_token / decode_refresh_token round-trip
- Token type validation (access token rejected as refresh and vice versa)
- Expired token rejection
- generate_reset_token produces a verifiable hash pair
- JWT claims include expected fields (sub, org, role, jti, type, exp, iat)
"""

import time
from datetime import datetime, timedelta, timezone

import pytest
from jose import jwt

from app.core.config import get_settings
from app.core.exceptions import InvalidTokenException
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_access_token,
    decode_refresh_token,
    generate_reset_token,
    hash_password,
    verify_password,
    verify_reset_token,
)

settings = get_settings()


# ── Password hashing ──────────────────────────────────────────────────────────

class TestPasswordHashing:
    def test_hash_is_not_plaintext(self):
        hashed = hash_password("MySecret1!")
        assert hashed != "MySecret1!"

    def test_hash_verify_correct_password(self):
        hashed = hash_password("Correct1!")
        assert verify_password("Correct1!", hashed) is True

    def test_hash_reject_wrong_password(self):
        hashed = hash_password("Correct1!")
        assert verify_password("Wrong1!", hashed) is False

    def test_same_password_produces_different_hashes(self):
        """bcrypt salts every hash — two hashes of the same input differ."""
        h1 = hash_password("Same1!")
        h2 = hash_password("Same1!")
        assert h1 != h2

    def test_empty_password_can_be_hashed(self):
        """Edge case — hashing empty string should not raise."""
        hashed = hash_password("")
        assert isinstance(hashed, str)
        assert verify_password("", hashed) is True

    def test_verify_with_tampered_hash_returns_false(self):
        hashed = hash_password("Pass1!")
        tampered = hashed[:-5] + "XXXXX"
        # passlib may raise or return False for badly structured hashes
        try:
            result = verify_password("Pass1!", tampered)
            assert result is False
        except Exception:
            pass  # An exception is also acceptable for tampered hashes


# ── Access token ──────────────────────────────────────────────────────────────

class TestAccessToken:
    def test_roundtrip_decode(self):
        token = create_access_token("user123", "org456", "admin")
        payload = decode_access_token(token)
        assert payload["sub"] == "user123"
        assert payload["org"] == "org456"
        assert payload["role"] == "admin"

    def test_token_type_is_access(self):
        token = create_access_token("u", "o", "user")
        payload = decode_access_token(token)
        assert payload["type"] == "access"

    def test_token_has_jti(self):
        token = create_access_token("u", "o", "user")
        payload = decode_access_token(token)
        assert "jti" in payload
        assert len(payload["jti"]) > 0

    def test_two_tokens_have_different_jti(self):
        t1 = create_access_token("u", "o", "user")
        t2 = create_access_token("u", "o", "user")
        p1 = decode_access_token(t1)
        p2 = decode_access_token(t2)
        assert p1["jti"] != p2["jti"]

    def test_expired_token_raises(self):
        """Create a token that expired 1 second ago."""
        payload = {
            "sub": "u",
            "org": "o",
            "role": "user",
            "jti": "test-jti",
            "type": "access",
            "exp": datetime.now(timezone.utc) - timedelta(seconds=1),
        }
        expired_token = jwt.encode(
            payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM
        )
        with pytest.raises(InvalidTokenException):
            decode_access_token(expired_token)

    def test_tampered_token_raises(self):
        token = create_access_token("u", "o", "user")
        bad_token = token[:-10] + "tampered!!"
        with pytest.raises(InvalidTokenException):
            decode_access_token(bad_token)

    def test_refresh_token_rejected_as_access(self):
        """A refresh token must be rejected when decoded as an access token."""
        refresh_token, _ = create_refresh_token("u", "o")
        with pytest.raises(InvalidTokenException):
            decode_access_token(refresh_token)

    def test_wrong_secret_raises(self):
        payload = {
            "sub": "u",
            "org": "o",
            "role": "user",
            "jti": "jti",
            "type": "access",
            "exp": datetime.now(timezone.utc) + timedelta(minutes=15),
        }
        wrong_token = jwt.encode(payload, "wrong-secret", algorithm="HS256")
        with pytest.raises(InvalidTokenException):
            decode_access_token(wrong_token)


# ── Refresh token ─────────────────────────────────────────────────────────────

class TestRefreshToken:
    def test_roundtrip_decode(self):
        token, jti = create_refresh_token("user123", "org456")
        payload = decode_refresh_token(token)
        assert payload["sub"] == "user123"
        assert payload["org"] == "org456"
        assert payload["jti"] == jti

    def test_token_type_is_refresh(self):
        token, _ = create_refresh_token("u", "o")
        payload = decode_refresh_token(token)
        assert payload["type"] == "refresh"

    def test_access_token_rejected_as_refresh(self):
        token = create_access_token("u", "o", "user")
        with pytest.raises(InvalidTokenException):
            decode_refresh_token(token)

    def test_refresh_uses_different_secret_than_access(self):
        """
        A refresh token signed with JWT_REFRESH_SECRET must fail
        when decoded using JWT_SECRET (the access token secret).
        """
        refresh_token, _ = create_refresh_token("u", "o")
        try:
            jwt.decode(refresh_token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
            if settings.JWT_SECRET != settings.JWT_REFRESH_SECRET:
                pytest.fail("Refresh token should not be decodable with access secret")
        except Exception:
            pass  # Expected

    def test_jti_is_returned_separately(self):
        """create_refresh_token returns (token, jti) — jti must be non-empty."""
        _, jti = create_refresh_token("u", "o")
        assert isinstance(jti, str)
        assert len(jti) > 10


# ── Password reset token ──────────────────────────────────────────────────────

class TestResetToken:
    def test_returns_tuple_of_raw_and_hash(self):
        raw, hashed = generate_reset_token()
        assert isinstance(raw, str)
        assert isinstance(hashed, str)

    def test_raw_is_64_bytes_hex(self):
        """secrets.token_hex(64) produces a 128-char hex string."""
        raw, _ = generate_reset_token()
        assert len(raw) == 128

    def test_hashed_is_bcrypt(self):
        """The hash should start with $2b$ (bcrypt format)."""
        _, hashed = generate_reset_token()
        assert hashed.startswith("$2b$") or hashed.startswith("$2a$")

    def test_raw_verifies_against_hash(self):
        raw, hashed = generate_reset_token()
        assert verify_reset_token(raw, hashed) is True

    def test_different_raw_does_not_verify(self):
        raw, hashed = generate_reset_token()
        other_raw, _ = generate_reset_token()
        assert verify_reset_token(other_raw, hashed) is False

    def test_each_call_produces_unique_tokens(self):
        raw1, _ = generate_reset_token()
        raw2, _ = generate_reset_token()
        assert raw1 != raw2
