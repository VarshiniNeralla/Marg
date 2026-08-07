import asyncio

from motor.motor_asyncio import AsyncIOMotorClient

from app.services.cloudinary_service import cloudinary_asset_exists

URI = "mongodb+srv://nerallavarshini_db_user:szYt4X2Lnk2TbJLE@cluster0.yyx0t4j.mongodb.net/?appName=Cluster0"


async def main() -> None:
    db = AsyncIOMotorClient(URI)["virtual_tour"]

    pins = await db["capture_pins"].find({}).to_list(length=None)
    # Find the floor plan for Tower 1 / Floor 1
    plans = await db["floor_plans"].find({"floorLabel": "Floor 1", "towerName": "Tower 1"}).to_list(length=None)
    print("floor plans matching Tower 1 / Floor 1:", [p["_id"] for p in plans])

    fp_ids = {p["_id"] for p in plans}
    relevant_pins = [p for p in pins if p.get("floorPlanId") in fp_ids]

    print(f"\n=== pins on this floor plan ({len(relevant_pins)}) ===")
    for p in sorted(relevant_pins, key=lambda d: d.get("sequenceNumber") or 0):
        cids = p.get("captureIds") or []
        print(f"\nseq={p.get('sequenceNumber')} pin={p['_id']} captureIds={cids}")
        for cid in cids:
            cap = await db["captures"].find_one({"_id": cid})
            if not cap:
                print(f"    {cid}: MISSING DOC")
                continue
            assets = cap.get("mediaAssets") or []
            a = assets[0] if assets else {}
            pid = a.get("public_id")
            exists = await cloudinary_asset_exists(pid) if pid else None
            state = {True: "LIVE", False: "DEAD", None: "?"}[exists]
            print(f"    {cid}: roomName={cap.get('roomName')!r} createdAt={cap.get('createdAt')} "
                  f"thumb={bool(a.get('thumbnail_url'))} state={state}")


asyncio.run(main())
