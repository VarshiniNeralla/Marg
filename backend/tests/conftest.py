"""
Shared pytest fixtures for the entire test suite.

Strategy:
- mongomock_motor provides an in-process async Motor-compatible mock.
  No real MongoDB connection is required to run tests.
- Each test gets a fresh database (unique name per test) to guarantee isolation.
- HTTP integration tests use httpx.AsyncClient against the FastAPI app.
- Seeded fixtures (org, admin_user, regular_user) are created once per test
  via the mock db, then authentication tokens are issued for them.
"""

import asyncio
from datetime import datetime, timezone
from typing import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from bson import ObjectId
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.core.security import create_access_token, hash_password
from app.models.organization import OrgSettings, OrganizationDocument
from app.models.user import UserDocument


# ── Event loop ────────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def event_loop():
    """Use a single event loop for the entire test session."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


# ── Mock DB factory ───────────────────────────────────────────────────────────

def _make_mock_db():
    """
    Returns a lightweight MagicMock that mimics AsyncIOMotorDatabase.
    Each collection attribute returns a MagicMock with async methods pre-set.

    For tests that need real query semantics (find, find_one, count), use
    mongomock_motor (see `mock_db` fixture below). For unit tests that only
    care about what's called (not what's returned), use this shim.
    """
    db = MagicMock()

    def make_collection():
        col = MagicMock()
        col.find_one = AsyncMock(return_value=None)
        col.insert_one = AsyncMock(return_value=MagicMock(inserted_id=ObjectId()))
        col.update_one = AsyncMock(return_value=MagicMock(matched_count=1, modified_count=1))
        col.delete_one = AsyncMock(return_value=MagicMock(deleted_count=1))
        col.count_documents = AsyncMock(return_value=0)
        col.create_index = AsyncMock(return_value="index_name")

        # find() returns an async cursor mock
        cursor = MagicMock()
        cursor.skip = MagicMock(return_value=cursor)
        cursor.limit = MagicMock(return_value=cursor)
        cursor.sort = MagicMock(return_value=cursor)
        cursor.__aiter__ = MagicMock(return_value=iter([]))
        col.find = MagicMock(return_value=cursor)
        return col

    db.__getitem__ = lambda self, name: make_collection()
    db.__getattr__ = lambda self, name: make_collection()
    return db


# ── mongomock_motor integration DB (for query-aware tests) ───────────────────

try:
    import mongomock_motor

    @pytest_asyncio.fixture
    async def mock_db():
        """
        Provides a real-query-capable in-process MongoDB mock.
        Uses mongomock_motor for async Motor compatibility.
        Each test gets a fresh database.
        """
        client = mongomock_motor.AsyncMongoMockClient()
        db = client["test_db"]
        yield db
        client.close()

except ImportError:
    # mongomock_motor not installed — fall back to the simple shim
    @pytest_asyncio.fixture
    async def mock_db():
        yield _make_mock_db()


# ── Seed data helpers ─────────────────────────────────────────────────────────

ORG_ID = str(ObjectId())
ADMIN_USER_ID = str(ObjectId())
REGULAR_USER_ID = str(ObjectId())
OTHER_ORG_ID = str(ObjectId())
OTHER_USER_ID = str(ObjectId())


def _make_org_doc(org_id: str = ORG_ID, slug: str = "test-org") -> dict:
    return {
        "_id": ObjectId(org_id),
        "name": "Test Organization",
        "slug": slug,
        "plan": "professional",
        "status": "active",
        "logo_url": None,
        "owner_id": ObjectId(ADMIN_USER_ID),
        "settings": OrgSettings().model_dump(),
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }


def _make_user_doc(
    user_id: str,
    org_id: str,
    role: str = "user",
    email: str = "user@test.com",
    name: str = "Test User",
) -> dict:
    return {
        "_id": ObjectId(user_id),
        "org_id": ObjectId(org_id),
        "name": name,
        "email": email,
        "role": role,
        "password_hash": hash_password("Password1!"),
        "is_active": True,
        "avatar_url": None,
        "last_login": None,
        "reset_token_hash": None,
        "reset_token_exp": None,
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }


@pytest_asyncio.fixture
async def seeded_db(mock_db):
    """
    Inserts a standard org + admin user + regular user into mock_db.
    Returns the db for further assertions.
    """
    await mock_db.organizations.insert_one(_make_org_doc(ORG_ID))
    await mock_db.users.insert_one(
        _make_user_doc(ADMIN_USER_ID, ORG_ID, role="admin", email="admin@test.com", name="Admin User")
    )
    await mock_db.users.insert_one(
        _make_user_doc(REGULAR_USER_ID, ORG_ID, role="user", email="user@test.com", name="Regular User")
    )
    # Second org + user (for cross-org isolation tests)
    await mock_db.organizations.insert_one(_make_org_doc(OTHER_ORG_ID, slug="other-org"))
    await mock_db.users.insert_one(
        _make_user_doc(OTHER_USER_ID, OTHER_ORG_ID, role="user", email="other@other.com", name="Other User")
    )
    return mock_db


# ── JWT token helpers ─────────────────────────────────────────────────────────

def make_access_token(user_id: str, org_id: str, role: str = "user") -> str:
    return create_access_token(
        subject=user_id,
        org_id=org_id,
        role=role,
    )


@pytest.fixture
def admin_token() -> str:
    return make_access_token(ADMIN_USER_ID, ORG_ID, role="admin")


@pytest.fixture
def user_token() -> str:
    return make_access_token(REGULAR_USER_ID, ORG_ID, role="user")


@pytest.fixture
def other_org_token() -> str:
    """Token for a user in a *different* org — used for cross-org isolation tests."""
    return make_access_token(OTHER_USER_ID, OTHER_ORG_ID, role="user")


# ── HTTP test client ──────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def client(seeded_db) -> AsyncGenerator[AsyncClient, None]:
    """
    Provides an httpx.AsyncClient wired to the FastAPI app.
    The app's DB dependency is overridden to use the seeded mock_db.
    """
    from app.db.mongodb import get_db
    from app.main import create_app

    app: FastAPI = create_app()

    # Disable rate limiting in tests. Otherwise, when REDIS_URL points at a real
    # (shared) Redis, login/register attempts accumulate ACROSS test runs and the
    # per-IP limit trips with 429s that have nothing to do with the test.
    limiter = getattr(app.state, "limiter", None)
    if limiter is not None:
        limiter.enabled = False

    # Override the DB dependency so the app uses our mock
    async def _override_db():
        yield seeded_db

    app.dependency_overrides[get_db] = _override_db

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


# ── Auth header helpers ───────────────────────────────────────────────────────

def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}
