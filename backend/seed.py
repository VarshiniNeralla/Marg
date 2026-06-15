"""
Bootstrap seed script.

Solves the chicken-and-egg problem in the auth flow:
  - Registering a user requires an *existing active* organization (org_slug).
  - Creating an organization via the API requires a super_admin user.
  - A fresh database has neither, so every /auth/register call 404s with
    "Organization '<slug>' not found".

This script seeds a default organization (so self-registration works) and an
initial super_admin user (so org-management endpoints work and you have a
known login immediately). It is idempotent — re-running skips what exists.

Usage (from the backend/ directory):
    uv run python seed.py
    uv run python seed.py --org-slug acme-corp --org-name "Acme Corp" \
        --admin-email admin@acme.com --admin-password "Admin@123"
"""

import argparse
import asyncio

from loguru import logger

from app.core.security import hash_password
from app.db.mongodb import close_db, connect_db, get_database
from app.models.organization import OrganizationDocument
from app.models.user import UserDocument
from app.repositories.organization import OrganizationRepository
from app.repositories.user import UserRepository


async def seed(
    org_slug: str,
    org_name: str,
    admin_email: str,
    admin_password: str,
) -> None:
    await connect_db()
    db = get_database()

    org_repo = OrganizationRepository(db)
    user_repo = UserRepository(db)

    org_slug = org_slug.lower()
    admin_email = admin_email.lower()

    # ── 1. Organization ─────────────────────────────────────────────────────────
    org = await org_repo.find_by_slug(org_slug)
    if org:
        logger.info(f"Organization '{org_slug}' already exists (id={org.id}) — skipping.")
    else:
        org_id = await org_repo.create(
            OrganizationDocument(
                name=org_name,
                slug=org_slug,
                status="active",
            )
        )
        org = await org_repo.find_by_id(org_id)
        logger.info(f"Created organization '{org_slug}' (id={org_id}).")

    # ── 2. Super-admin user ─────────────────────────────────────────────────────
    if await user_repo.email_exists(admin_email):
        logger.info(f"User '{admin_email}' already exists — skipping.")
    else:
        admin_id = await user_repo.create(
            UserDocument(
                org_id=org.id,
                name="Platform Admin",
                email=admin_email,
                password_hash=hash_password(admin_password),
                role="super_admin",
                is_active=True,
            )
        )
        # Point the org's owner at the admin we just created.
        await org_repo.update_settings(str(org.id), {"owner_id": admin_id})
        logger.info(f"Created super_admin user '{admin_email}' (id={admin_id}).")

    await close_db()

    logger.success(
        "Seed complete.\n"
        f"  • Organization slug : {org_slug}\n"
        f"  • Admin login       : {admin_email} / {admin_password}\n"
        f"  • Self-register     : use org slug '{org_slug}' on the Register page."
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed an initial organization + super_admin.")
    parser.add_argument("--org-slug", default="demo", help="Organization slug (default: demo)")
    parser.add_argument("--org-name", default="Demo Organization", help="Organization display name")
    parser.add_argument("--admin-email", default="admin@demo.com", help="Super-admin email")
    parser.add_argument(
        "--admin-password",
        default="Admin@123",
        help="Super-admin password (must satisfy the password policy)",
    )
    args = parser.parse_args()

    asyncio.run(
        seed(
            org_slug=args.org_slug,
            org_name=args.org_name,
            admin_email=args.admin_email,
            admin_password=args.admin_password,
        )
    )


if __name__ == "__main__":
    main()
