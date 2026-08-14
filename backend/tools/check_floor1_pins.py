"""Check labeled capture pins for Project A / Tower 1 / Floor 1."""
from __future__ import annotations

import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

URI = os.environ["MONGO_URI"]
DB_NAME = os.environ.get("DB_NAME", "virtual_tour")


async def main() -> None:
    client = AsyncIOMotorClient(URI)
    db = client[DB_NAME]

    projects = await db["projects"].find({}).to_list(100)
    print("=== PROJECTS ===")
    for p in projects:
        print(f"  id={p.get('_id') or p.get('id')} name={p.get('name')!r}")

    proj = next(
        (
            p
            for p in projects
            if str(p.get("name") or "").strip().lower() in {"project a", "a"}
            or str(p.get("name") or "").strip().lower().startswith("project a")
        ),
        None,
    )
    if not proj:
        print("ERROR: Project A not found")
        return

    pid = str(proj.get("_id") or proj.get("id"))
    print(f"\nSelected: {proj.get('name')!r} ({pid})")

    towers = await db["towers"].find({"projectId": pid}).to_list(50)
    if not towers:
        towers = [
            t
            for t in await db["towers"].find({}).to_list(200)
            if str(t.get("projectId")) == pid
        ]
    print("\n=== TOWERS ===")
    for t in towers:
        print(f"  id={t.get('_id') or t.get('id')} name={t.get('name')!r}")

    tower = next(
        (
            t
            for t in towers
            if str(t.get("name") or "").strip() in {"1", "Tower 1", "T1"}
        ),
        towers[0] if towers else None,
    )
    if not tower:
        print("ERROR: Tower 1 not found")
        return
    tid = str(tower.get("_id") or tower.get("id"))
    print(f"\nSelected tower: {tower.get('name')!r} ({tid})")

    floors = await db["floors"].find({"towerId": tid}).to_list(100)
    print("\n=== FLOORS ===")
    for f in floors:
        print(
            f"  id={f.get('_id') or f.get('id')} label={f.get('label')!r} "
            f"number={f.get('number')} floorPlanId={f.get('floorPlanId')}"
        )

    floor = next(
        (
            f
            for f in floors
            if f.get("number") == 1
            or str(f.get("label") or "").strip() in {"Floor 1", "1", "F1"}
        ),
        None,
    )
    if not floor:
        print("ERROR: Floor 1 not found")
        return
    fid = str(floor.get("_id") or floor.get("id"))
    print(f"\nSelected floor: {floor.get('label')!r} ({fid})")

    plans = await db["floor_plans"].find({"floorId": fid}).to_list(20)
    print("\n=== FLOOR PLANS ===")
    for fp in plans:
        print(
            f"  id={fp.get('_id') or fp.get('id')} "
            f"status={fp.get('pinLayoutStatus')} "
            f"visible={fp.get('pinsVisible')} "
            f"needsReannotate={fp.get('needsReannotate')} "
            f"file={fp.get('fileName') or fp.get('file_name')}"
        )

    pins = (
        await db["capture_pins"]
        .find({"floorId": fid})
        .sort("sequenceNumber", 1)
        .to_list(500)
    )
    print(f"\n=== CAPTURE PINS ({len(pins)}) ===")
    labeled = 0
    unlabeled = 0
    by_flat: dict[str, list[str]] = {}
    for p in pins:
        flat = str(p.get("flatName") or "").strip()
        room = str(p.get("roomName") or "").strip()
        ok = bool(flat and room)
        if ok:
            labeled += 1
            by_flat.setdefault(flat, []).append(room)
        else:
            unlabeled += 1
        x = p.get("x")
        y = p.get("y")
        try:
            xy = f"x={float(x):.1f} y={float(y):.1f}"
        except (TypeError, ValueError):
            xy = f"x={x} y={y}"
        print(
            f"  #{p.get('sequenceNumber')} {flat or '—'} · {room or '—'} "
            f"| predef={p.get('isPredefined')} source={p.get('source')} "
            f"| {xy} | captures={len(p.get('captureIds') or [])}"
        )

    print("\n=== BY FLAT ===")
    for flat, rooms in sorted(by_flat.items()):
        print(f"  {flat}: {len(rooms)} points → {', '.join(rooms)}")

    print(
        f"\nSUMMARY: total={len(pins)} labeled_with_flat_and_room={labeled} "
        f"missing_labels={unlabeled}"
    )
    if labeled and unlabeled == 0:
        print("RESULT: OK — all pins have flatName + roomName on the server.")
    elif labeled:
        print("RESULT: PARTIAL — some pins are labeled, some are not.")
    else:
        print("RESULT: MISSING — no labeled pins found on the server for this floor.")


if __name__ == "__main__":
    asyncio.run(main())
