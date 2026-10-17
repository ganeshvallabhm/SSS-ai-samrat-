"""
test_tasks.py — Test suite for Tasks exploration and details.
"""
from __future__ import annotations

import uuid
import random
from datetime import date, datetime, timezone
import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from geoalchemy2.functions import ST_MakePoint, ST_SetSRID
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import User, UserRole, UserStatus
from app.models.tasks import Task, TaskCategorySlug, TaskStatus
from app.services.tokens import create_access_token


@pytest.fixture
async def citizen_auth_headers(async_db: AsyncSession) -> dict[str, str]:
    """Create an active citizen and return valid Bearer auth headers."""
    digits = "".join(str(random.randint(0, 9)) for _ in range(8))
    phone = f"99{digits}"
    user = User(
        phone=phone,
        name="Test Citizen",
        role=UserRole.citizen,
        status=UserStatus.active,
    )
    async_db.add(user)
    await async_db.commit()
    await async_db.refresh(user)

    token = create_access_token(user)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def sample_tasks(async_db: AsyncSession) -> list[Task]:
    """Seed test tasks with various categories and locations."""
    from app.models.submissions import Submission, SubmissionEvent
    await async_db.execute(sa.delete(SubmissionEvent))
    await async_db.execute(sa.delete(Submission))
    await async_db.execute(sa.delete(Task))
    await async_db.commit()

    # Kondapur: 17.4682° N, 78.3618° E
    # Gachibowli: 17.4401° N, 78.3492° E (~3.5km away)
    t1 = Task(
        title="Plant a sapling at Kondapur Garden",
        description="Join community tree plantation",
        category_id=TaskCategorySlug.green,
        points_reward=40,
        required_location=ST_SetSRID(ST_MakePoint(78.3618, 17.4682), 4326),
        geofence_radius_m=200,
        location_label="Kondapur Botanical Garden",
        requirements=["Plant native sapling", "Live photo required"],
        deadline=date(2026, 12, 31),
        status=TaskStatus.active,
    )
    t2 = Task(
        title="Report Pothole on Kondapur Main Road",
        description="Audit road surface issues",
        category_id=TaskCategorySlug.civic,
        points_reward=20,
        required_location=ST_SetSRID(ST_MakePoint(78.3618, 17.4682), 4326),
        geofence_radius_m=100,
        location_label="Kondapur Main Road",
        requirements=["Photo of pothole with scale"],
        deadline=date(2026, 12, 31),
        status=TaskStatus.active,
    )
    t3 = Task(
        title="Gachibowli Cleanliness Audit",
        description="Survey the public park condition",
        category_id=TaskCategorySlug.civic,
        points_reward=30,
        required_location=ST_SetSRID(ST_MakePoint(78.3492, 17.4401), 4326),
        geofence_radius_m=300,
        location_label="Gachibowli Stadium Road",
        requirements=["Document waste dump"],
        deadline=date(2026, 12, 31),
        status=TaskStatus.active,
    )
    t4 = Task(
        title="Blood Donation Camp",
        description="Donate blood at community hall",
        category_id=TaskCategorySlug.health,
        points_reward=50,
        location_label="Community Health Center",
        requirements=["Valid donor card"],
        deadline=date(2026, 12, 31),
        status=TaskStatus.active,
    )
    t5 = Task(
        title="Expired Task",
        description="Should not appear in active tasks",
        category_id=TaskCategorySlug.civic,
        points_reward=10,
        location_label="Old Town",
        status=TaskStatus.expired,
    )

    async_db.add_all([t1, t2, t3, t4, t5])
    await async_db.commit()
    for t in [t1, t2, t3, t4]:
        await async_db.refresh(t)
    return [t1, t2, t3, t4]


@pytest.mark.asyncio
async def test_tasks_unauthorized(client: AsyncClient):
    """GET /tasks requires an authenticated citizen token."""
    resp = await client.get("/api/v1/tasks")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_list_tasks_pagination(
    client: AsyncClient,
    citizen_auth_headers: dict[str, str],
    sample_tasks: list[Task],
):
    """Verify tasks pagination returns correct items and meta."""
    resp = await client.get("/api/v1/tasks?page=1&limit=2", headers=citizen_auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == 2
    assert data["meta"]["page"] == 1
    assert data["meta"]["limit"] == 2
    assert data["meta"]["totalItems"] >= 4
    assert data["meta"]["totalPages"] >= 2
    assert data["meta"]["hasNextPage"] is True


@pytest.mark.asyncio
async def test_filter_tasks_by_category(
    client: AsyncClient,
    citizen_auth_headers: dict[str, str],
    sample_tasks: list[Task],
):
    """Verify filtering by category returns only matching tasks."""
    resp = await client.get("/api/v1/tasks?category=green", headers=citizen_auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) >= 1
    for item in data["items"]:
        assert item["category"] == "green"


@pytest.mark.asyncio
async def test_search_tasks(
    client: AsyncClient,
    citizen_auth_headers: dict[str, str],
    sample_tasks: list[Task],
):
    """Verify text search across title, description, and location."""
    resp = await client.get("/api/v1/tasks?search=Botanical", headers=citizen_auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == 1
    assert "Botanical" in data["items"][0]["location"] or "Botanical" in data["items"][0]["title"]


@pytest.mark.asyncio
async def test_sort_tasks_by_proximity(
    client: AsyncClient,
    citizen_auth_headers: dict[str, str],
    sample_tasks: list[Task],
):
    """Verify proximity sorting puts closest tasks first."""
    # User is right at Kondapur coordinates
    lat = 17.4682
    lng = 78.3618
    resp = await client.get(f"/api/v1/tasks?lat={lat}&lng={lng}", headers=citizen_auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    items = data["items"]
    assert len(items) >= 2
    # The first item should be located right at Kondapur (< 0.1 km)
    assert items[0]["distance"] < 0.2


@pytest.mark.asyncio
async def test_get_task_by_id(
    client: AsyncClient,
    citizen_auth_headers: dict[str, str],
    sample_tasks: list[Task],
):
    """Verify GET /tasks/{taskId} returns complete task details."""
    target_task = sample_tasks[0]
    resp = await client.get(f"/api/v1/tasks/{target_task.id}", headers=citizen_auth_headers)
    assert resp.status_code == 200
    task_data = resp.json()
    assert task_data["id"] == str(target_task.id)
    assert task_data["title"] == target_task.title
    assert task_data["points"] == target_task.points_reward
    assert task_data["category"] == target_task.category_id.value
    assert isinstance(task_data["requirements"], list)
    assert task_data["date"] == str(target_task.deadline)


@pytest.mark.asyncio
async def test_get_task_not_found(
    client: AsyncClient,
    citizen_auth_headers: dict[str, str],
):
    """Verify GET /tasks/{non_existent_id} returns 404."""
    random_id = str(uuid.uuid4())
    resp = await client.get(f"/api/v1/tasks/{random_id}", headers=citizen_auth_headers)
    assert resp.status_code == 404
