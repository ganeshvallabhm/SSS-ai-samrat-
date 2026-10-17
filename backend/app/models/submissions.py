"""
SQLAlchemy 2 ORM models for submissions and submission events.
Matches db/schema.sql.
"""
from __future__ import annotations

import enum
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from geoalchemy2 import Geography
from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Numeric,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.models.auth import Base
from app.models.tasks import TaskCategorySlug


class SubmissionStatus(str, enum.Enum):
    draft = "draft"
    queued_offline = "queued_offline"
    submitted = "submitted"
    under_review = "under_review"
    approved = "approved"
    rejected = "rejected"


class Submission(Base):
    __tablename__ = "submissions"

    id = Column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    user_id = Column(PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    task_id = Column(PGUUID(as_uuid=True), ForeignKey("tasks.id", ondelete="RESTRICT"), nullable=False)
    category_id = Column(
        Enum(TaskCategorySlug, name="task_category_slug", create_type=False),
        ForeignKey("task_categories.id"),
        nullable=False,
    )
    status = Column(
        Enum(SubmissionStatus, name="submission_status", create_type=False),
        nullable=False,
        server_default="submitted",
    )
    photo_url = Column(Text, nullable=True)
    photo_thumbnail_url = Column(Text, nullable=True)
    photo_sha256 = Column(Text, nullable=True)
    location = Column(Geography(geometry_type="POINT", srid=4326), nullable=False)
    accuracy_m = Column(Numeric(8, 2), nullable=False)
    captured_at = Column(DateTime(timezone=True), nullable=False)
    received_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    area_name = Column(Text, nullable=True)
    note = Column(Text, nullable=True)
    fraud_flags = Column(JSONB, nullable=False, server_default="[]")
    resubmission_of = Column(PGUUID(as_uuid=True), ForeignKey("submissions.id", ondelete="SET NULL"), nullable=True)
    idempotency_key = Column(Text, unique=True, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        CheckConstraint("accuracy_m > 0", name="submissions_accuracy_m_check"),
        CheckConstraint("accuracy_m <= 50", name="submissions_accuracy_max"),
        CheckConstraint("char_length(note) <= 500", name="submissions_note_length"),
        CheckConstraint(
            "photo_sha256 IS NULL OR photo_sha256 ~ '^[0-9a-f]{64}$'",
            name="submissions_sha256_format",
        ),
    )

    user = relationship("User")
    task = relationship("Task")
    category = relationship("TaskCategory")
    events = relationship("SubmissionEvent", back_populates="submission", order_by="SubmissionEvent.created_at.desc()")
    predecessor = relationship("Submission", remote_side=[id])


class SubmissionEvent(Base):
    __tablename__ = "submission_events"

    id = Column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    submission_id = Column(PGUUID(as_uuid=True), ForeignKey("submissions.id", ondelete="CASCADE"), nullable=False)
    status = Column(
        Enum(SubmissionStatus, name="submission_status", create_type=False),
        nullable=False,
    )
    actor_id = Column(PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    actor_label = Column(Text, nullable=True)
    reason = Column(Text, nullable=True)
    internal_notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    submission = relationship("Submission", back_populates="events")
    actor = relationship("User")
