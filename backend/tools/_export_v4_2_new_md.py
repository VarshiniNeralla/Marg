"""Export Floor 1 Flat Finishing Works activity % to v4_2_new.md."""
from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")
load_dotenv(ROOT / "backend" / ".env")

FLOOR_ID = "t72554-f1-f72555"
OUT = ROOT / "v4_2_new.md"


def _pct(v) -> str:
    try:
        return f"{float(v):.1f}%"
    except (TypeError, ValueError):
        return "—"


def _act_rows(activities: list[dict]) -> list[str]:
    lines: list[str] = []
    if not activities:
        lines.append("_No scored activities._")
        return lines
    lines.append("| Activity | % | Confidence | Status | Evidence |")
    lines.append("|---|---:|---:|---|---|")
    for a in sorted(
        activities,
        key=lambda x: str(x.get("activityName") or x.get("name") or ""),
    ):
        name = a.get("activityName") or a.get("name") or a.get("activityId") or "?"
        pct = a.get("completionPct")
        if pct is None:
            pct = a.get("completion_pct")
        conf = a.get("confidencePct")
        if conf is None:
            conf = a.get("confidence_pct")
        status = a.get("status") or "—"
        evidence = (a.get("evidence") or "").replace("|", "/").replace("\n", " ").strip()
        if len(evidence) > 140:
            evidence = evidence[:137] + "..."
        caps = a.get("evidenceCaptureIds") or a.get("evidence_capture_ids") or []
        if caps and evidence == "":
            evidence = f"captures: {', '.join(str(c) for c in caps)}"
        elif caps:
            evidence = f"{evidence} 〔{', '.join(str(c) for c in caps)}〕"
        lines.append(
            f"| {name} | {_pct(pct)} | {_pct(conf)} | {status} | {evidence or '—'} |"
        )
    return lines


