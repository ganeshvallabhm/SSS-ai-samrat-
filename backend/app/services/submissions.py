from __future__ import annotations

import hashlib
import math
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, List, Optional, Tuple
from uuid import UUID

from fastapi import HTTPException, UploadFile, status
from geoalchemy2.functions import ST_Distance, ST_MakePoint, ST_SetSRID, ST_X, ST_Y
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.models.auth import User
from app.models.submissions import Submission, SubmissionEvent, SubmissionStatus
from app.models.tasks import Task, TaskCategorySlug, TaskStatus
from app.schemas.submissions import (
    PaginationMeta,
    StatusTimelineEvent,
    SubmissionDetail,
    SubmissionStatusEnum,
)
from app.schemas.tasks import TaskOut
from app.services.audit import write_audit
from app.services.tasks import task_to_schema

ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_PHOTO_BYTES = 10 * 1024 * 1024  # 10MB


def haversine_distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000.0  # Earth radius in meters
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    return 2.0 * R * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))


async def validate_and_save_photo(file: UploadFile) -> Tuple[str, str]:
    """
    Validate MIME type, file size <= 10MB, calculate SHA-256,
    and save under settings.UPLOAD_DIR.
    Returns (filename, sha256_hex).
    """
    if file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "invalid_file_type", "message": f"Unsupported MIME type: {file.content_type}. Allowed: image/jpeg, image/png, image/webp"},
        )

    content = await file.read()
    if len(content) > MAX_PHOTO_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "file_too_large", "message": f"File size {len(content)} bytes exceeds 10MB limit"},
        )
    if len(content) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "empty_file", "message": "Uploaded photo file is empty"},
        )

    sha256 = hashlib.sha256(content).hexdigest()

    ext_map = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
    }
    ext = ext_map.get(file.content_type, ".jpg")
    filename = f"{uuid.uuid4().hex}{ext}"

    upload_dir = Path(settings.UPLOAD_DIR)
    upload_dir.mkdir(parents=True, exist_ok=True)
    file_path = upload_dir / filename

    with open(file_path, "wb") as f:
        f.write(content)

    return filename, sha256


async def submission_to_detail(db: AsyncSession, sub: Submission) -> SubmissionDetail:
    from geoalchemy2.shape import to_shape

    if sub.location is not None:
        shape_pt = to_shape(sub.location)
        lng = float(shape_pt.x)
        lat = float(shape_pt.y)
    else:
        lat, lng = 0.0, 0.0

    # Query events
    events_stmt = (
        select(SubmissionEvent)
        .where(SubmissionEvent.submission_id == sub.id)
        .order_by(SubmissionEvent.created_at.asc())
    )
    events = (await db.execute(events_stmt)).scalars().all()

    timeline = [
        StatusTimelineEvent(
            status=SubmissionStatusEnum(e.status.value if hasattr(e.status, "value") else str(e.status)),
            timestamp=e.created_at,
            actor=e.actor_label,
            note=e.reason or e.internal_notes,
        )
        for e in events
    ]

    # Task details
    task_out: Optional[TaskOut] = None
    if sub.task_id:
        task_stmt = select(Task).where(Task.id == sub.task_id)
        task_obj = (await db.execute(task_stmt)).scalar_one_or_none()
        if task_obj:
            task_out = task_to_schema(task_obj, 0.0)

    # Rejection reason from latest rejection event if rejected
    reason = None
    reviewed_at = None
    for e in reversed(events):
        if e.status == SubmissionStatus.rejected:
            reason = e.reason
            reviewed_at = e.created_at
            break
        elif e.status == SubmissionStatus.approved:
            reviewed_at = e.created_at
            break

    photo_url = f"/api/v1/submissions/{sub.id}/photo"

    raw_status = sub.status.value if hasattr(sub.status, "value") else str(sub.status)
    # The API contract exposes: under_review, approved, rejected
    if raw_status in ("draft", "queued_offline", "submitted"):
        status_enum = SubmissionStatusEnum.under_review
    else:
        status_enum = SubmissionStatusEnum(raw_status)

    return SubmissionDetail(
        id=str(sub.id),
        taskId=str(sub.task_id),
        status=status_enum,
        submittedAt=sub.created_at,
        reviewedAt=reviewed_at,
        reason=reason,
        photoUrl=photo_url,
        lat=lat,
        lng=lng,
        accuracy=float(sub.accuracy_m),
        note=sub.note,
        address=sub.area_name,
        timeline=timeline,
        task=task_out,
    )


