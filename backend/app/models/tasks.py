"""
SQLAlchemy 2 ORM models for tasks and task categories.
Matches db/schema.sql.
"""
from __future__ import annotations

import enum
from datetime import date, datetime
from typing import List, Optional
from uuid import UUID

from geoalchemy2 import Geography
from sqlalchemy import (
    CheckConstraint,
    Column,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Text,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID as PGUUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.models.auth import Base


class TaskCategorySlug(str, enum.Enum):
    civic = "civic"
    green = "green"
    health = "health"
    governance = "governance"


class TaskStatus(str, enum.Enum):
    draft = "draft"
    active = "active"
    paused = "paused"
    expired = "expired"


class TaskCategory(Base):
    __tablename__ = "task_categories"

    id = Column(
        Enum(TaskCategorySlug, name="task_category_slug", create_type=False),
        primary_key=True,
    )
    label = Column(Text, nullable=False)
    short_label = Column(Text, nullable=False)
    icon_name = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class Task(Base):
    __tablename__ = "tasks"

    id = Column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    title = Column(Text, nullable=False)
    description = Column(Text, nullable=False, server_default="")
    requirements = Column(ARRAY(Text), nullable=False, server_default="{}")
    category_id = Column(
        Enum(TaskCategorySlug, name="task_category_slug", create_type=False),
        ForeignKey("task_categories.id"),
        nullable=False,
    )
    ward_id = Column(PGUUID(as_uuid=True), ForeignKey("wards.id", ondelete="SET NULL"), nullable=True)
    points_reward = Column(Integer, nullable=False)
    required_location = Column(Geography(geometry_type="POINT", srid=4326), nullable=True)
    geofence_radius_m = Column(Integer, nullable=True)
    location_label = Column(Text, nullable=False, server_default="")
    deadline = Column(Date, nullable=True)
    status = Column(
        Enum(TaskStatus, name="task_status", create_type=False),
        nullable=False,
        server_default="active",
    )
    created_by = Column(PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        CheckConstraint("points_reward > 0", name="tasks_points_reward_check"),
        CheckConstraint("geofence_radius_m > 0", name="tasks_geofence_radius_m_check"),
    )

    category = relationship("TaskCategory")
    ward = relationship("Ward")
