import asyncio

from motor.motor_asyncio import AsyncIOMotorClient

from app.services.cloudinary_service import cloudinary_asset_exists

URI = "mongodb+srv://nerallavarshini_db_user:szYt4X2Lnk2TbJLE@cluster0.yyx0t4j.mongodb.net/?appName=Cluster0"


async def main() -> None:
    db = AsyncIOMotorClient(URI)["virtual_tour"]

    # Grab the capture ids we already confirmed belong to Tower 1 / Floor 1,
    # then follow roomId -> capture_pins to find the real floor plan id.
    caps = await db["captures"].find(
        {"floorLabel": "Floor 1", "towerName": "Tower 1"}, {"roomId": 1, "roomName": 1}
    ).to_list(length=None)
    room_ids = {c["roomId"] for c in caps if c.get("roomId")}

    pins = await db["capture_pins"].find({"roomId": {"$in": list(room_ids)}}).to_list(length=None)
    fp_ids = {p.get("floorPlanId") for p in pins if p.get("floorPlanId")}
    print("floorPlanIds found via pins:", fp_ids)

    all_pins_on_plan = await db["capture_pins"].find({"floorPlanId": {"$in": list(fp_ids)}}).to_list(length=None)
    print(f"\n=== ALL pins on these floor plan(s): {len(all_pins_on_plan)} ===")
    for p in sorted(all_pins_on_plan, key=lambda d: d.get("sequenceNumber") or 0):
        cids = p.get("captureIds") or []
        print(f"\nseq={p.get('sequenceNumber')} pin={p['_id']} fp={p.get('floorPlanId')} captureIds={cids}")
        for cid in cids:
            cap = await db["captures"].find_one({"_id": cid})
            if not cap:
                print(f"    {cid}: *** MISSING DOC ***")
                continue
            assets = cap.get("mediaAssets") or []
            a = assets[0] if assets else {}
            pid = a.get("public_id")
            exists = await cloudinary_asset_exists(pid) if pid else None
            state = {True: "LIVE", False: "DEAD", None: "?"}[exists]
            print(f"    {cid}: roomName={cap.get('roomName')!r} createdAt={cap.get('createdAt')} "
                  f"thumb_url={a.get('thumbnail_url')!r} state={state}")


asyncio.run(main())
