from __future__ import annotations

import math
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_role
from app.db import get_db
from app.models.auth import User
from app.models.reviews import Review, PointsLedger, LedgerType
from app.models.submissions import Submission, SubmissionEvent, SubmissionStatus
from app.models.tasks import Task, TaskCategorySlug
from app.schemas.reviewer import ReviewActionRequest, ReviewDecision
from app.schemas.submissions import (
    PaginatedSubmissions,
    PaginationMeta,
    SubmissionDetail,
    SubmissionStatusEnum,
)
from app.services.audit import write_audit
from app.services.submissions import submission_to_detail

router = APIRouter(prefix="/reviewer", tags=["Reviewer"])

CATEGORY_DEFAULT_POINTS: dict[str, int] = {
    "civic": 20,
    "green": 40,
    "health": 50,
    "governance": 10,
}


@router.get("/queue", response_model=PaginatedSubmissions)
async def get_review_queue(
    status_filter: Optional[SubmissionStatusEnum] = Query(SubmissionStatusEnum.under_review, alias="status", description="Filter by status"),
    category: Optional[TaskCategorySlug] = Query(None, description="Filter by category"),
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(25, ge=1, le=100, description="Items per page"),
    user: User = Depends(require_role("reviewer", "admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    List submissions in verification queue. Reviewer / Admin only.
    """
    stmt = select(Submission)
    if status_filter:
        db_status = SubmissionStatus(status_filter.value)
        stmt = stmt.where(Submission.status == db_status)
    if category:
        stmt = stmt.where(Submission.category_id == category)

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total_count = (await db.execute(count_stmt)).scalar() or 0

    offset = (page - 1) * limit
    stmt = stmt.order_by(Submission.created_at.asc()).offset(offset).limit(limit)
    subs = (await db.execute(stmt)).scalars().all()

    items = [await submission_to_detail(db, s) for s in subs]
    total_pages = math.ceil(total_count / limit) if total_count > 0 else 1
    has_next_page = page < total_pages

    meta = PaginationMeta(
        page=page,
        limit=limit,
        totalItems=total_count,
        totalPages=total_pages,
        hasNextPage=has_next_page,
    )
    return PaginatedSubmissions(items=items, meta=meta)


@router.get("/submissions/{submissionId}", response_model=SubmissionDetail)
async def get_review_submission(
    submissionId: str,
    user: User = Depends(require_role("reviewer", "admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    Fetch comprehensive submission details for review.
    """
    try:
        s_uuid = UUID(str(submissionId))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "not_found", "message": f"Submission {submissionId} not found"},
        )
    stmt = select(Submission).where(Submission.id == s_uuid)
    sub = (await db.execute(stmt)).scalar_one_or_none()
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "not_found", "message": f"Submission {submissionId} not found"},
        )
    return await submission_to_detail(db, sub)


@router.post("/submissions/{submissionId}/review", response_model=SubmissionDetail)
async def post_review_submission(
    request: Request,
    submissionId: str,
    body: ReviewActionRequest,
    user: User = Depends(require_role("reviewer", "admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    Approve or reject a submission. Reviewer / Admin only.
    - If approved: marks approved, creates Review, awards points in points_ledger.
    - If rejected: requires reason, marks rejected, creates Review.
    Enforces valid state transitions and idempotent review.
    """
    try:
        s_uuid = UUID(str(submissionId))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "not_found", "message": f"Submission {submissionId} not found"},
        )

    stmt = select(Submission).where(Submission.id == s_uuid).with_for_update()
    sub = (await db.execute(stmt)).scalar_one_or_none()
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "not_found", "message": f"Submission {submissionId} not found"},
        )

    # Valid status transitions
    if sub.status in (SubmissionStatus.approved, SubmissionStatus.rejected):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "already_reviewed",
                "message": f"Submission is already {sub.status.value}; cannot re-review.",
            },
        )

    client_ip = request.client.host if request.client else None
    task_stmt = select(Task).where(Task.id == sub.task_id)
    task = (await db.execute(task_stmt)).scalar_one_or_none()
    category_slug = sub.category_id.value if hasattr(sub.category_id, "value") else str(sub.category_id)

    if body.decision == ReviewDecision.reject:
        reason = body.reason.strip() if body.reason else ""
        if not reason:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"error": "missing_reason", "message": "Rejection reason is required"},
            )

        sub.status = SubmissionStatus.rejected
        event = SubmissionEvent(
            submission_id=sub.id,
            status=SubmissionStatus.rejected,
            actor_id=user.id,
            actor_label=f"Reviewer ({user.name or 'Ward Verifier'})",
            reason=reason,
            internal_notes=body.internalNotes,
        )
        db.add(event)

        review = Review(
            submission_id=sub.id,
            reviewer_id=user.id,
            decision="reject",
            reason=reason,
            internal_notes=body.internalNotes,
            awarded_points=0,
        )
        db.add(review)

        await write_audit(
            db,
            action="submission_rejected",
            entity="submissions",
            entity_id=sub.id,
            actor_id=user.id,
            details={"reason": reason, "internal_notes": body.internalNotes},
            ip_address=client_ip,
        )

    elif body.decision == ReviewDecision.approve:
        default_pts = task.points_reward if task else CATEGORY_DEFAULT_POINTS.get(category_slug, 20)
        base_points = body.points if body.points is not None else default_pts

        # Enforce monthly earning cap of 500 points (computed in Asia/Kolkata timezone)
        MONTHLY_CAP = 500
        month_stmt = select(func.coalesce(func.sum(PointsLedger.amount), 0)).where(
            PointsLedger.user_id == sub.user_id,
            PointsLedger.type == LedgerType.earned,
            func.date_trunc('month', func.timezone('Asia/Kolkata', PointsLedger.created_at)) ==
            func.date_trunc('month', func.timezone('Asia/Kolkata', func.now())),
        )
        already_earned = (await db.execute(month_stmt)).scalar() or 0
        remaining_monthly = max(0, MONTHLY_CAP - already_earned)
        points_to_award = min(base_points, remaining_monthly)

        sub.status = SubmissionStatus.approved
        event = SubmissionEvent(
            submission_id=sub.id,
            status=SubmissionStatus.approved,
            actor_id=user.id,
            actor_label=f"Reviewer ({user.name or 'Ward Verifier'})",
            internal_notes=body.internalNotes,
        )
        db.add(event)

        review = Review(
            submission_id=sub.id,
            reviewer_id=user.id,
            decision="approve",
            internal_notes=body.internalNotes,
            awarded_points=points_to_award,
        )
        db.add(review)

        # Record points ledger transaction only if points > 0 (points_ledger constraint: amount <> 0)
        if points_to_award > 0:
            ledger_entry = PointsLedger(
                user_id=sub.user_id,
                amount=points_to_award,
                type=LedgerType.earned,
                submission_id=sub.id,
                description=f"Reward for verified task: {task.title if task else 'Civic Action'}",
            )
            db.add(ledger_entry)

        await write_audit(
            db,
            action="submission_approved",
            entity="submissions",
            entity_id=sub.id,
            actor_id=user.id,
            details={"awarded_points": points_to_award, "internal_notes": body.internalNotes},
            ip_address=client_ip,
        )

    await db.commit()
    await db.refresh(sub)
    return await submission_to_detail(db, sub)
