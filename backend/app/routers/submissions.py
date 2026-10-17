from __future__ import annotations

from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_role
from app.db import get_db
from app.models.auth import User
from app.schemas.submissions import (
    PaginatedSubmissions,
    SubmissionDetail,
    SubmissionStatusEnum,
)
from app.services.submissions import (
    create_submission,
    get_submission_by_id,
    get_submission_photo_path,
    list_my_submissions,
    resubmit_submission,
)

router = APIRouter(prefix="/submissions", tags=["Submissions"])


@router.post("", response_model=SubmissionDetail, status_code=status.HTTP_201_CREATED)
async def post_submission(
    request: Request,
    photo: UploadFile = File(...),
    lat: float = Form(..., description="Latitude coordinate"),
    lng: float = Form(..., description="Longitude coordinate"),
    accuracy: float = Form(..., description="GPS accuracy in meters"),
    timestamp: datetime = Form(..., description="Client capture ISO timestamp"),
    categoryId: str = Form(..., description="Task category slug"),
    taskId: str = Form(..., description="Task UUID or ID"),
    note: Optional[str] = Form(None, description="Optional citizen note"),
    address: Optional[str] = Form(None, description="Reverse geocoded address"),
    user: User = Depends(require_role("citizen")),
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new live geo-tagged submission for a civic task.
    Requires an authenticated citizen.
    """
    client_ip = request.client.host if request.client else None
    return await create_submission(
        db,
        user=user,
        photo_file=photo,
        lat=lat,
        lng=lng,
        accuracy=accuracy,
        client_timestamp=timestamp,
        category_id=categoryId,
        task_id=taskId,
        note=note,
        address=address,
        ip_address=client_ip,
    )


@router.get("/mine", response_model=PaginatedSubmissions)
async def get_my_submissions(
    status_filter: Optional[SubmissionStatusEnum] = Query(None, alias="status", description="Filter by review status"),
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(20, ge=1, le=100, description="Items per page"),
    user: User = Depends(require_role("citizen")),
    db: AsyncSession = Depends(get_db),
):
    """
    Fetch all submissions created by the authenticated citizen.
    """
    items, meta = await list_my_submissions(
        db,
        user=user,
        status_filter=status_filter,
        page=page,
        limit=limit,
    )
    return PaginatedSubmissions(items=items, meta=meta)


@router.get("/{submissionId}", response_model=SubmissionDetail)
async def get_submission(
    submissionId: str,
    user: User = Depends(require_role("citizen", "reviewer", "admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    Get detailed information about a submission including timeline and status.
    """
    return await get_submission_by_id(db, submission_id=submissionId, user=user)


@router.get("/{submissionId}/photo")
async def get_submission_photo(
    submissionId: str,
    user: User = Depends(require_role("citizen", "reviewer", "admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    Download or stream the raw photo file for a submission.
    """
    file_path, media_type = await get_submission_photo_path(
        db,
        submission_id=submissionId,
        user=user,
    )
    return FileResponse(path=str(file_path), media_type=media_type)


@router.post("/{submissionId}/resubmit", response_model=SubmissionDetail)
async def post_resubmit(
    request: Request,
    submissionId: str,
    photo: UploadFile = File(...),
    lat: float = Form(..., description="Updated latitude coordinate"),
    lng: float = Form(..., description="Updated longitude coordinate"),
    accuracy: float = Form(..., description="GPS accuracy in meters"),
    timestamp: datetime = Form(..., description="Client capture ISO timestamp"),
    note: Optional[str] = Form(None, description="Updated notes"),
    user: User = Depends(require_role("citizen")),
    db: AsyncSession = Depends(get_db),
):
    """
    Resubmit a rejected submission with a new photo and updated location.
    Only allowed if current submission status is rejected.
    """
    client_ip = request.client.host if request.client else None
    return await resubmit_submission(
        db,
        user=user,
        submission_id=submissionId,
        photo_file=photo,
        lat=lat,
        lng=lng,
        accuracy=accuracy,
        client_timestamp=timestamp,
        note=note,
        ip_address=client_ip,
    )