async def create_submission(
    db: AsyncSession,
    *,
    user: User,
    photo_file: UploadFile,
    lat: float,
    lng: float,
    accuracy: float,
    client_timestamp: datetime,
    category_id: str,
    task_id: str,
    note: Optional[str] = None,
    address: Optional[str] = None,
    ip_address: Optional[str] = None,
) -> SubmissionDetail:
    now = datetime.now(timezone.utc)

    # 1. Validate GPS Accuracy (R-010)
    if accuracy <= 0 or accuracy > 50.0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error": "accuracy_exceeded", "message": f"Accuracy {accuracy}m exceeds 50m limit or is non-positive"},
        )

    # 2. Validate timestamp skew <= 600s (R-011)
    if client_timestamp.tzinfo is None:
        client_timestamp = client_timestamp.replace(tzinfo=timezone.utc)
    skew_seconds = abs((now - client_timestamp).total_seconds())
    if skew_seconds > 600:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error": "timestamp_skew", "message": f"Photo capture timestamp is skewed by {skew_seconds:.1f}s (max 600s)"},
        )

    # 3. Task verification
    try:
        t_uuid = UUID(str(task_id))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "not_found", "message": f"Task {task_id} not found"},
        )

    task_res = await db.execute(select(Task).where(Task.id == t_uuid, Task.status == TaskStatus.active))
    task = task_res.scalar_one_or_none()
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "not_found", "message": f"Task {task_id} not found or not active"},
        )

    # Verify category
    task_cat = task.category_id.value if hasattr(task.category_id, "value") else str(task.category_id)
    if category_id != task_cat:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "category_mismatch", "message": f"Category {category_id} does not match task category {task_cat}"},
        )

    # 4. Geofence verification
    user_location = ST_SetSRID(ST_MakePoint(lng, lat), 4326)
    if task.required_location is not None and task.geofence_radius_m is not None:
        from geoalchemy2.shape import to_shape
        req_pt = to_shape(task.required_location)
        dist_m = haversine_distance_m(lat, lng, float(req_pt.y), float(req_pt.x))
        if dist_m > task.geofence_radius_m:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"error": "outside_geofence", "message": f"Submission location is {dist_m:.1f}m away, outside geofence of {task.geofence_radius_m}m"},
            )

    # 5. Rate Limiting: max 10 per 24 hours, max 5 per rolling hour (R-016)
    rolling_24h = now - timedelta(hours=24)
    rolling_1h = now - timedelta(hours=1)

    count_24h_stmt = select(func.count(Submission.id)).where(
        Submission.user_id == user.id,
        Submission.created_at >= rolling_24h,
    )
    count_24h = (await db.execute(count_24h_stmt)).scalar() or 0
    if count_24h >= 10:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"error": "rate_limit_exceeded", "message": "Max 10 submissions per rolling 24 hours reached"},
        )

    count_1h_stmt = select(func.count(Submission.id)).where(
        Submission.user_id == user.id,
        Submission.created_at >= rolling_1h,
    )
    count_1h = (await db.execute(count_1h_stmt)).scalar() or 0
    if count_1h >= 5:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"error": "rate_limit_exceeded", "message": "Max 5 submissions per rolling hour reached"},
        )

    # 6. Duplicate Submission Check: same user + same task within 1 hour = reject (400/409)
    dup_task_stmt = select(func.count(Submission.id)).where(
        Submission.user_id == user.id,
        Submission.task_id == task.id,
        Submission.created_at >= rolling_1h,
        Submission.status != SubmissionStatus.rejected,
    )
    dup_task_count = (await db.execute(dup_task_stmt)).scalar() or 0
    if dup_task_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "duplicate_submission", "message": "You have already submitted this task within the last hour"},
        )

    # 7. Photo validation and saving
    photo_filename, photo_sha = await validate_and_save_photo(photo_file)

    # 8. Fraud Flags Detection
    fraud_flags: List[dict[str, Any]] = []

    # A. Exact photo hash check (R-013)
    dup_photo_stmt = select(func.count(Submission.id)).where(
        Submission.user_id == user.id,
        Submission.photo_sha256 == photo_sha,
        Submission.status != SubmissionStatus.rejected,
    )
    dup_photo_count = (await db.execute(dup_photo_stmt)).scalar() or 0
    if dup_photo_count > 0:
        fraud_flags.append({
            "code": "DUPLICATE_HASH",
            "duplicate_photo": True,
            "auto_hold": True,
            "flagged_at": now.isoformat(),
        })

    # B. Speed run check (< 30s from task creation or previous submission)
    is_speed_run = False
    if task.created_at and (now - task.created_at).total_seconds() < 30:
        is_speed_run = True
    else:
        last_sub_stmt = (
            select(Submission.created_at)
            .where(Submission.user_id == user.id)
            .order_by(Submission.created_at.desc())
            .limit(1)
        )
        last_created_at = (await db.execute(last_sub_stmt)).scalar_one_or_none()
        if last_created_at and (now - last_created_at).total_seconds() < 30:
            is_speed_run = True

    if is_speed_run:
        fraud_flags.append({
            "code": "speed_run",
            "auto_hold": True,
            "flagged_at": now.isoformat(),
        })

    # 9. Create submission record
    sub = Submission(
        user_id=user.id,
        task_id=task.id,
        category_id=task.category_id,
        status=SubmissionStatus.under_review,
        photo_url=photo_filename,
        photo_sha256=photo_sha,
        location=user_location,
        accuracy_m=accuracy,
        captured_at=client_timestamp,
        received_at=now,
        area_name=address or task.location_label or "Hyderabad",
        note=note,
        fraud_flags=fraud_flags,
    )
    db.add(sub)
    await db.flush()

    # 10. Status timeline event
    event = SubmissionEvent(
        submission_id=sub.id,
        status=SubmissionStatus.under_review,
        actor_id=user.id,
        actor_label="Citizen / Intake",
        internal_notes="Initial submission received and queued for review",
    )
    db.add(event)

    # 11. Write audit logs
    await write_audit(
        db,
        action="submission_created",
        entity="submission",
        entity_id=sub.id,
        actor_id=user.id,
        details={"task_id": str(task.id), "category": str(task.category_id), "fraud_flags_count": len(fraud_flags)},
        ip_address=ip_address,
    )

    for flag in fraud_flags:
        await write_audit(
            db,
            action="submission.fraud_flag",
            entity="submission",
            entity_id=sub.id,
            actor_id=user.id,
            details=flag,
            ip_address=ip_address,
        )

    await db.commit()
    await db.refresh(sub)

    return await submission_to_detail(db, sub)


