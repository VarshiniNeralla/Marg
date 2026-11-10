"""One-off: find vipinademo user across Atlas DBs."""
from __future__ import annotations

import asyncio
import os

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()


async def main() -> None:
    client = AsyncIOMotorClient(os.environ["MONGO_URI"])
    print("DB_NAME env:", os.environ.get("DB_NAME"))
    print("MULTI_TENANT:", os.environ.get("MULTI_TENANT") or os.environ.get("MULTI_TENANT_MODE"))
    dbs = await client.list_database_names()
    print("databases:", [d for d in dbs if d not in ("admin", "local", "config")])
    needle = "vipina"
    for dbn in dbs:
        if dbn in ("admin", "local", "config"):
            continue
        db = client[dbn]
        for col in await db.list_collection_names():
            if "user" not in col.lower():
                continue
            hits = await db[col].find(
                {"email": {"$regex": needle, "$options": "i"}},
                {"email": 1, "role": 1, "is_active": 1, "org_id": 1, "name": 1, "hashed_password": 1, "password_hash": 1},
            ).to_list(20)
            for h in hits:
                print(
                    f"FOUND {dbn}.{col}: email={h.get('email')} name={h.get('name')} "
                    f"role={h.get('role')} active={h.get('is_active')} org={h.get('org_id')} "
                    f"has_hash={bool(h.get('hashed_password') or h.get('password_hash'))}"
                )
    exact = await client["virtual_tour"].users.find_one(
        {"email": "vipinademo@myhomeconstructions.com"}
    )
    print("exact virtual_tour.users:", exact is not None)
    myhome = await client["SiteVisionMyHome"].users.find_one(
        {"email": "vipinademo@myhomeconstructions.com"}
    ) if "SiteVisionMyHome" in dbs else None
    print("exact SiteVisionMyHome.users:", myhome is not None)
    if myhome:
        print("myhome keys:", sorted(myhome.keys()))


if __name__ == "__main__":
    asyncio.run(main())
