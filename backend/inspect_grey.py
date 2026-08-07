import asyncio

from motor.motor_asyncio import AsyncIOMotorClient

from app.services.cloudinary_service import cloudinary_asset_exists

URI = "mongodb+srv://nerallavarshini_db_user:szYt4X2Lnk2TbJLE@cluster0.yyx0t4j.mongodb.net/?appName=Cluster0"


async def main() -> None:
    db = AsyncIOMotorClient(URI)["virtual_tour"]

    caps = await db["captures"].find(
        {"floorLabel": "Floor 1", "towerName": "Tower 1"},
        {"roomName": 1, "mediaAssets": 1, "createdAt": 1, "processingStatus": 1, "processing_status": 1},
    ).to_list(length=None)

    def seq(c):
        import re
        m = re.search(r"(\d+)", str(c.get("roomName") or ""))
        return int(m.group(1)) if m else 999

    caps.sort(key=seq)

    print(f"{'Pin':6} {'id':8} {'status':10} {'createdAt':32} {'thumb':6} {'orig':6} {'liveCheck'}")
    for c in caps:
        assets = c.get("mediaAssets") or []
        a = assets[0] if assets else {}
        thumb = a.get("thumbnail_url")
        orig = a.get("original_url")
        pid = a.get("public_id")
        exists = await cloudinary_asset_exists(pid) if pid else None
        state = {True: "LIVE", False: "DEAD", None: "?"}[exists]
        print(f"{str(c.get('roomName')):6} {c['_id']:8} "
              f"{str(c.get('processingStatus') or c.get('processing_status')):10} "
              f"{str(c.get('createdAt')):32} {'Y' if thumb else 'N':6} {'Y' if orig else 'N':6} {state}")
        if thumb:
            print(f"       thumb: {thumb}")
        if orig:
            print(f"       orig : {orig}")


asyncio.run(main())

async def check_duplicates():
    db = AsyncIOMotorClient(URI)["virtual_tour"]
    caps = await db["captures"].find(
        {"floorLabel": "Floor 1", "towerName": "Tower 1"}, {"roomName": 1}
    ).to_list(length=None)
    from collections import Counter
    counts = Counter(c.get("roomName") for c in caps)
    print("\n=== duplicate roomName counts ===")
    for name, n in sorted(counts.items()):
        if n > 1:
            print(f"  {name}: {n} captures")

asyncio.run(check_duplicates())
