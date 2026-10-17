from __future__ import annotations

import math
from typing import Optional, Tuple, List
from uuid import UUID

import sqlalchemy as sa
from geoalchemy2.functions import ST_Distance, ST_MakePoint, ST_SetSRID
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.tasks import Task, TaskCategorySlug, TaskStatus
from app.schemas.tasks import PaginationMeta, TaskCategory, TaskOut


def task_to_schema(task: Task, distance: float = 0.0) -> TaskOut:
    date_str = str(task.deadline) if task.deadline else task.created_at.strftime("%Y-%m-%d")
    cat_val = task.category_id.value if hasattr(task.category_id, "value") else str(task.category_id)
    return TaskOut(
        id=str(task.id),
        title=task.title,
        category=TaskCategory(cat_val),
        points=task.points_reward,
        distance=round(distance, 2),
        location=task.location_label or "Hyderabad",
        description=task.description or "",
        requirements=task.requirements or [],
        date=date_str,
    )


async def get_task_by_id(db: AsyncSession, task_id: UUID | str, lat: Optional[float] = None, lng: Optional[float] = None) -> Optional[TaskOut]:
    try:
        t_uuid = UUID(str(task_id))
    except ValueError:
        return None

    stmt = select(Task).where(Task.id == t_uuid, Task.status == TaskStatus.active)
    result = await db.execute(stmt)
    task = result.scalar_one_or_none()
    if not task:
        return None

    distance = 0.0
    if lat is not None and lng is not None and task.required_location is not None:
        user_point = ST_SetSRID(ST_MakePoint(lng, lat), 4326)
        dist_stmt = select(ST_Distance(task.required_location, user_point) / 1000.0)
        dist_res = await db.execute(dist_stmt)
        d = dist_res.scalar()
        if d is not None:
            distance = float(d)

    return task_to_schema(task, distance)


async def list_tasks(
    db: AsyncSession,
    *,
    category: Optional[TaskCategorySlug] = None,
    search: Optional[str] = None,
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    page: int = 1,
    limit: int = 20,
) -> Tuple[List[TaskOut], PaginationMeta]:
    stmt = select(Task).where(Task.status == TaskStatus.active)

    if category:
        stmt = stmt.where(Task.category_id == category)

    if search:
        pattern = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                Task.title.ilike(pattern),
                Task.description.ilike(pattern),
                Task.location_label.ilike(pattern),
            )
        )

    # Count total
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total_count = (await db.execute(count_stmt)).scalar() or 0

    has_coords = lat is not None and lng is not None
    if has_coords:
        user_point = ST_SetSRID(ST_MakePoint(lng, lat), 4326)
        dist_col = func.coalesce(ST_Distance(Task.required_location, user_point) / 1000.0, 999999.0).label("dist_km")
        stmt = stmt.add_columns(dist_col).order_by(dist_col.asc(), Task.created_at.desc())
    else:
        stmt = stmt.order_by(Task.created_at.desc())

    offset = (page - 1) * limit
    stmt = stmt.offset(offset).limit(limit)

    results = await db.execute(stmt)

    items: List[TaskOut] = []
    if has_coords:
        for row in results.all():
            task_obj = row[0]
            dist_val = float(row[1]) if row[1] < 999998.0 else 0.0
            items.append(task_to_schema(task_obj, dist_val))
    else:
        for row in results.scalars().all():
            items.append(task_to_schema(row, 0.0))

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