def main() -> None:
    uri = os.environ.get("MONGO_URI") or os.environ.get("MONGODB_URI")
    db_name = os.environ.get("DB_NAME") or os.environ.get("MONGODB_DB") or "virtual_tour"
    if not uri:
        raise SystemExit("MONGO_URI not set")

    client = MongoClient(uri)
    db = client[db_name]
    doc = db["construction_progress_snapshots"].find_one(
        {"floorId": FLOOR_ID},
        sort=[("snapshotDate", -1), ("createdAt", -1)],
    )
    if not doc:
        raise SystemExit(f"No snapshot for floor {FLOOR_ID}")

    pins = list(doc.get("heatmapPins") or [])
    pins.sort(key=lambda p: int(p.get("sequenceNumber") or 0))
    flat_progress = list(doc.get("flatProgress") or [])
    floor_acts = list(doc.get("activities") or [])

    room_index: dict[tuple[str, str], dict] = {}
    for fp in flat_progress:
        flat = str(fp.get("flatName") or "")
        for room in fp.get("rooms") or []:
            room_index[(flat, str(room.get("roomName") or ""))] = room

    snap_id = str(doc.get("_id") or "")
    created = doc.get("createdAt") or doc.get("snapshotDate")
    prompt = doc.get("promptVersion") or doc.get("prompt_version") or "unknown"
    model = doc.get("model") or "—"
    overall = doc.get("overallProgressPct")
    conf = doc.get("overallConfidencePct")
    images = doc.get("imagesAnalyzedCount")
    status = doc.get("overallStatus") or "—"

    lines: list[str] = []
    lines.append("# Flat Finishing Works — Floor 1 · Tower 1 · My Home Apas")
    lines.append("")
    lines.append(f"- **Floor ID:** `{FLOOR_ID}`")
    lines.append(f"- **Snapshot ID:** `{snap_id}`")
    lines.append(f"- **Prompt version:** `{prompt}`")
    lines.append(f"- **Model:** `{model}`")
    lines.append(f"- **Snapshot time:** `{created}`")
    lines.append(f"- **Overall floor progress:** {_pct(overall)} (`{status}`)")
    lines.append(f"- **AI confidence:** {_pct(conf)}")
    lines.append(f"- **Images analyzed:** {images}")
    lines.append(f"- **Exported:** {datetime.now(timezone.utc).isoformat()}")
    lines.append("")
    lines.append(
        "Per-capture (pin) activity details from Flat Finishing Works "
        "`flatProgress` rooms, matched via `heatmapPins`."
    )
    lines.append("")
    lines.append(
        "**Note:** If human reviews were re-applied after analyze, some % / evidence "
        "text may include reviewer overrides, not raw model-only output."
    )
    lines.append("")

    lines.append("## Captures (pins 1–11)")
    lines.append("")

    for pin in pins:
        seq = int(pin.get("sequenceNumber") or 0)
        if seq < 1 or seq > 11:
            continue
        flat = str(pin.get("flatName") or pin.get("flat_name") or "—")
        room = str(pin.get("roomName") or pin.get("room_name") or "—")
        cap_ids = pin.get("captureIds") or pin.get("capture_ids") or []
        if isinstance(cap_ids, str):
            cap_ids = [cap_ids]
        cap_ids = [str(c) for c in cap_ids if c]
        state = pin.get("state") or "—"

        room_doc = room_index.get((flat, room))
        if not room_doc:
            for (f, r), rd in room_index.items():
                if f == flat and r.lower() == room.lower():
                    room_doc = rd
                    break
        acts = list((room_doc or {}).get("activities") or [])

        # Collect evidence capture ids from activities if pin has none
        if not cap_ids:
            found: set[str] = set()
            for a in acts:
                for c in a.get("evidenceCaptureIds") or a.get("evidence_capture_ids") or []:
                    if c:
                        found.add(str(c))
            cap_ids = sorted(found)

        lines.append(f"### Pin {seq} — {flat} · {room}")
        lines.append("")
        lines.append(
            f"- **Capture ID(s):** {', '.join(f'`{c}`' for c in cap_ids) or '—'}"
        )
        lines.append(f"- **Heatmap state:** `{state}`")
        lines.append("")
        lines.extend(_act_rows(acts))
        lines.append("")

    lines.append("## Flat rollup (all rooms)")
    lines.append("")
    for fp in sorted(flat_progress, key=lambda x: str(x.get("flatName") or "")):
        flat = fp.get("flatName") or "—"
        lines.append(f"### {flat}")
        lines.append("")
        lines.append(
            f"- Rooms complete: {fp.get('roomsComplete', '—')} / {fp.get('roomsTotal', '—')}"
        )
        lines.append(
            f"- Flat work progress: {_pct(fp.get('workProgressPct') or fp.get('completionPct') or fp.get('progressPct'))}"
        )
        lines.append("")
        for room in fp.get("rooms") or []:
            rname = room.get("roomName") or "—"
            pins_here = room.get("pinNumbers") or []
            lines.append(f"#### {rname}")
            if pins_here:
                lines.append(f"- Pins: {', '.join(str(p) for p in pins_here)}")
            lines.append("")
            lines.extend(_act_rows(list(room.get("activities") or [])))
            lines.append("")

    lines.append("## Floor-level activity cards")
    lines.append("")
    lines.append("| Activity | Section | % | Confidence | Status |")
    lines.append("|---|---|---:|---:|---|")
    for a in floor_acts:
        name = a.get("name") or a.get("activityName") or a.get("activityId") or "?"
        section = a.get("section") or "—"
        pct = a.get("completionPct")
        c = a.get("confidencePct")
        st = a.get("status") or "—"
        lines.append(f"| {name} | {section} | {_pct(pct)} | {_pct(c)} | {st} |")
    lines.append("")

    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(
        f"Wrote {OUT} pins={sum(1 for p in pins if 1 <= int(p.get('sequenceNumber') or 0) <= 11)} "
        f"prompt={prompt} overall={overall}"
    )


if __name__ == "__main__":
    main()
