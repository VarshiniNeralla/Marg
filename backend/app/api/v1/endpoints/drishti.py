from fastapi import APIRouter

from app.core.dependencies import CallerContext, DB, ManagerOrAdminUser
from app.core.exceptions import ForbiddenException, NotFoundException
from app.schemas.drishti import AskDrishtiRequest, RenameDrishtiConversationRequest
from app.services.drishti_context_service import DrishtiContextService
from app.services.drishti_service import DrishtiService
from app.services.rbac_service import RBACService
from app.utils.pagination import success_response

router = APIRouter(prefix="/drishti", tags=["Drishti"])


async def _assert_project_access(ctx: CallerContext, db: DB, project_id: str) -> None:
    """The per-request project-authorization boundary every Drishti route
    with a project_id must pass through. Deliberately does NOT reuse the
    unfiltered `_list`/`list_floors` pattern that `workflow.py` and
    `construction_progress.py` use today (both skip this check entirely) —
    Drishti closes that gap rather than repeating it."""
    accessible = await RBACService(db).get_accessible_project_ids(ctx.user_id, ctx.org_id, ctx.role)
    if accessible is not None and project_id not in accessible:
        raise ForbiddenException("You do not have access to this project")


@router.get("/projects", summary="List projects Drishti can be asked about")
async def list_drishti_projects(ctx: CallerContext, db: DB, _manager_or_admin: ManagerOrAdminUser):
    accessible = await RBACService(db).get_accessible_project_ids(ctx.user_id, ctx.org_id, ctx.role)
    projects = await DrishtiContextService(db).list_accessible_projects(ctx.org_id, accessible)
    return success_response(data=projects)


@router.post("/projects/{project_id}/ask", summary="Ask Drishti a question about a project")
async def ask_drishti(
    project_id: str,
    body: AskDrishtiRequest,
    ctx: CallerContext,
    db: DB,
    _manager_or_admin: ManagerOrAdminUser,
):
    await _assert_project_access(ctx, db, project_id)
    result = await DrishtiService(db).ask(
        org_id=ctx.org_id,
        user_id=ctx.user_id,
        role=ctx.role,
        project_id=project_id,
        question=body.question,
        conversation_id=body.conversation_id,
    )
    return success_response(data=result)


@router.get("/projects/{project_id}/suggested-questions", summary="Get suggested questions for a project")
async def get_suggested_questions(
    project_id: str, ctx: CallerContext, db: DB, _manager_or_admin: ManagerOrAdminUser
):
    await _assert_project_access(ctx, db, project_id)
    questions = await DrishtiService(db).get_suggested_questions(ctx.org_id, project_id)
    return success_response(data={"questions": questions})


@router.get("/projects/{project_id}/conversations", summary="List this user's Drishti conversations for a project")
async def list_conversations(
    project_id: str, ctx: CallerContext, db: DB, _manager_or_admin: ManagerOrAdminUser
):
    await _assert_project_access(ctx, db, project_id)
    conversations = await DrishtiService(db).list_conversations(ctx.org_id, ctx.user_id, project_id)
    return success_response(data=conversations)


@router.get("/conversations/{conversation_id}", summary="Resume a Drishti conversation")
async def get_conversation(conversation_id: str, ctx: CallerContext, db: DB, _manager_or_admin: ManagerOrAdminUser):
    conversation = await DrishtiService(db).get_conversation(ctx.org_id, ctx.user_id, conversation_id)
    return success_response(data=conversation)


@router.patch("/conversations/{conversation_id}", summary="Rename a Drishti conversation")
async def rename_conversation(
    conversation_id: str,
    body: RenameDrishtiConversationRequest,
    ctx: CallerContext,
    db: DB,
    _manager_or_admin: ManagerOrAdminUser,
):
    updated = await DrishtiService(db).rename_conversation(
        ctx.org_id, ctx.user_id, conversation_id, body.title,
    )
    return success_response(data=updated, message="Chat renamed")


@router.delete("/conversations/{conversation_id}", summary="Delete a Drishti conversation")
async def delete_conversation(conversation_id: str, ctx: CallerContext, db: DB, _manager_or_admin: ManagerOrAdminUser):
    deleted_count = await DrishtiService(db).delete_conversation(ctx.org_id, ctx.user_id, conversation_id)
    if deleted_count == 0:
        raise NotFoundException("conversation", conversation_id)
    return success_response(data={"deleted": True})
