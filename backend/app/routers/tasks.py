from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_role
from app.db import get_db
from app.models.auth import User
from app.models.tasks import TaskCategorySlug
from app.schemas.tasks import PaginatedTasks, TaskOut
from app.services.tasks import get_task_by_id, list_tasks

router = APIRouter(prefix="/tasks", tags=["Tasks"])


@router.get("", response_model=PaginatedTasks)
async def get_tasks(
    category: Optional[TaskCategorySlug] = Query(None, description="Filter by task category"),
    search: Optional[str] = Query(None, description="Search term across title, location, description"),
    lat: Optional[float] = Query(None, description="User's current latitude"),
    lng: Optional[float] = Query(None, description="User's current longitude"),
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(20, ge=1, le=100, description="Items per page"),
    user: User = Depends(require_role("citizen", "reviewer", "admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    List active civic tasks with optional category filter, search, and proximity sorting.
    Requires an authenticated citizen, reviewer, or admin.
    """
    items, meta = await list_tasks(
        db,
        category=category,
        search=search,
        lat=lat,
        lng=lng,
        page=page,
        limit=limit,
    )
    return PaginatedTasks(items=items, meta=meta)


@router.get("/{taskId}", response_model=TaskOut)
async def get_task(
    taskId: str,
    lat: Optional[float] = Query(None, description="User's current latitude for distance"),
    lng: Optional[float] = Query(None, description="User's current longitude for distance"),
    user: User = Depends(require_role("citizen", "reviewer", "admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    Get full task details by ID.
    Requires an authenticated citizen.
    """
    task = await get_task_by_id(db, taskId, lat=lat, lng=lng)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "not_found", "message": f"Task '{taskId}' not found"},
        )
    return task
