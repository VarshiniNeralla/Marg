"""Recycle bin API: list what was deleted, restore it, or empty the bin. See app/services/recycle_bin.py."""
from typing import Optional

from fastapi import APIRouter, Query

from app.core.dependencies import CallerContext, DB
from app.core.exceptions import ForbiddenException, NotFoundException
from app.services import recycle_bin
from app.services.rbac_service import RBACService
from app.utils.pagination import success_response

router = APIRouter(prefix="/recycle-bin", tags=["Recycle bin"])

# Everyone who can delete something may open the bin. Read-only roles have nothing of their own to restore.
_ALLOWED_ROLES = {"super_admin", "admin", "manager", "reviewer", "field_engineer"}


async def _scope(ctx: CallerContext, db: DB) -> Optional[list[str]]:
    if ctx.role not in _ALLOWED_ROLES:
        raise ForbiddenException(f"Your role ('{ctx.role}') cannot use the recycle bin.")
    return await RBACService(db).get_accessible_project_ids(ctx.user_id, ctx.org_id, ctx.role)


@router.get("", summary="List deleted items")
async def list_bin(
    ctx: CallerContext,
    db: DB,
    kind: str = Query("all", pattern="^(all|capture|tour|floor_plan|project)$"),
    sort: str = Query("newest", pattern="^(newest|oldest|expiring|name|type)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100, alias="pageSize"),
):
    accessible = await _scope(ctx, db)
    rows, counts = await recycle_bin.list_rows(
        db, org_id=ctx.org_id, user_id=ctx.user_id, role=ctx.role, accessible=accessible, kind=kind, sort=sort,
    )
    total = len(rows)
    pages = max(1, -(-total // page_size))
    page = min(page, pages)
    start = (page - 1) * page_size
    return success_response(data={
        "items": rows[start:start + page_size],
        "total": total,
        "page": page,
        "pageSize": page_size,
        "pages": pages,
        "counts": counts,
        "retentionDays": recycle_bin.RETENTION_DAYS,
    })


@router.post("/{entry_id}/restore", summary="Restore a deleted item")
async def restore_item(entry_id: str, ctx: CallerContext, db: DB):
    accessible = await _scope(ctx, db)
    entry = await recycle_bin.find_visible_entry(
        db, entry_id=entry_id, org_id=ctx.org_id, user_id=ctx.user_id, role=ctx.role, accessible=accessible,
    )
    if entry is None:
        raise NotFoundException("Deleted item", entry_id)
    outcome = await recycle_bin.restore_entry(db, entry)
    return success_response(
        data={"id": entry_id, "kind": entry["kind"], "outcome": outcome},
        message="Item restored" if outcome == "restored" else "Item was already back",
    )


@router.delete("", summary="Empty the recycle bin")
async def empty_bin(
    ctx: CallerContext,
    db: DB,
    kind: str = Query("all", pattern="^(all|capture|tour|floor_plan|project)$"),
):
    """Permanently delete everything this person can see in the bin (optionally one kind). Cannot be undone."""
    accessible = await _scope(ctx, db)
    rows, _ = await recycle_bin.list_rows(
        db, org_id=ctx.org_id, user_id=ctx.user_id, role=ctx.role, accessible=accessible, kind=kind,
    )
    purged = 0
    for row in rows:
        entry = await recycle_bin.find_visible_entry(
            db, entry_id=row["id"], org_id=ctx.org_id, user_id=ctx.user_id, role=ctx.role, accessible=accessible,
        )
        if entry is None:
            continue
        await recycle_bin.purge_entry(db, entry)
        purged += 1
    return success_response(data={"purged": purged}, message=f"{purged} item(s) permanently deleted")
