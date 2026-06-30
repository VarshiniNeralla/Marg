from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from app.models.organization import OrganizationDocument

from bson import ObjectId
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.config import get_settings
from app.core.exceptions import (
    AccountInactiveException,
    ConflictException,
    ForbiddenException,
    InvalidCredentialsException,
    InvalidTokenException,
    NotFoundException,
    OrganizationSuspendedException,
    ValidationException,
)
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    generate_reset_token,
    hash_password,
    verify_password,
    verify_reset_token,
)
from app.models.user import UserDocument
from app.repositories.organization import OrganizationRepository
from app.repositories.user import UserRepository
from app.schemas.auth import (
    LoginRequest,
    MeResponse,
    RegisterRequest,
)
from app.utils.email import send_password_reset_email

settings = get_settings()


class AuthService:
    """
    Orchestrates all authentication flows.
    Injected with db at request time — no shared mutable state.
    """

    def __init__(self, db: AsyncIOMotorDatabase) -> None:
        self._user_repo = UserRepository(db)
        self._org_repo = OrganizationRepository(db)
        self._db = db

    # ── Register ──────────────────────────────────────────────────────────────

    async def register(
        self,
        payload: RegisterRequest,
        caller: Optional[UserDocument] = None,
    ) -> tuple[UserDocument, "OrganizationDocument"]:
        """
        Creates a new user under an existing active organisation.
        Validates uniqueness of email globally and org existence.

        Role assignment is privilege-gated to prevent escalation:
        - Anonymous self-registration ALWAYS gets role "user"; any client-supplied
          role/project assignment is ignored.
        - An authenticated admin/super_admin may set a role (capped at their own
          privilege) and assign projects, but only within their OWN organisation.
        """
        # 1. Check email uniqueness (global across all orgs per architecture)
        if await self._user_repo.email_exists(payload.email):
            raise ConflictException("An account with this email already exists")

        # 2. Resolve organisation by slug
        org = await self._org_repo.find_active_by_slug(payload.org_slug)
        if not org:
            raise NotFoundException("Organization", payload.org_slug)

        # 2b. An authenticated caller may only create users inside their own org.
        caller_is_admin = bool(caller and caller.role in ("admin", "super_admin"))
        if caller and str(caller.org_id) != str(org.id):
            raise ForbiddenException("You can only create users within your own organization")

        # 3. Check org user quota
        from bson import ObjectId
        current_user_count = await self._user_repo.count(
            {"org_id": ObjectId(org.id) if org.id else payload.org_slug}
        )
        if current_user_count >= org.settings.max_users:
            raise ValidationException(
                f"Organization has reached its maximum user limit ({org.settings.max_users})"
            )

        # 4. Determine role — privilege-gated. Only an authenticated admin may
        #    assign a non-default role; everyone else is forced to "user".
        _ASSIGNABLE_BY_ADMIN = {"manager", "field_engineer", "user", "reviewer", "viewer"}
        # super_admin may additionally mint admins; admin cannot create super_admin.
        if caller and caller.role == "super_admin":
            _ASSIGNABLE_BY_ADMIN = _ASSIGNABLE_BY_ADMIN | {"admin", "super_admin"}
        elif caller_is_admin:
            _ASSIGNABLE_BY_ADMIN = _ASSIGNABLE_BY_ADMIN | {"admin"}

        if caller_is_admin and payload.role and payload.role in _ASSIGNABLE_BY_ADMIN:
            role = payload.role
        else:
            # Anonymous, non-admin, or an admin requesting a role above their
            # privilege — fall back to the safe default. Never escalate.
            role = "user"

        # 5. Hash password and create user document
        user = UserDocument(
            org_id=org.id,
            name=payload.name.strip(),
            email=payload.email.lower(),
            password_hash=hash_password(payload.password),
            role=role,
            designation=payload.designation or None,
            is_active=True,
        )

        user_id = await self._user_repo.create(user)
        user.id = user_id

        # Assign to projects if requested — only an authenticated admin may do
        # this; an anonymous self-registration cannot grant itself project access.
        if payload.assigned_project_ids and caller_is_admin:
            await self._create_project_assignments(
                user_id=user_id,
                org_id=str(org.id),
                project_ids=payload.assigned_project_ids,
                assigned_by=caller.id,
            )

        await self._write_audit_log(
            db=self._db,
            actor_id=user_id,
            org_id=org.id,
            action="USER_REGISTER",
            resource_type="user",
            resource_id=user_id,
        )

        logger.info(f"New user registered: {payload.email} | org: {org.slug}")
        return user, org

    # ── Login ─────────────────────────────────────────────────────────────────

    async def login(self, payload: LoginRequest) -> tuple[UserDocument, str, str]:
        """
        Authenticates a user. Returns (user, access_token, refresh_token).
        Raises InvalidCredentialsException on any auth failure — never reveals
        which field (email or password) was wrong.
        """
        user = await self._user_repo.find_by_email(payload.email)

        # Constant-time path: always run verify_password even if user not found
        # (pass a dummy hash) to prevent timing-based user enumeration.
        dummy_hash = "$2b$12$dummyhashfortimingprotectionxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
        stored_hash = user.password_hash if user else dummy_hash

        if not verify_password(payload.password, stored_hash) or not user:
            raise InvalidCredentialsException()

        if not user.is_active:
            raise AccountInactiveException()

        # Resolve org to check suspension
        org = await self._org_repo.find_by_id(user.org_id)
        if not org or org.status != "active":
            raise OrganizationSuspendedException()

        # Issue tokens
        access_token = create_access_token(
            subject=user.id,
            org_id=user.org_id,
            role=user.role,
        )
        refresh_token, jti = create_refresh_token(
            subject=user.id,
            org_id=user.org_id,
        )

        # Update last_login asynchronously (fire and forget pattern via background tasks)
        await self._user_repo.update_last_login(user.id)

        await self._write_audit_log(
            db=self._db,
            actor_id=user.id,
            org_id=user.org_id,
            action="USER_LOGIN",
            resource_type="user",
            resource_id=user.id,
        )

        assigned_project_ids = await self._get_assigned_project_ids(user.id, str(user.org_id))

        logger.info(f"User logged in: {user.email}")
        return user, org, access_token, refresh_token, assigned_project_ids

    # ── Refresh token ─────────────────────────────────────────────────────────

    async def refresh_access_token(self, refresh_token: str) -> tuple[str, str]:
        """
        Validates refresh token, issues new access + refresh token pair (rotation).
        Returns (new_access_token, new_refresh_token).

        Rotation with revocation: the presented refresh token's jti is checked
        against the revocation store and then revoked, so a refresh token can be
        used at most once. A stolen-and-replayed token (or a token used after
        logout / password reset) is rejected.
        """
        from app.core.token_store import is_token_active, token_store

        payload = decode_refresh_token(refresh_token)

        user_id = payload.get("sub")
        org_id = payload.get("org")
        old_jti = payload.get("jti")
        issued_at = payload.get("iat")
        if hasattr(issued_at, "timestamp"):
            issued_at = int(issued_at.timestamp())

        if not user_id or not org_id:
            raise InvalidTokenException()

        # Reject revoked / superseded refresh tokens before doing anything else.
        if not is_token_active(old_jti, user_id, issued_at):
            raise InvalidTokenException("Refresh token has been revoked")

        user = await self._user_repo.find_by_id(user_id, org_id=org_id)
        if not user or not user.is_active:
            raise InvalidTokenException("User account not found or inactive")

        org = await self._org_repo.find_by_id(org_id)
        if not org or org.status != "active":
            raise InvalidTokenException("Organization suspended")

        # Rotate: revoke the just-used refresh token so it cannot be reused.
        if old_jti:
            token_store.revoke(old_jti)

        new_access_token = create_access_token(
            subject=user.id,
            org_id=user.org_id,
            role=user.role,
        )
        new_refresh_token, _ = create_refresh_token(
            subject=user.id,
            org_id=user.org_id,
        )

        return new_access_token, new_refresh_token

    async def revoke_refresh_token(self, refresh_token: str) -> None:
        """Revoke a specific refresh token (logout). Never raises on a bad token —
        logout should always succeed from the client's perspective."""
        from app.core.token_store import token_store

        try:
            payload = decode_refresh_token(refresh_token)
            jti = payload.get("jti")
            if jti:
                token_store.revoke(jti)
        except Exception:
            return

    async def revoke_all_user_tokens(self, user_id: str) -> None:
        """Invalidate every refresh token issued to a user (password reset)."""
        from app.core.token_store import token_store

        token_store.revoke_user(user_id)

    # ── Forgot password ───────────────────────────────────────────────────────

    async def forgot_password(self, email: str) -> None:
        """
        Generates a reset token and sends the reset email.
        Always succeeds (200) regardless of whether the email exists —
        this prevents user enumeration attacks.
        """
        user = await self._user_repo.find_by_email(email)

        if not user or not user.is_active:
            # Silent return — do not reveal whether email is registered
            logger.debug(f"Password reset requested for unknown/inactive email: {email}")
            return

        raw_token, hashed_token = generate_reset_token()
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)

        await self._user_repo.set_reset_token(user.id, hashed_token, expires_at)

        await send_password_reset_email(
            to_email=user.email,
            to_name=user.name,
            raw_token=raw_token,
        )

        await self._write_audit_log(
            db=self._db,
            actor_id=user.id,
            org_id=user.org_id,
            action="PASSWORD_RESET_REQUESTED",
            resource_type="user",
            resource_id=user.id,
        )

        logger.info(f"Password reset email sent to: {email}")

    # ── Reset password ────────────────────────────────────────────────────────

    async def reset_password(self, raw_token: str, new_password: str) -> None:
        """
        Verifies the reset token and updates the password.
        Token is single-use — cleared immediately after successful reset.
        """
        # We need to find any user with a valid (non-expired) reset token.
        # We can't query by the raw token directly (it's never stored).
        # Strategy: find users with non-expired reset tokens and verify bcrypt.
        # In practice, the client should also send email or user_id to narrow the query;
        # here we use a broad query with expiry filter (acceptable — tokens are 64-byte random).
        now = datetime.now(timezone.utc)
        doc = await self._db.users.find_one({
            "reset_token_hash": {"$ne": None},
            "reset_token_exp": {"$gt": now},
        })

        if not doc:
            raise InvalidTokenException("Reset token is invalid or has expired")

        user = UserDocument.from_mongo(doc)

        # Bcrypt verify the raw token against the stored hash
        if not verify_reset_token(raw_token, user.reset_token_hash):
            raise InvalidTokenException("Reset token is invalid or has expired")

        # Prevent reuse of same password
        if verify_password(new_password, user.password_hash):
            raise ValidationException("New password must be different from the current password")

        new_hash = hash_password(new_password)
        await self._user_repo.update_password(user.id, new_hash)

        # Invalidate all existing sessions — a password reset should log out
        # every device, including one a thief might be holding.
        await self.revoke_all_user_tokens(user.id)

        await self._write_audit_log(
            db=self._db,
            actor_id=user.id,
            org_id=user.org_id,
            action="PASSWORD_RESET_COMPLETED",
            resource_type="user",
            resource_id=user.id,
        )

        logger.info(f"Password reset completed for user: {user.email}")

    # ── GET /me ───────────────────────────────────────────────────────────────

    async def get_me(self, user_id: str, org_id: str) -> MeResponse:
        """Returns the current user's profile with org details."""
        user = await self._user_repo.find_by_id(user_id, org_id=org_id)
        if not user:
            raise NotFoundException("User")

        org = await self._org_repo.find_by_id(org_id)
        if not org:
            raise NotFoundException("Organization")

        assigned_project_ids = await self._get_assigned_project_ids(user_id, org_id)

        return MeResponse(
            id=user.id,
            name=user.name,
            email=user.email,
            role=user.role,
            org_id=user.org_id,
            org_name=org.name,
            org_slug=org.slug,
            avatar_url=user.avatar_url,
            last_login=user.last_login,
            created_at=user.created_at,
            assigned_project_ids=assigned_project_ids,
        )

    # ── Private helpers ───────────────────────────────────────────────────────

    @staticmethod
    def _id_variants(value: str) -> list:
        """Returns [str] or [str, ObjectId] so queries match either storage form."""
        variants: list = [value]
        if ObjectId.is_valid(value):
            variants.append(ObjectId(value))
        return variants

    async def _get_assigned_project_ids(self, user_id: str, org_id: str) -> list[str]:
        """Returns project IDs where the user has an active assignment.

        user_id and org_id may be stored as either a string or an ObjectId
        depending on which code path created the assignment, so match both.
        """
        try:
            cursor = self._db.user_projects.find(
                {
                    "user_id": {"$in": self._id_variants(user_id)},
                    "org_id": {"$in": self._id_variants(org_id)},
                    "is_active": True,
                },
                {"project_id": 1},
            )
            docs = await cursor.to_list(length=200)
            return [str(d["project_id"]) for d in docs]
        except Exception as exc:
            logger.warning(f"Could not fetch assigned_project_ids for {user_id}: {exc}")
            return []

    async def set_user_project_assignments(
        self, user_id: str, org_id: str, project_ids: list[str], assigned_by: str
    ) -> list[str]:
        """Replaces a user's active assignments with the given project set.

        Revokes assignments not in the new set, creates the missing ones, and
        returns the resulting list of assigned project IDs.
        """
        current = set(await self._get_assigned_project_ids(user_id, org_id))
        desired = set(project_ids)

        # Revoke assignments no longer wanted
        to_revoke = current - desired
        if to_revoke:
            try:
                await self._db.user_projects.update_many(
                    {
                        "user_id": {"$in": self._id_variants(user_id)},
                        "org_id": {"$in": self._id_variants(org_id)},
                        "project_id": {"$in": list(to_revoke)},
                        "is_active": True,
                    },
                    {"$set": {"is_active": False, "revoked_at": datetime.now(timezone.utc)}},
                )
            except Exception as exc:
                logger.warning(f"Failed to revoke assignments for {user_id}: {exc}")

        # Create the new ones
        to_add = desired - current
        if to_add:
            await self._create_project_assignments(
                user_id=user_id,
                org_id=org_id,
                project_ids=list(to_add),
                assigned_by=assigned_by,
            )

        return await self._get_assigned_project_ids(user_id, org_id)

    async def _create_project_assignments(
        self, user_id: str, org_id: str, project_ids: list[str], assigned_by: str
    ) -> None:
        """Creates active user_projects assignments, inserting raw documents.

        Bypasses UserProjectDocument because project IDs in this system are
        often plain strings (e.g. "p72518") that the strict PyObjectId model
        would reject. Projects store their org under "orgId" (camelCase, from
        the workflow endpoints) or "org_id", as a string or ObjectId — match all.
        """
        org_variants = self._id_variants(org_id)
        now = datetime.now(timezone.utc)
        for project_id in project_ids:
            try:
                proj_doc = await self._db.projects.find_one({
                    "_id": {"$in": self._id_variants(project_id)},
                    "$or": [
                        {"orgId": {"$in": org_variants}},
                        {"org_id": {"$in": org_variants}},
                    ],
                })
                if not proj_doc:
                    logger.warning(
                        f"Project {project_id} not found in org {org_id} — "
                        f"skipping assignment for user {user_id}"
                    )
                    continue

                resolved_pid = str(proj_doc.get("id") or proj_doc["_id"])

                # Skip if an active assignment already exists
                existing = await self._db.user_projects.find_one({
                    "user_id": {"$in": self._id_variants(user_id)},
                    "project_id": resolved_pid,
                    "is_active": True,
                })
                if existing:
                    continue

                await self._db.user_projects.insert_one({
                    "org_id": ObjectId(org_id) if ObjectId.is_valid(org_id) else org_id,
                    "user_id": ObjectId(user_id) if ObjectId.is_valid(user_id) else user_id,
                    "project_id": resolved_pid,
                    "project_role": "contributor",
                    "assigned_by": ObjectId(assigned_by) if ObjectId.is_valid(assigned_by) else assigned_by,
                    "assigned_at": now,
                    "is_active": True,
                    "created_at": now,
                    "updated_at": now,
                })
                logger.info(f"Assigned user {user_id} to project {resolved_pid}")
            except Exception as exc:
                logger.warning(f"Failed to assign user {user_id} to project {project_id}: {exc}")

    @staticmethod
    async def _write_audit_log(
        db: AsyncIOMotorDatabase,
        actor_id: str,
        org_id: str,
        action: str,
        resource_type: str,
        resource_id: str,
        payload: Optional[dict] = None,
    ) -> None:
        """
        Writes an immutable audit log entry.
        Fire-and-forget — failures are logged but never raise (audit must not
        block the primary operation).
        """
        try:
            from bson import ObjectId as BsonObjectId
            log_entry = {
                "org_id": BsonObjectId(org_id) if org_id and BsonObjectId.is_valid(org_id) else org_id,
                "actor_id": BsonObjectId(actor_id) if actor_id and BsonObjectId.is_valid(actor_id) else actor_id,
                "action": action,
                "resource_type": resource_type,
                "resource_id": BsonObjectId(resource_id) if resource_id and BsonObjectId.is_valid(resource_id) else resource_id,
                "payload": payload or {},
                "created_at": datetime.now(timezone.utc),
            }
            await db.audit_logs.insert_one(log_entry)
        except Exception as exc:
            logger.error(f"Audit log write failed [{action}]: {exc}")
