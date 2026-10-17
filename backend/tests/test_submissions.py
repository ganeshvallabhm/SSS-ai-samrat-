"""
test_submissions.py — Comprehensive test suite for citizen submissions.
Covers: creation, listing, details, photo download, geofence, accuracy,
timestamp skew, rate limits, duplicate checks, fraud flags, resubmission,
and audit logging.
"""
from __future__ import annotations

import io
import random
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
import sqlalchemy as sa
from geoalchemy2.functions import ST_MakePoint, ST_SetSRID
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import AuditLog, User, UserRole, UserStatus
from app.models.submissions import Submission, SubmissionEvent, SubmissionStatus
from app.models.tasks import Task, TaskCategorySlug, TaskStatus
from app.services.tokens import create_access_token


def _dummy_jpeg_bytes() -> bytes:
    """Return a minimal valid 1x1 JPEG byte stream."""
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


async def _create_citizen(db: AsyncSession, name: str = "Test Citizen") -> tuple[User, dict[str, str]]:
    digits = "".join(str(random.randint(0, 9)) for _ in range(8))
    phone = f"99{digits}"
    user = User(
        phone=phone,
        name=name,
        role=UserRole.citizen,
        status=UserStatus.active,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    token = create_access_token(user)
    return user, {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def setup_data(async_db: AsyncSession):
    """Clean tables and seed active tasks."""
    await async_db.execute(sa.delete(SubmissionEvent))
    await async_db.execute(sa.delete(Submission))
    await async_db.execute(sa.delete(Task))
    await async_db.execute(sa.delete(AuditLog))
    await async_db.commit()

    # Kondapur: 17.4682° N, 78.3618° E
    task = Task(
        title="Kondapur Tree Plantation",
        description="Plant trees around the lake",
        category_id=TaskCategorySlug.green,
        points_reward=40,
        required_location=ST_SetSRID(ST_MakePoint(78.3618, 17.4682), 4326),
        geofence_radius_m=200,
        location_label="Kondapur Lake",
        status=TaskStatus.active,
        created_at=datetime.now(timezone.utc) - timedelta(minutes=5),  # not a speed run
    )
    async_db.add(task)
    await async_db.commit()
    await async_db.refresh(task)

    citizen, headers = await _create_citizen(async_db)
    return {"task": task, "citizen": citizen, "headers": headers}


@pytest.mark.asyncio
async def test_submissions_unauthorized(client: AsyncClient, setup_data: dict):
    """POST /submissions requires citizen auth."""
    resp = await client.post("/api/v1/submissions")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_create_submission_success(client: AsyncClient, async_db: AsyncSession, setup_data: dict):
    """Happy path: valid photo, inside geofence, good accuracy, within timestamp window."""
    task = setup_data["task"]
    headers = setup_data["headers"]
    citizen = setup_data["citizen"]

    photo_bytes = _dummy_jpeg_bytes()
    now_iso = datetime.now(timezone.utc).isoformat()

    files = {"photo": ("photo.jpg", photo_bytes, "image/jpeg")}
    data = {
        "lat": "17.4682",
        "lng": "78.3618",
        "accuracy": "10.5",
        "timestamp": now_iso,
        "categoryId": "green",
        "taskId": str(task.id),
        "note": "Planted a neem sapling",
        "address": "Kondapur Lake Road",
    }

    resp = await client.post("/api/v1/submissions", data=data, files=files, headers=headers)
    assert resp.status_code == 201, resp.text
    sub = resp.json()

    assert sub["taskId"] == str(task.id)
    assert sub["status"] == "under_review"
    assert sub["note"] == "Planted a neem sapling"
    assert sub["accuracy"] == 10.5
    assert len(sub["timeline"]) == 1
    assert sub["timeline"][0]["status"] == "under_review"

    # Verify audit log was written
    audit_res = await async_db.execute(
        sa.select(AuditLog).where(AuditLog.entity_id == uuid.UUID(sub["id"]))
    )
    audit_row = audit_res.scalar_one_or_none()
    assert audit_row is not None
    assert audit_row.action == "submission_created"
    assert audit_row.actor_id == citizen.id


@pytest.mark.asyncio
async def test_get_my_submissions(client: AsyncClient, setup_data: dict):
    """GET /submissions/mine returns submissions made by authenticated user."""
    task = setup_data["task"]
    headers = setup_data["headers"]

    # Submit 1
    files = {"photo": ("photo.jpg", _dummy_jpeg_bytes(), "image/jpeg")}
    data = {
        "lat": "17.4682",
        "lng": "78.3618",
        "accuracy": "12.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "categoryId": "green",
        "taskId": str(task.id),
    }
    await client.post("/api/v1/submissions", data=data, files=files, headers=headers)

    resp = await client.get("/api/v1/submissions/mine", headers=headers)
    assert resp.status_code == 200
    res = resp.json()
    assert len(res["items"]) >= 1
    assert res["meta"]["totalItems"] >= 1
    assert res["items"][0]["taskId"] == str(task.id)


@pytest.mark.asyncio
async def test_get_submission_by_id(client: AsyncClient, setup_data: dict):
    """GET /submissions/{id} returns complete submission detail."""
    task = setup_data["task"]
    headers = setup_data["headers"]

    files = {"photo": ("photo.jpg", _dummy_jpeg_bytes(), "image/jpeg")}
    data = {
        "lat": "17.4682",
        "lng": "78.3618",
        "accuracy": "15.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "categoryId": "green",
        "taskId": str(task.id),
    }
    create_resp = await client.post("/api/v1/submissions", data=data, files=files, headers=headers)
    sub_id = create_resp.json()["id"]

    resp = await client.get(f"/api/v1/submissions/{sub_id}", headers=headers)
    assert resp.status_code == 200
    detail = resp.json()
    assert detail["id"] == sub_id
    assert detail["status"] == "under_review"
    assert detail["task"]["id"] == str(task.id)


@pytest.mark.asyncio
async def test_download_submission_photo(client: AsyncClient, async_db: AsyncSession, setup_data: dict):
    """GET /submissions/{id}/photo downloads photo binary."""
    task = setup_data["task"]
    headers = setup_data["headers"]

    photo_bytes = _dummy_jpeg_bytes()
    files = {"photo": ("photo.jpg", photo_bytes, "image/jpeg")}
    data = {
        "lat": "17.4682",
        "lng": "78.3618",
        "accuracy": "10.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "categoryId": "green",
        "taskId": str(task.id),
    }
    create_resp = await client.post("/api/v1/submissions", data=data, files=files, headers=headers)
    sub_id = create_resp.json()["id"]

    resp = await client.get(f"/api/v1/submissions/{sub_id}/photo", headers=headers)
    assert resp.status_code == 200
    assert resp.content == photo_bytes
    assert resp.headers["content-type"] in ("image/jpeg", "image/jpeg; charset=utf-8")

    # Another citizen cannot view someone else's photo
    _, other_headers = await _create_citizen(async_db)
    resp2 = await client.get(f"/api/v1/submissions/{sub_id}/photo", headers=other_headers)
    assert resp2.status_code == 403


@pytest.mark.asyncio
async def test_accuracy_limit(client: AsyncClient, setup_data: dict):
    """Accuracy > 50m must be rejected with 422 per R-010."""
    task = setup_data["task"]
    headers = setup_data["headers"]

    files = {"photo": ("photo.jpg", _dummy_jpeg_bytes(), "image/jpeg")}
    data = {
        "lat": "17.4682",
        "lng": "78.3618",
        "accuracy": "55.0",  # exceeds 50m limit
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "categoryId": "green",
        "taskId": str(task.id),
    }
    resp = await client.post("/api/v1/submissions", data=data, files=files, headers=headers)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_timestamp_skew_limit(client: AsyncClient, setup_data: dict):
    """Timestamp skew > 10m must be rejected with 422 per R-011."""
    task = setup_data["task"]
    headers = setup_data["headers"]

    skewed_time = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()
    files = {"photo": ("photo.jpg", _dummy_jpeg_bytes(), "image/jpeg")}
    data = {
        "lat": "17.4682",
        "lng": "78.3618",
        "accuracy": "10.0",
        "timestamp": skewed_time,
        "categoryId": "green",
        "taskId": str(task.id),
    }
    resp = await client.post("/api/v1/submissions", data=data, files=files, headers=headers)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_outside_geofence_rejected(client: AsyncClient, setup_data: dict):
    """Submission outside task geofence radius must be rejected with 400."""
    task = setup_data["task"]
    headers = setup_data["headers"]

    # Coordinates 5km away from Kondapur (17.4401, 78.3492)
    files = {"photo": ("photo.jpg", _dummy_jpeg_bytes(), "image/jpeg")}
    data = {
        "lat": "17.4401",
        "lng": "78.3492",
        "accuracy": "10.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "categoryId": "green",
        "taskId": str(task.id),
    }
    resp = await client.post("/api/v1/submissions", data=data, files=files, headers=headers)
    assert resp.status_code == 400
    assert "outside" in resp.text.lower() or "geofence" in resp.text.lower()


@pytest.mark.asyncio
async def test_duplicate_submission_within_1_hour(client: AsyncClient, setup_data: dict):
    """Same user submitting for same task within 1 hour must be rejected."""
    task = setup_data["task"]
    headers = setup_data["headers"]

    files1 = {"photo": ("photo1.jpg", _dummy_jpeg_bytes() + b"1", "image/jpeg")}
    data1 = {
        "lat": "17.4682",
        "lng": "78.3618",
        "accuracy": "10.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "categoryId": "green",
        "taskId": str(task.id),
    }
    resp1 = await client.post("/api/v1/submissions", data=data1, files=files1, headers=headers)
    assert resp1.status_code == 201

    # Second submission for same task within 1 hour
    files2 = {"photo": ("photo2.jpg", _dummy_jpeg_bytes() + b"2", "image/jpeg")}
    data2 = {
        "lat": "17.4682",
        "lng": "78.3618",
        "accuracy": "10.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "categoryId": "green",
        "taskId": str(task.id),
    }
    resp2 = await client.post("/api/v1/submissions", data=data2, files=files2, headers=headers)
    assert resp2.status_code in (400, 409)


@pytest.mark.asyncio
async def test_hourly_rate_limit(client: AsyncClient, async_db: AsyncSession, setup_data: dict):
    """More than 5 submissions in rolling 60 minutes returns 429."""
    headers = setup_data["headers"]
    citizen = setup_data["citizen"]

    # Directly insert 5 submissions in the last 15 minutes
    tasks = []
    for i in range(5):
        t = Task(
            title=f"Task {i}",
            category_id=TaskCategorySlug.civic,
            points_reward=20,
            status=TaskStatus.active,
        )
        async_db.add(t)
        tasks.append(t)
    await async_db.commit()

    now = datetime.now(timezone.utc)
    for t in tasks:
        sub = Submission(
            user_id=citizen.id,
            task_id=t.id,
            category_id=TaskCategorySlug.civic,
            status=SubmissionStatus.under_review,
            location=ST_SetSRID(ST_MakePoint(78.3618, 17.4682), 4326),
            accuracy_m=10.0,
            captured_at=now - timedelta(minutes=5),
            created_at=now - timedelta(minutes=5),
        )
        async_db.add(sub)
    await async_db.commit()

    # 6th submission should trigger 429
    extra_task = Task(
        title="Extra Task",
        category_id=TaskCategorySlug.civic,
        points_reward=20,
        status=TaskStatus.active,
    )
    async_db.add(extra_task)
    await async_db.commit()

    files = {"photo": ("photo.jpg", _dummy_jpeg_bytes() + b"extra", "image/jpeg")}
    data = {
        "lat": "17.4682",
        "lng": "78.3618",
        "accuracy": "10.0",
        "timestamp": now.isoformat(),
        "categoryId": "civic",
        "taskId": str(extra_task.id),
    }
    resp = await client.post("/api/v1/submissions", data=data, files=files, headers=headers)
    assert resp.status_code == 429


@pytest.mark.asyncio
async def test_duplicate_photo_flag(client: AsyncClient, async_db: AsyncSession, setup_data: dict):
    """Submitting same photo twice sets DUPLICATE_HASH fraud flag."""
    headers = setup_data["headers"]
    citizen = setup_data["citizen"]

    t1 = Task(
        title="Task A",
        category_id=TaskCategorySlug.civic,
        points_reward=20,
        status=TaskStatus.active,
    )
    t2 = Task(
        title="Task B",
        category_id=TaskCategorySlug.civic,
        points_reward=20,
        status=TaskStatus.active,
    )
    async_db.add_all([t1, t2])
    await async_db.commit()

    identical_photo = _dummy_jpeg_bytes() + b"duplicate_unique_hash"
    now_iso = datetime.now(timezone.utc).isoformat()

    # First submission
    files1 = {"photo": ("photo1.jpg", identical_photo, "image/jpeg")}
    data1 = {
        "lat": "17.4682",
        "lng": "78.3618",
        "accuracy": "10.0",
        "timestamp": now_iso,
        "categoryId": "civic",
        "taskId": str(t1.id),
    }
    resp1 = await client.post("/api/v1/submissions", data=data1, files=files1, headers=headers)
    assert resp1.status_code == 201

    # Second submission with identical photo to different task
    files2 = {"photo": ("photo2.jpg", identical_photo, "image/jpeg")}
    data2 = {
        "lat": "17.4682",
        "lng": "78.3618",
        "accuracy": "10.0",
        "timestamp": now_iso,
        "categoryId": "civic",
        "taskId": str(t2.id),
    }
    resp2 = await client.post("/api/v1/submissions", data=data2, files=files2, headers=headers)
    assert resp2.status_code == 201
    sub2_id = resp2.json()["id"]

    # Verify fraud_flags in DB has DUPLICATE_HASH
    sub2_db = (
        await async_db.execute(sa.select(Submission).where(Submission.id == uuid.UUID(sub2_id)))
    ).scalar_one()

    flag_codes = [f.get("code") for f in sub2_db.fraud_flags]
    assert "DUPLICATE_HASH" in flag_codes or any("duplicate" in c.lower() for c in flag_codes)


@pytest.mark.asyncio
async def test_speed_run_flag(client: AsyncClient, async_db: AsyncSession, setup_data: dict):
    """Submitting < 30s after task creation flags speed_run in fraud_flags."""
    headers = setup_data["headers"]

    # Create task right now (< 30s old)
    fresh_task = Task(
        title="Fresh Task",
        category_id=TaskCategorySlug.civic,
        points_reward=20,
        status=TaskStatus.active,
        created_at=datetime.now(timezone.utc),
    )
    async_db.add(fresh_task)
    await async_db.commit()

    files = {"photo": ("photo.jpg", _dummy_jpeg_bytes() + b"speedrun", "image/jpeg")}
    data = {
        "lat": "17.4682",
        "lng": "78.3618",
        "accuracy": "10.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "categoryId": "civic",
        "taskId": str(fresh_task.id),
    }
    resp = await client.post("/api/v1/submissions", data=data, files=files, headers=headers)
    assert resp.status_code == 201
    sub_id = resp.json()["id"]

    sub_db = (
        await async_db.execute(sa.select(Submission).where(Submission.id == uuid.UUID(sub_id)))
    ).scalar_one()

    flag_codes = [f.get("code") for f in sub_db.fraud_flags]
    assert "speed_run" in flag_codes


@pytest.mark.asyncio
async def test_resubmit_rejected_submission(client: AsyncClient, async_db: AsyncSession, setup_data: dict):
    """Resubmission is permitted when status is 'rejected' and creates linked record."""
    task = setup_data["task"]
    headers = setup_data["headers"]
    citizen = setup_data["citizen"]

    # 1. Create a submission
    files = {"photo": ("photo.jpg", _dummy_jpeg_bytes() + b"to_reject", "image/jpeg")}
    data = {
        "lat": "17.4682",
        "lng": "78.3618",
        "accuracy": "10.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "categoryId": "green",
        "taskId": str(task.id),
    }
    resp = await client.post("/api/v1/submissions", data=data, files=files, headers=headers)
    sub_id = resp.json()["id"]

    # 2. Mark it rejected in DB (simulating reviewer rejection)
    await async_db.execute(
        sa.update(Submission)
        .where(Submission.id == uuid.UUID(sub_id))
        .values(status=SubmissionStatus.rejected)
    )
    reject_event = SubmissionEvent(
        submission_id=uuid.UUID(sub_id),
        status=SubmissionStatus.rejected,
        actor_label="Reviewer",
        reason="Photo was too blurry",
    )
    async_db.add(reject_event)
    await async_db.commit()

    # 3. Resubmit
    resubmit_files = {"photo": ("resubmit.jpg", _dummy_jpeg_bytes() + b"clear_photo", "image/jpeg")}
    resubmit_data = {
        "lat": "17.4682",
        "lng": "78.3618",
        "accuracy": "8.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "note": "Took a clearer picture in daylight",
    }

    res_resp = await client.post(
        f"/api/v1/submissions/{sub_id}/resubmit",
        data=resubmit_data,
        files=resubmit_files,
        headers=headers,
    )
    assert res_resp.status_code == 200, res_resp.text
    res_data = res_resp.json()
    assert res_data["status"] == "under_review"
    assert res_data["id"] != sub_id

    # Verify new submission links to the old one
    new_sub = (
        await async_db.execute(sa.select(Submission).where(Submission.id == uuid.UUID(res_data["id"])))
    ).scalar_one()
    assert str(new_sub.resubmission_of) == sub_id

    # Verify audit log contains submission_resubmitted
    audit_res = await async_db.execute(
        sa.select(AuditLog).where(
            AuditLog.entity_id == new_sub.id,
            AuditLog.action == "submission_resubmitted",
        )
    )
    assert audit_res.scalar_one_or_none() is not None


@pytest.mark.asyncio
async def test_resubmit_non_rejected_conflict(client: AsyncClient, setup_data: dict):
    """Resubmission on an under_review submission returns 409 Conflict."""
    task = setup_data["task"]
    headers = setup_data["headers"]

    files = {"photo": ("photo.jpg", _dummy_jpeg_bytes() + b"under_rev", "image/jpeg")}
    data = {
        "lat": "17.4682",
        "lng": "78.3618",
        "accuracy": "10.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "categoryId": "green",
        "taskId": str(task.id),
    }
    resp = await client.post("/api/v1/submissions", data=data, files=files, headers=headers)
    sub_id = resp.json()["id"]

    # Try to resubmit while still under_review
    resubmit_files = {"photo": ("photo.jpg", _dummy_jpeg_bytes() + b"again", "image/jpeg")}
    resubmit_data = {
        "lat": "17.4682",
        "lng": "78.3618",
        "accuracy": "10.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    res_resp = await client.post(
        f"/api/v1/submissions/{sub_id}/resubmit",
        data=resubmit_data,
        files=resubmit_files,
        headers=headers,
    )
    assert res_resp.status_code == 409
