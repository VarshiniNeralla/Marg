from typing import Any

from fastapi import Query


class PaginationParams:
    """
    FastAPI dependency class for standard pagination query parameters.
    Usage: pagination: PaginationParams = Depends()
    """

    def __init__(
        self,
        page: int = Query(default=1, ge=1, description="Page number (1-indexed)"),
        limit: int = Query(default=20, ge=1, le=100, description="Items per page (max 100)"),
    ) -> None:
        self.page = page
        self.limit = limit
        self.skip = (page - 1) * limit


def paginated_response(
    data: list[Any],
    total: int,
    page: int,
    limit: int,
    message: str = None,
) -> dict:
    """
    Builds the standard paginated list response envelope.
    Matches the API contract: { success, data, total, page, limit }
    """
    response = {
        "success": True,
        "data": data,
        "total": total,
        "page": page,
        "limit": limit,
    }
    if message:
        response["message"] = message
    return response


def success_response(data: Any = None, message: str = None) -> dict:
    """Builds a standard single-item success response envelope."""
    response: dict = {"success": True}
    if data is not None:
        response["data"] = data
    if message:
        response["message"] = message
    return response