async def resubmit_submission(
    db: AsyncSession,
    *,
    user: User,
    submission_id: str,
    photo_file: UploadFile,
    lat: float,
    lng: float,
    accuracy: float,
    client_timestamp: datetime,
    note: Optional[str] = None,
    ip_address: Optional[str] = None,
) -> SubmissionDetail:
    now = datetime.now(timezone.utc)

    try:
        s_uuid = UUID(str(submission_id))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "not_found", "message": f"Submission {submission_id} not found"},
        )

    orig_stmt = select(Submission).where(Submission.id == s_uuid)
    original = (await db.execute(orig_stmt)).scalar_one_or_none()
    if not original:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "not_found", "message": f"Submission {submission_id} not found"},
        )

    if original.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "forbidden", "message": "You cannot resubmit another user's submission"},
        )

    if original.status != SubmissionStatus.rejected:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "conflict", "message": f"Submission status is {original.status.value}; only rejected submissions can be resubmitted"},
        )

    # Validate accuracy
    if accuracy <= 0 or accuracy > 50.0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error": "accuracy_exceeded", "message": f"Accuracy {accuracy}m exceeds 50m limit"},
        )

    # Validate skew
    if client_timestamp.tzinfo is None:
        client_timestamp = client_timestamp.replace(tzinfo=timezone.utc)
    skew = abs((now - client_timestamp).total_seconds())
    if skew > 600:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error": "timestamp_skew", "message": "Photo timestamp skew exceeds 10 minutes"},
        )

    # Verify geofence against original task
    task_res = await db.execute(select(Task).where(Task.id == original.task_id))
    task = task_res.scalar_one_or_none()
    user_location = ST_SetSRID(ST_MakePoint(lng, lat), 4326)
    if task and task.required_location is not None and task.geofence_radius_m is not None:
        from geoalchemy2.shape import to_shape
        req_pt = to_shape(task.required_location)
        dist_m = haversine_distance_m(lat, lng, float(req_pt.y), float(req_pt.x))
        if dist_m > task.geofence_radius_m:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"error": "outside_geofence", "message": "Submission is outside the task geofence"},
            )

    photo_filename, photo_sha = await validate_and_save_photo(photo_file)

    # R-023: Null original idempotency key so it is not reused
    await db.execute(
        update(Submission)
        .where(Submission.id == original.id)
        .values(idempotency_key=None)
    )

    new_sub = Submission(
        user_id=user.id,
        task_id=original.task_id,
        category_id=original.category_id,
        status=SubmissionStatus.under_review,
        photo_url=photo_filename,
        photo_sha256=photo_sha,
        location=user_location,
        accuracy_m=accuracy,
        captured_at=client_timestamp,
        received_at=now,
        area_name=original.area_name,
        note=note or original.note,
        resubmission_of=original.id,
        fraud_flags=[],
    )
    db.add(new_sub)
    await db.flush()

    event = SubmissionEvent(
        submission_id=new_sub.id,
        status=SubmissionStatus.under_review,
        actor_id=user.id,
        actor_label="Citizen / Resubmission",
        internal_notes=f"Resubmitted from rejected submission {original.id}",
    )
    db.add(event)

    await write_audit(
        db,
        action="submission_resubmitted",
        entity="submission",
        entity_id=new_sub.id,
        actor_id=user.id,
        details={"original_submission_id": str(original.id), "task_id": str(original.task_id)},
        ip_address=ip_address,
    )

    await db.commit()
    await db.refresh(new_sub)

    return await submission_to_detail(db, new_sub)


