"""
test_wallet.py — Integration test suite for Citizen Wallet & Points Ledger API.
Covers:
- Unauthenticated access returns 401
- Accurate balance and monthly progress computation from immutable points_ledger
- Enforcement of 500-point monthly earning cap across multiple approvals
- Capping at zero additional points once monthly limit is exhausted (no constraint violations)
- Listing paginated transactions
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
async def wallet_setup(async_db: AsyncSession):
    await async_db.execute(sa.text("TRUNCATE points_ledger, reviews, submission_events, submissions CASCADE"))
    await async_db.commit()

    task = Task(
        id=uuid.uuid4(),
        title="Civic Infrastructure Audit",
        description="Audit road and lighting defects",
        category_id=TaskCategorySlug.civic,
        points_reward=40,
        status=TaskStatus.active,
        required_location=ST_SetSRID(ST_MakePoint(78.3742, 17.4485), 4326),
        geofence_radius_m=1000,
        location_label="Hitech City",
    )
    task2 = Task(
        id=uuid.uuid4(),
        title="Green Tree Plantation Drive",
        description="Plant saplings in public park",
        category_id=TaskCategorySlug.green,
        points_reward=40,
        status=TaskStatus.active,
        required_location=ST_SetSRID(ST_MakePoint(78.3742, 17.4485), 4326),
        geofence_radius_m=1000,
        location_label="Hitech City",
    )
    async_db.add_all([task, task2])
    await async_db.commit()

    citizen, citizen_h = await _create_user(async_db, UserRole.citizen, "96")
    reviewer, reviewer_h = await _create_user(async_db, UserRole.reviewer, "97")

    yield {
        "task": task,
        "task2": task2,
        "citizen": citizen,
        "citizen_h": citizen_h,
        "reviewer": reviewer,
        "reviewer_h": reviewer_h,
    }
    await async_db.execute(sa.text("TRUNCATE points_ledger, reviews, submission_events, submissions CASCADE"))
    await async_db.commit()


@pytest.mark.asyncio
async def test_wallet_unauthorized(client: AsyncClient):
    """Anonymous access to /wallet is denied with 401."""
    resp = await client.get("/api/v1/wallet")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_wallet_summary_and_monthly_cap_enforcement(
    client: AsyncClient, async_db: AsyncSession, wallet_setup
):
    """
    Test live wallet balance, monthly cap calculation (500 pts max),
    and that reviewer approval respects remaining allowance.
    """
    citizen = wallet_setup["citizen"]
    citizen_h = wallet_setup["citizen_h"]
    reviewer_h = wallet_setup["reviewer_h"]
    task = wallet_setup["task"]
    task2 = wallet_setup["task2"]

    # 1. New citizen has 0 balance and 0 monthly points
    w_resp = await client.get("/api/v1/wallet", headers=citizen_h)
    assert w_resp.status_code == 200
    w_data = w_resp.json()
    assert w_data["balance"] == 0
    assert w_data["monthlyPoints"] == 0
    assert w_data["monthlyCap"] == 500
    assert w_data["monthlyProgressPercent"] == 0.0

    # 2. Add an existing ledger entry of 480 points to simulate prior earned rewards
    initial_tx = PointsLedger(
        user_id=citizen.id,
        amount=480,
        type=LedgerType.earned,
        description="Historical civic participation",
    )
    async_db.add(initial_tx)
    await async_db.commit()

    w_resp = await client.get("/api/v1/wallet", headers=citizen_h)
    assert w_resp.json()["balance"] == 480
    assert w_resp.json()["monthlyPoints"] == 480
    assert w_resp.json()["monthlyProgressPercent"] == 96.0

    # 3. Citizen submits a 40-point task
    form_data = {
        "lat": "17.4485",
        "lng": "78.3742",
        "accuracy": "5.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "categoryId": "civic",
        "taskId": str(task.id),
        "note": "Drainage check",
    }
    files = {"photo": ("drain.jpg", io.BytesIO(_dummy_jpeg_bytes()), "image/jpeg")}
    sub_resp = await client.post("/api/v1/submissions", data=form_data, files=files, headers=citizen_h)
    assert sub_resp.status_code == 201
    sub_id = sub_resp.json()["id"]

    # 4. Reviewer approves submission: base reward is 40 pts, but only 20 pts remain under 500 cap
    appr_resp = await client.post(
        f"/api/v1/reviewer/submissions/{sub_id}/review",
        json={"decision": "approve"},
        headers=reviewer_h,
    )
    assert appr_resp.status_code == 200

    # Verify wallet now shows exactly 500 (capped!)
    w_resp = await client.get("/api/v1/wallet", headers=citizen_h)
    w_data = w_resp.json()
    assert w_data["balance"] == 500
    assert w_data["monthlyPoints"] == 500
    assert w_data["monthlyProgressPercent"] == 100.0

    # 5. Reviewer approves another submission (task2) when cap is already 500: awards 0 pts without crash
    form_data2 = {
        "lat": "17.4485",
        "lng": "78.3742",
        "accuracy": "5.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "categoryId": "green",
        "taskId": str(task2.id),
        "note": "Tree planted",
    }
    photo2_bytes = _dummy_jpeg_bytes().replace(b"JFIF", b"JFXX")
    files2 = {"photo": ("tree.jpg", io.BytesIO(photo2_bytes), "image/jpeg")}
    sub_resp2 = await client.post("/api/v1/submissions", data=form_data2, files=files2, headers=citizen_h)
    assert sub_resp2.status_code == 201
    sub_id2 = sub_resp2.json()["id"]
    appr_resp2 = await client.post(
        f"/api/v1/reviewer/submissions/{sub_id2}/review",
        json={"decision": "approve"},
        headers=reviewer_h,
    )
    assert appr_resp2.status_code == 200
    assert appr_resp2.json()["status"] == "approved"

    # Wallet stays at 500 points
    w_resp = await client.get("/api/v1/wallet", headers=citizen_h)
    assert w_resp.json()["balance"] == 500

    # 6. Verify /wallet/transactions lists ledger records
    tx_resp = await client.get("/api/v1/wallet/transactions", headers=citizen_h)
    assert tx_resp.status_code == 200
    tx_data = tx_resp.json()
    assert tx_data["meta"]["totalItems"] >= 2
    assert tx_data["items"][0]["type"] == "earned"
