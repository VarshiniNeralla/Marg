from fastapi import APIRouter

from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.organizations import router as org_router
from app.api.v1.endpoints.uploads import router as uploads_router
from app.api.v1.endpoints.user_projects import router as user_projects_router
from app.api.v1.endpoints.users import router as users_router
from app.api.v1.endpoints.progress_analysis import router as progress_analysis_router
from app.api.v1.endpoints.construction_progress import router as construction_progress_router
from app.api.v1.endpoints.drishti import router as drishti_router
from app.api.v1.endpoints.workflow import router as workflow_router

# ── v1 root router ────────────────────────────────────────────────────────────
# All routers are mounted under /api/v1 (prefix set in main.py).

api_router = APIRouter()

# Phase 1 — Authentication
api_router.include_router(auth_router)

# Phase 2A — Multi-tenancy & RBAC foundation
api_router.include_router(org_router)
api_router.include_router(users_router)
api_router.include_router(user_projects_router)
api_router.include_router(workflow_router)
api_router.include_router(uploads_router)
api_router.include_router(progress_analysis_router)
api_router.include_router(construction_progress_router)
api_router.include_router(drishti_router)

# Phase 3 — (uncomment as implemented)
# from app.api.v1.endpoints.projects import router as projects_router
# from app.api.v1.endpoints.towers import router as towers_router
# from app.api.v1.endpoints.floors import router as floors_router
# from app.api.v1.endpoints.rooms import router as rooms_router
# api_router.include_router(projects_router)
# api_router.include_router(towers_router)
# api_router.include_router(floors_router)
# api_router.include_router(rooms_router)

# Phase 4 — (uncomment as implemented)
# from app.api.v1.endpoints.captures import router as captures_router
# from app.api.v1.endpoints.tours import router as tours_router
# from app.api.v1.endpoints.analytics import router as analytics_router
# from app.api.v1.endpoints.search import router as search_router
# api_router.include_router(captures_router)
# api_router.include_router(tours_router)
# api_router.include_router(analytics_router)
# api_router.include_router(search_router)