async def list_my_submissions(
    db: AsyncSession,
    *,
    user: User,
    status_filter: Optional[SubmissionStatusEnum] = None,
    page: int = 1,
    limit: int = 20,
) -> Tuple[List[SubmissionDetail], PaginationMeta]:
    stmt = select(Submission).where(Submission.user_id == user.id)

    if status_filter:
        db_status = SubmissionStatus(status_filter.value)
        stmt = stmt.where(Submission.status == db_status)

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total_count = (await db.execute(count_stmt)).scalar() or 0

    offset = (page - 1) * limit
    stmt = stmt.order_by(Submission.created_at.desc()).offset(offset).limit(limit)

    subs = (await db.execute(stmt)).scalars().all()

    items: List[SubmissionDetail] = []
    for sub in subs:
        items.append(await submission_to_detail(db, sub))

    total_pages = math.ceil(total_count / limit) if total_count > 0 else 1
    has_next_page = page < total_pages

    meta = PaginationMeta(
        page=page,
        limit=limit,
        totalItems=total_count,
        totalPages=total_pages,
        hasNextPage=has_next_page,
    )
    return items, meta


async def get_submission_by_id(
    db: AsyncSession,
    *,
    submission_id: str,
    user: User,
) -> SubmissionDetail:
    try:
        s_uuid = UUID(str(submission_id))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "not_found", "message": f"Submission {submission_id} not found"},
        )

    stmt = select(Submission).where(Submission.id == s_uuid)
    sub = (await db.execute(stmt)).scalar_one_or_none()
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "not_found", "message": f"Submission {submission_id} not found"},
        )

    # Ensure citizen owns the submission
    user_role_str = user.role.value if hasattr(user.role, "value") else str(user.role)
    if user_role_str == "citizen" and sub.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "not_found", "message": f"Submission {submission_id} not found"},
        )

    return await submission_to_detail(db, sub)


async def get_submission_photo_path(
    db: AsyncSession,
    *,
    submission_id: str,
    user: User,
) -> Tuple[Path, str]:
    try:
        s_uuid = UUID(str(submission_id))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "not_found", "message": "Submission not found"},
        )

    stmt = select(Submission).where(Submission.id == s_uuid)
    sub = (await db.execute(stmt)).scalar_one_or_none()
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "not_found", "message": "Submission not found"},
        )

    user_role_str = user.role.value if hasattr(user.role, "value") else str(user.role)
    if user_role_str == "citizen" and sub.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "forbidden", "message": "Access denied to photo"},
        )

    if not sub.photo_url:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "photo_not_found", "message": "No photo stored for this submission"},
        )

    file_path = Path(settings.UPLOAD_DIR) / sub.photo_url
    if not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "file_missing", "message": "Photo file missing from storage"},
        )

    media_type = "image/jpeg"
    if sub.photo_url.endswith(".png"):
        media_type = "image/png"
    elif sub.photo_url.endswith(".webp"):
        media_type = "image/webp"

    return file_path, media_type
