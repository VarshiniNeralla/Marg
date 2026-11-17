"""Manager review notes on Virtual Tour photos.

A note is a comment ("Windows not yet installed") on one capture of a tour, optionally with shapes drawn on the
photo. Managers write, edit, resolve and delete notes; everyone who can open the tour can read them, so people see
what still needs doing. Notes never touch the capture itself, so no photo is ever changed or lost.
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, status
from loguru import logger

from app.api.v1.endpoints.workflow import (
    _assert_can_access_tour,
    _id_filter,
    _is_field_engineer,
    _now,
    _resolve_user_display_name,
)
from app.core.dependencies import CallerContext, DB
from app.core.exceptions import ForbiddenException, NotFoundException, ValidationException
from app.services.review_notes import clean_shapes, clean_text
from app.utils.pagination import success_response

router = APIRouter(tags=["Review notes"])

COLLECTION = "review_notes"
MAX_NOTES_PER_TOUR = 2000


def _is_manager(ctx: CallerContext) -> bool:
    return str(ctx.role or "") == "manager"


def _out(doc: dict[str, Any]) -> dict[str, Any]:
    out = dict(doc)
    out["id"] = str(out.pop("_id", out.get("id")))
    out.pop("orgId", None)
    return out


async def _load_tour(db: DB, ctx: CallerContext, tour_id: str) -> dict[str, Any]:
    tour = await db["tours"].find_one({"_id": _id_filter(tour_id), "orgId": ctx.org_id})
    if not tour:
        raise NotFoundException("tour", tour_id)
    if _is_field_engineer(ctx):
        name = await _resolve_user_display_name(db, ctx.user_id)
        _assert_can_access_tour(ctx, tour, name)
    return tour


def _require_manager(ctx: CallerContext) -> None:
    if not _is_manager(ctx):
        raise ForbiddenException("Only managers can add or change review notes")


@router.get("/tours/{tour_id}/review-notes", summary="List review notes on a tour")
async def list_review_notes(tour_id: str, ctx: CallerContext, db: DB, capture_id: Optional[str] = None):
    await _load_tour(db, ctx, tour_id)
    query: dict[str, Any] = {"orgId": ctx.org_id, "tourId": tour_id}
    if capture_id:
        query["captureId"] = capture_id
    docs = await db[COLLECTION].find(query).sort("createdAt", 1).to_list(length=MAX_NOTES_PER_TOUR)
    return success_response(data=[_out(d) for d in docs])


@router.post("/tours/{tour_id}/review-notes", status_code=status.HTTP_201_CREATED, summary="Add a review note")
async def create_review_note(tour_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB):
    _require_manager(ctx)
    await _load_tour(db, ctx, tour_id)
    capture_id = str(payload.get("captureId") or "").strip()
    if not capture_id:
        raise ValidationException("Choose the photo this note is about")
    annotation = clean_shapes(payload.get("annotation"))
    # A drawing may stand alone, but a plain comment needs words.
    text = clean_text(payload.get("text"), required=annotation is None)

    if await db[COLLECTION].count_documents({"orgId": ctx.org_id, "tourId": tour_id}) >= MAX_NOTES_PER_TOUR:
        raise ValidationException("This tour has reached its limit of review notes")

    now = _now()
    doc = {
        "orgId": ctx.org_id,
        "tourId": tour_id,
        "captureId": capture_id,
        "text": text,
        "annotation": annotation,
        "resolved": False,
        "createdBy": str(ctx.user_id),
        "createdByName": await _resolve_user_display_name(db, ctx.user_id),
        "createdAt": now,
        "updatedAt": now,
    }
    res = await db[COLLECTION].insert_one(doc)
    doc["_id"] = res.inserted_id
    logger.info(f"[review-notes] created {res.inserted_id} on tour {tour_id} capture {capture_id}")
    return success_response(data=_out(doc), message="Note added")


async def _find_note(db: DB, ctx: CallerContext, note_id: str) -> dict[str, Any]:
    doc = await db[COLLECTION].find_one({"_id": _id_filter(note_id), "orgId": ctx.org_id})
    if not doc:
        raise NotFoundException("note", note_id)
    return doc


@router.put("/review-notes/{note_id}", summary="Edit a review note or mark it resolved")
async def update_review_note(note_id: str, payload: dict[str, Any], ctx: CallerContext, db: DB):
    _require_manager(ctx)
    doc = await _find_note(db, ctx, note_id)
    changes: dict[str, Any] = {}
    if "text" in payload:
        # keep a drawing's note valid even when its words are cleared
        changes["text"] = clean_text(payload.get("text"), required=not doc.get("annotation"))
    if "resolved" in payload:
        changes["resolved"] = bool(payload.get("resolved"))
    if not changes:
        raise ValidationException("Nothing to change")
    changes["updatedAt"] = _now()
    await db[COLLECTION].update_one({"_id": doc["_id"], "orgId": ctx.org_id}, {"$set": changes})
    return success_response(data=_out({**doc, **changes}), message="Note updated")


@router.delete("/review-notes/{note_id}", summary="Delete a review note")
async def delete_review_note(note_id: str, ctx: CallerContext, db: DB):
    _require_manager(ctx)
    doc = await _find_note(db, ctx, note_id)
    await db[COLLECTION].delete_one({"_id": doc["_id"], "orgId": ctx.org_id})
    return success_response(data={"id": str(doc["_id"])}, message="Note deleted")
