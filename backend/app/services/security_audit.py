"""
Security / identity audit events.

Written by the auth, user, organization and user-project services, and kept
deliberately OUT of the project activity feed: logins alone outnumber every
project event, so mixing them in buries the construction activity a user opens
the dashboard to see. They are read through the dedicated
`GET /audit-logs/security` endpoint instead.

These rows historically carried only snake_case tenant keys, with `org_id` as an
ObjectId, while every read path filters on the canonical string `orgId`. That
made the whole category write-only — 341 rows of logins, registrations and user
deletions that no endpoint could return. Each row now carries BOTH shapes: the
legacy keys unchanged (so anything already reading them keeps working) plus the
canonical `orgId`/`eventType`/`createdAt` used for querying, and a
`logCategory` marker so project reads can filter the category out.
"""
from datetime import datetime, timezone
from typing import Any, Optional

from bson import ObjectId
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorDatabase

SECURITY_CATEGORY = "security"


def _as_object_id(value: Any) -> Any:
    """ObjectId when the value looks like one, otherwise the value untouched."""
    if value and ObjectId.is_valid(str(value)):
        return ObjectId(str(value))
    return value


def build_security_audit_doc(
    *,
    org_id: Optional[str],
    actor_id: Optional[str],
    action: str,
    resource_type: str,
    resource_id: Optional[str] = None,
    payload: Optional[dict] = None,
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    return {
        # ── Legacy shape, preserved exactly as it was written before ──
        "org_id": _as_object_id(org_id),
        "actor_id": _as_object_id(actor_id),
        "action": action,
        "resource_type": resource_type,
        "resource_id": _as_object_id(resource_id),
        "payload": payload or {},
        "created_at": now,
        # ── Canonical shape the read paths use ──
        "orgId": str(org_id) if org_id else None,
        "actorId": str(actor_id) if actor_id else None,
        "eventType": action,
        "entityType": resource_type,
        "entityId": str(resource_id) if resource_id else None,
        "createdAt": now.isoformat(),
        "logCategory": SECURITY_CATEGORY,
    }


async def write_security_audit(
    db: AsyncIOMotorDatabase,
    *,
    org_id: Optional[str],
    actor_id: Optional[str],
    action: str,
    resource_type: str,
    resource_id: Optional[str] = None,
    payload: Optional[dict] = None,
) -> None:
    """Best-effort: an audit write must never fail the operation it describes."""
    try:
        await db.audit_logs.insert_one(
            build_security_audit_doc(
                org_id=org_id,
                actor_id=actor_id,
                action=action,
                resource_type=resource_type,
                resource_id=resource_id,
                payload=payload,
            )
        )
    except Exception as exc:
        logger.error(f"Audit log write failed [{action}]: {exc}")
