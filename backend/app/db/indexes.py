from loguru import logger
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING, TEXT


async def create_indexes(db: AsyncIOMotorDatabase) -> None:
    """
    Creates all MongoDB indexes for every collection.
    Safe to run on every startup — Motor skips indexes that already exist.
    Indexes are ordered from most critical (unique constraints) to supplementary.
    """
    logger.info("Creating MongoDB indexes...")

    # ── organizations ─────────────────────────────────────────────────────────
    await db.organizations.create_index(
        [("name", ASCENDING)], unique=True, name="org_name_unique"
    )
    await db.organizations.create_index(
        [("slug", ASCENDING)], unique=True, name="org_slug_unique"
    )
    await db.organizations.create_index(
        [("status", ASCENDING)], name="org_status"
    )

    # ── users ─────────────────────────────────────────────────────────────────
    await db.users.create_index(
        [("email", ASCENDING)], unique=True, name="user_email_unique"
    )
    await db.users.create_index(
        [("org_id", ASCENDING), ("role", ASCENDING)], name="user_org_role"
    )
    await db.users.create_index(
        [("org_id", ASCENDING), ("is_active", ASCENDING)], name="user_org_active"
    )
    # Text index for admin user search
    await db.users.create_index(
        [("name", TEXT), ("email", TEXT)], name="user_text_search"
    )

    # ── user_projects ─────────────────────────────────────────────────────────
    # Unique partial index: one active assignment per user per project
    await db.user_projects.create_index(
        [("org_id", ASCENDING), ("user_id", ASCENDING), ("project_id", ASCENDING)],
        unique=True,
        partialFilterExpression={"is_active": True},
        name="user_project_active_unique",
    )
    await db.user_projects.create_index(
        [("org_id", ASCENDING), ("project_id", ASCENDING), ("is_active", ASCENDING)],
        name="user_project_by_project",
    )
    await db.user_projects.create_index(
        [("org_id", ASCENDING), ("user_id", ASCENDING), ("is_active", ASCENDING)],
        name="user_project_by_user",
    )

    # ── projects ──────────────────────────────────────────────────────────────
    await db.projects.create_index(
        [("org_id", ASCENDING), ("status", ASCENDING)], name="project_org_status"
    )
    await db.projects.create_index(
        [("org_id", ASCENDING), ("created_at", DESCENDING)], name="project_org_date"
    )
    await db.projects.create_index(
        [("org_id", ASCENDING), ("name", TEXT), ("description", TEXT)],
        name="project_text_search",
    )

    # ── towers ────────────────────────────────────────────────────────────────
    await db.towers.create_index(
        [("project_id", ASCENDING), ("org_id", ASCENDING)], name="tower_project"
    )

    # ── floors ────────────────────────────────────────────────────────────────
    await db.floors.create_index(
        [("tower_id", ASCENDING), ("org_id", ASCENDING)], name="floor_tower"
    )
    await db.floors.create_index(
        [("tower_id", ASCENDING), ("floor_number", ASCENDING)],
        unique=True,
        name="floor_number_per_tower_unique",
    )

    # ── floorplans ────────────────────────────────────────────────────────────
    await db.floorplans.create_index(
        [("floor_id", ASCENDING), ("is_active", ASCENDING)], name="floorplan_floor"
    )

    # ── capture_pins ──────────────────────────────────────────────────────────
    await db.capture_pins.create_index(
        [("orgId", ASCENDING), ("floorPlanId", ASCENDING), ("sequenceNumber", ASCENDING)],
        name="pin_floorplan_sequence",
    )

    # ── rooms ─────────────────────────────────────────────────────────────────
    await db.rooms.create_index(
        [("floor_id", ASCENDING), ("org_id", ASCENDING)], name="room_floor"
    )
    await db.rooms.create_index(
        [("floor_id", ASCENDING), ("room_number", ASCENDING)],
        unique=True,
        name="room_number_per_floor_unique",
    )
    await db.rooms.create_index(
        [("org_id", ASCENDING), ("name", TEXT), ("room_number", TEXT)],
        name="room_text_search",
    )

    # ── captures ──────────────────────────────────────────────────────────────
    await db.captures.create_index(
        [("room_id", ASCENDING), ("status", ASCENDING)], name="capture_room_status"
    )
    await db.captures.create_index(
        [("room_id", ASCENDING), ("capture_date", DESCENDING)], name="capture_timeline"
    )
    await db.captures.create_index(
        [("org_id", ASCENDING), ("uploaded_by", ASCENDING), ("created_at", DESCENDING)],
        name="capture_uploader",
    )
    await db.captures.create_index(
        [("org_id", ASCENDING), ("status", ASCENDING), ("created_at", DESCENDING)],
        name="capture_moderation_queue",
    )
    await db.captures.create_index(
        [("org_id", ASCENDING), ("project_id", ASCENDING), ("status", ASCENDING)],
        name="capture_project_status",
    )
    await db.captures.create_index(
        [("tags", ASCENDING), ("org_id", ASCENDING)], name="capture_tags"
    )

    # ── notifications ─────────────────────────────────────────────────────────
    await db.notifications.create_index(
        [("recipient_id", ASCENDING), ("is_read", ASCENDING), ("created_at", DESCENDING)],
        name="notification_recipient_unread",
    )
    await db.notifications.create_index(
        [("recipient_id", ASCENDING), ("created_at", DESCENDING)],
        name="notification_recipient_all",
    )
    # TTL index: auto-delete notifications with an expiry set
    await db.notifications.create_index(
        [("expires_at", ASCENDING)],
        expireAfterSeconds=0,
        sparse=True,
        name="notification_ttl",
    )

    # ── activity_logs ─────────────────────────────────────────────────────────
    await db.activity_logs.create_index(
        [("org_id", ASCENDING), ("project_id", ASCENDING), ("created_at", DESCENDING)],
        name="activity_org_project",
    )
    await db.activity_logs.create_index(
        [("org_id", ASCENDING), ("actor_id", ASCENDING), ("created_at", DESCENDING)],
        name="activity_actor",
    )
    # TTL: auto-purge activity logs after 90 days
    await db.activity_logs.create_index(
        [("created_at", ASCENDING)],
        expireAfterSeconds=60 * 60 * 24 * 90,
        name="activity_ttl_90d",
    )

    # ── audit_logs ────────────────────────────────────────────────────────────
    await db.audit_logs.create_index(
        [("org_id", ASCENDING), ("actor_id", ASCENDING), ("created_at", DESCENDING)],
        name="audit_actor",
    )
    await db.audit_logs.create_index(
        [("org_id", ASCENDING), ("resource_type", ASCENDING), ("resource_id", ASCENDING)],
        name="audit_resource",
    )
    # TTL: auto-purge audit logs after 365 days
    await db.audit_logs.create_index(
        [("created_at", ASCENDING)],
        expireAfterSeconds=60 * 60 * 24 * 365,
        name="audit_ttl_365d",
    )

    # ── analytics_snapshots ───────────────────────────────────────────────────
    await db.analytics_snapshots.create_index(
        [("org_id", ASCENDING), ("snapshot_type", ASCENDING), ("period_start", DESCENDING)],
        name="analytics_org_type_period",
    )
    await db.analytics_snapshots.create_index(
        [("org_id", ASCENDING), ("project_id", ASCENDING), ("snapshot_type", ASCENDING), ("period_start", DESCENDING)],
        name="analytics_project_type_period",
    )

    # ── ai_jobs ───────────────────────────────────────────────────────────────
    await db.ai_jobs.create_index(
        [("org_id", ASCENDING), ("status", ASCENDING), ("priority", ASCENDING), ("queued_at", ASCENDING)],
        name="ai_job_worker_queue",
    )
    await db.ai_jobs.create_index(
        [("capture_id", ASCENDING), ("job_type", ASCENDING)], name="ai_job_capture"
    )

    logger.info("All MongoDB indexes created successfully.")
