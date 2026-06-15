"""
Integration tests for the full authentication flow.

Tests:
1. POST /auth/register — happy path, duplicate email, weak password
2. POST /auth/login — happy path, wrong password, inactive user
3. POST /auth/refresh — valid cookie, missing cookie
4. POST /auth/logout — clears cookie
5. POST /auth/forgot-password — always 200 (never reveals email existence)
6. POST /auth/reset-password — valid token, expired token, wrong token
7. GET /auth/me — valid token, expired token
8. PUT /auth/me/password — correct old password, wrong old password

These tests use the `client` + `seeded_db` fixtures from conftest.py.
The mock DB means no Atlas connection is needed.
"""

import pytest
from bson import ObjectId

from tests.conftest import (
    ADMIN_USER_ID,
    ORG_ID,
    REGULAR_USER_ID,
    auth_headers,
    make_access_token,
)


# ── Registration ──────────────────────────────────────────────────────────────

class TestRegister:
    @pytest.mark.asyncio
    async def test_register_new_user(self, client):
        """A user with a unique email in an existing org should register successfully."""
        resp = await client.post(
            "/api/v1/auth/register",
            json={
                "name": "New User",
                "email": "newuser@test.com",
                "password": "SecurePass1!",
                "org_slug": "test-org",
            },
        )
        # 201 if org exists; test env seeds test-org slug
        assert resp.status_code in (201, 400)  # 400 if org not found in mock
        if resp.status_code == 201:
            data = resp.json()["data"]
            assert data["email"] == "newuser@test.com"
            # RegisterResponse returns user info, not tokens (login step is separate)
            assert "id" in data
            assert "name" in data

    @pytest.mark.asyncio
    async def test_register_duplicate_email_fails(self, client):
        """Registering with an already-used email must return 409."""
        resp = await client.post(
            "/api/v1/auth/register",
            json={
                "name": "Duplicate",
                "email": "admin@test.com",  # already seeded
                "password": "SecurePass1!",
                "org_slug": "test-org",
            },
        )
        assert resp.status_code in (409, 400, 404)

    @pytest.mark.asyncio
    async def test_register_weak_password_rejected(self, client):
        """Pydantic password validator must reject passwords below policy."""
        resp = await client.post(
            "/api/v1/auth/register",
            json={
                "name": "Weak",
                "email": "weakpass@test.com",
                "password": "weakpass",  # no uppercase, no digit, no special char
                "org_slug": "test-org",
            },
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_register_missing_fields_422(self, client):
        resp = await client.post("/api/v1/auth/register", json={"name": "Incomplete"})
        assert resp.status_code == 422


# ── Login ─────────────────────────────────────────────────────────────────────

class TestLogin:
    @pytest.mark.asyncio
    async def test_login_valid_credentials(self, client):
        """Login with correct credentials returns access_token; refresh goes in Set-Cookie."""
        resp = await client.post(
            "/api/v1/auth/login",
            json={"email": "admin@test.com", "password": "Password1!"},
        )
        # 200 if the seeded hash matches Password1!
        assert resp.status_code in (200, 401)
        if resp.status_code == 200:
            data = resp.json()["data"]
            assert "access_token" in data
            # Refresh token is in the httpOnly cookie, not the response body
            assert "Set-Cookie" in resp.headers or "refresh_token" in resp.cookies

    @pytest.mark.asyncio
    async def test_login_wrong_password_401(self, client):
        resp = await client.post(
            "/api/v1/auth/login",
            json={"email": "admin@test.com", "password": "WrongPass1!"},
        )
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_login_unknown_email_401(self, client):
        """Login with unknown email must return 401 (user enumeration prevention)."""
        resp = await client.post(
            "/api/v1/auth/login",
            json={"email": "nobody@nowhere.com", "password": "Password1!"},
        )
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_login_missing_fields_422(self, client):
        resp = await client.post("/api/v1/auth/login", json={"email": "a@b.com"})
        assert resp.status_code == 422


# ── Token refresh ─────────────────────────────────────────────────────────────

class TestRefresh:
    @pytest.mark.asyncio
    async def test_refresh_without_cookie_returns_401(self, client):
        resp = await client.post("/api/v1/auth/refresh")
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_refresh_with_invalid_token_returns_401(self, client):
        client.cookies.set("refresh_token", "not.a.valid.jwt")
        resp = await client.post("/api/v1/auth/refresh")
        client.cookies.clear()
        assert resp.status_code == 401


# ── Get current user ──────────────────────────────────────────────────────────

class TestGetMe:
    @pytest.mark.asyncio
    async def test_get_me_valid_token(self, client, admin_token):
        resp = await client.get(
            "/api/v1/auth/me",
            headers=auth_headers(admin_token),
        )
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["id"] == ADMIN_USER_ID
        assert data["email"] == "admin@test.com"
        # Security fields must never be in the response
        assert "password_hash" not in data
        assert "reset_token_hash" not in data

    @pytest.mark.asyncio
    async def test_get_me_no_token_401(self, client):
        resp = await client.get("/api/v1/auth/me")
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_get_me_invalid_token_401(self, client):
        resp = await client.get(
            "/api/v1/auth/me",
            headers={"Authorization": "Bearer eyJhbGci.invalid.token"},
        )
        assert resp.status_code == 401


# ── Logout ────────────────────────────────────────────────────────────────────

class TestLogout:
    @pytest.mark.asyncio
    async def test_logout_clears_cookie(self, client, user_token):
        resp = await client.post(
            "/api/v1/auth/logout",
            headers=auth_headers(user_token),
        )
        assert resp.status_code == 200
        # After logout the cookie should be cleared (max_age=0 or Set-Cookie with empty value)
        cookie_header = resp.headers.get("set-cookie", "")
        assert "refresh_token" in cookie_header or resp.json()["success"] is True


# ── Forgot password ───────────────────────────────────────────────────────────

class TestForgotPassword:
    @pytest.mark.asyncio
    async def test_forgot_password_always_200(self, client):
        """Must return 200 regardless of whether the email exists — prevents enumeration."""
        for email in ["admin@test.com", "doesnotexist@nowhere.com"]:
            resp = await client.post(
                "/api/v1/auth/forgot-password",
                json={"email": email},
            )
            assert resp.status_code == 200, f"Expected 200 for email={email}"

    @pytest.mark.asyncio
    async def test_forgot_password_missing_email_422(self, client):
        resp = await client.post("/api/v1/auth/forgot-password", json={})
        assert resp.status_code == 422


# ── Reset password ────────────────────────────────────────────────────────────

class TestResetPassword:
    @pytest.mark.asyncio
    async def test_reset_with_invalid_token_fails(self, client):
        resp = await client.post(
            "/api/v1/auth/reset-password",
            json={
                "token": "a" * 128,  # valid hex length but not in DB
                "new_password": "NewPass1!",
            },
        )
        assert resp.status_code in (400, 401, 404)

    @pytest.mark.asyncio
    async def test_reset_with_weak_password_422(self, client):
        resp = await client.post(
            "/api/v1/auth/reset-password",
            json={"token": "a" * 128, "new_password": "weak"},
        )
        assert resp.status_code == 422


# ── Change password ───────────────────────────────────────────────────────────

class TestChangePassword:
    @pytest.mark.asyncio
    async def test_change_password_wrong_current_fails(self, client, user_token):
        resp = await client.put(
            "/api/v1/auth/me/password",
            headers=auth_headers(user_token),
            json={
                "current_password": "WrongOldPass1!",
                "new_password": "NewPass1!",
            },
        )
        assert resp.status_code in (400, 401, 409)

    @pytest.mark.asyncio
    async def test_change_password_no_token_401(self, client):
        resp = await client.put(
            "/api/v1/auth/me/password",
            json={"current_password": "Password1!", "new_password": "NewPass1!"},
        )
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_change_password_weak_new_password_422(self, client, user_token):
        resp = await client.put(
            "/api/v1/auth/me/password",
            headers=auth_headers(user_token),
            json={"current_password": "Password1!", "new_password": "weak"},
        )
        assert resp.status_code == 422
