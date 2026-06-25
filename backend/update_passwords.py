"""
One-time migration: update all user passwords from Horizon@123 → Prangan@123.
Run from the backend/ directory:
    uv run python update_passwords.py
"""
import asyncio
from loguru import logger
from app.core.security import hash_password, verify_password
from app.db.mongodb import close_db, connect_db, get_database

OLD_PASSWORD = "Horizon@123"
NEW_PASSWORD = "Prangan@123"


async def run() -> None:
    await connect_db()
    db = get_database()
    users_col = db["users"]

    cursor = users_col.find({}, {"_id": 1, "email": 1, "password_hash": 1})
    updated = 0
    skipped = 0

    async for user in cursor:
        if verify_password(OLD_PASSWORD, user["password_hash"]):
            new_hash = hash_password(NEW_PASSWORD)
            await users_col.update_one(
                {"_id": user["_id"]},
                {"$set": {"password_hash": new_hash}},
            )
            logger.info(f"Updated password for {user['email']}")
            updated += 1
        else:
            logger.info(f"Skipped {user['email']} (password doesn't match old value)")
            skipped += 1

    await close_db()
    logger.success(f"Done. Updated: {updated}, Skipped: {skipped}")


if __name__ == "__main__":
    asyncio.run(run())
