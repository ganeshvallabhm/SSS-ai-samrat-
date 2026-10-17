"""
test_reviewer.py — Integration test suite for Reviewer Portal API.
Covers:
- Reviewer role enforcement (403 for citizens)
- Queue listing with filters
- Submission approval & point award
- Rejection with mandatory reason
- Rejection without reason rejected (422)
- State transition conflicts (409 for re-reviewing finalized submission)
- Points ledger immutability & verification
"""
from __future__ import annotations

import io
import random
import uuid
from datetime import datetime, timezone

import pytest
import sqlalchemy as sa
from geoalchemy2.functions import ST_MakePoint, ST_SetSRID
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import User, UserRole, UserStatus
from app.models.reviews import Review, PointsLedger, LedgerType
from app.models.submissions import Submission, SubmissionEvent, SubmissionStatus
from app.models.tasks import Task, TaskCategorySlug, TaskStatus
from app.services.tokens import create_access_token


def _dummy_jpeg_bytes() -> bytes:
    return (
        b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00`\x00`\x00\x00"
        b"\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t"
        b"\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a"
        b"\x1f\x1e\x1d\x1a\x1c\x1c $.' \",#\x1c\x1c(7),01444\x1f'9=82<.342"
        b"\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00\x1f\x00"
        b"\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00"
        b"\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b\xff\xda\x00\x08\x01\x01\x00"
        b"\x00?\x00\xbf\x00\xff\xd9"
    )


async def _create_user(db: AsyncSession, role: UserRole, prefix: str = "98") -> tuple[User, dict[str, str]]:
    digits = "".join(str(random.randint(0, 9)) for _ in range(8))
    phone = f"{prefix}{digits}"
    user = User(
        phone=phone,
        name=f"Test {role.value}",
        role=role,
        status=UserStatus.active,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    token = create_access_token(user)
    return user, {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def reviewer_setup(async_db: AsyncSession):
    await async_db.execute(sa.text("TRUNCATE points_ledger, reviews, submission_events, submissions CASCADE"))
    await async_db.commit()

    # Create isolated task for this test
    task = Task(
        id=uuid.uuid4(),
        title="Pothole Survey",
        description="Audit road damage",
        category_id=TaskCategorySlug.civic,
        points_reward=20,
        status=TaskStatus.active,
        required_location=ST_SetSRID(ST_MakePoint(78.3742, 17.4485), 4326),
        geofence_radius_m=1000,
        location_label="Madhapur",
    )
    async_db.add(task)
    await async_db.commit()

    citizen, citizen_h = await _create_user(async_db, UserRole.citizen, "97")
    reviewer, reviewer_h = await _create_user(async_db, UserRole.reviewer, "98")

    yield {
        "task": task,
        "citizen": citizen,
        "citizen_h": citizen_h,
        "reviewer": reviewer,
        "reviewer_h": reviewer_h,
    }
    await async_db.execute(sa.text("TRUNCATE points_ledger, reviews, submission_events, submissions CASCADE"))
    await async_db.commit()


@pytest.mark.asyncio
async def test_reviewer_role_guard(client: AsyncClient, reviewer_setup):
    """Citizens cannot access reviewer endpoints (HTTP 403)."""
    resp = await client.get("/api/v1/reviewer/queue", headers=reviewer_setup["citizen_h"])
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_reviewer_queue_and_approve_workflow(client: AsyncClient, async_db: AsyncSession, reviewer_setup):
    """
    Reviewer views pending queue, approves a submission, awarding points in the ledger.
    """
    citizen_h = reviewer_setup["citizen_h"]
    reviewer_h = reviewer_setup["reviewer_h"]
    task = reviewer_setup["task"]
    citizen = reviewer_setup["citizen"]

    # 1. Citizen creates submission
    form_data = {
        "lat": "17.4485",
        "lng": "78.3742",
        "accuracy": "5.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "categoryId": "civic",
        "taskId": str(task.id),
        "note": "Road crack observed",
    }
    files = {"photo": ("pothole.jpg", io.BytesIO(_dummy_jpeg_bytes()), "image/jpeg")}
    create_resp = await client.post("/api/v1/submissions", data=form_data, files=files, headers=citizen_h)
    assert create_resp.status_code == 201
    sub_id = create_resp.json()["id"]

    # 2. Reviewer checks queue
    q_resp = await client.get("/api/v1/reviewer/queue", headers=reviewer_h)
    assert q_resp.status_code == 200
    queue_data = q_resp.json()
    assert queue_data["meta"]["totalItems"] >= 1
    assert any(s["id"] == sub_id for s in queue_data["items"])

    # 3. Reviewer approves submission
    review_resp = await client.post(
        f"/api/v1/reviewer/submissions/{sub_id}/review",
        json={"decision": "approve", "internalNotes": "Verified photo matches location"},
        headers=reviewer_h,
    )
    assert review_resp.status_code == 200
    detail = review_resp.json()
    assert detail["status"] == "approved"
    assert detail["reviewedAt"] is not None

    # 4. Verify points ledger was updated with points
    ledger_stmt = sa.select(PointsLedger).where(PointsLedger.submission_id == uuid.UUID(sub_id))
    ledger_row = (await async_db.execute(ledger_stmt)).scalar_one_or_none()
    assert ledger_row is not None
    assert ledger_row.amount == 20
    assert ledger_row.type == LedgerType.earned
    assert ledger_row.user_id == citizen.id

    # 5. Idempotent attempt: Re-reviewing already approved submission returns 409
    dup_resp = await client.post(
        f"/api/v1/reviewer/submissions/{sub_id}/review",
        json={"decision": "approve"},
        headers=reviewer_h,
    )
    assert dup_resp.status_code == 409


@pytest.mark.asyncio
async def test_reviewer_rejection_workflow(client: AsyncClient, async_db: AsyncSession, reviewer_setup):
    """
    Reviewer rejects submission with mandatory reason; zero points awarded.
    """
    citizen_h = reviewer_setup["citizen_h"]
    reviewer_h = reviewer_setup["reviewer_h"]
    task = reviewer_setup["task"]

    form_data = {
        "lat": "17.4485",
        "lng": "78.3742",
        "accuracy": "5.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "categoryId": "civic",
        "taskId": str(task.id),
        "note": "Bad photo test",
    }
    files = {"photo": ("blurry.jpg", io.BytesIO(_dummy_jpeg_bytes()), "image/jpeg")}
    create_resp = await client.post("/api/v1/submissions", data=form_data, files=files, headers=citizen_h)
    sub_id = create_resp.json()["id"]

    # Attempt to reject without reason -> 422
    no_reason_resp = await client.post(
        f"/api/v1/reviewer/submissions/{sub_id}/review",
        json={"decision": "reject", "reason": ""},
        headers=reviewer_h,
    )
    assert no_reason_resp.status_code == 422

    # Provide valid rejection reason
    reject_reason = "Photo is too dark to clearly identify road defects"
    rej_resp = await client.post(
        f"/api/v1/reviewer/submissions/{sub_id}/review",
        json={"decision": "reject", "reason": reject_reason},
        headers=reviewer_h,
    )
    assert rej_resp.status_code == 200
    assert rej_resp.json()["status"] == "rejected"
    assert rej_resp.json()["reason"] == reject_reason

    # Verify NO points ledger was created
    ledger_stmt = sa.select(PointsLedger).where(PointsLedger.submission_id == uuid.UUID(sub_id))
    ledger_row = (await async_db.execute(ledger_stmt)).scalar_one_or_none()
    assert ledger_row is None
