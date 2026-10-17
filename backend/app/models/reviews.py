"""
SQLAlchemy 2 ORM models for reviews and points_ledger.
Matches db/schema.sql.
"""
from __future__ import annotations

import enum
from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    Enum as SQLEnum,
    ForeignKey,
    Integer,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.models.auth import Base


class LedgerType(str, enum.Enum):
    earned = "earned"
    redeemed = "redeemed"
    expired = "expired"
    adjusted = "adjusted"


class Review(Base):
    __tablename__ = "reviews"

    id = Column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    submission_id = Column(PGUUID(as_uuid=True), ForeignKey("submissions.id", ondelete="RESTRICT"), nullable=False, unique=True)
    reviewer_id = Column(PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    decision = Column(Text, nullable=False)
    reason = Column(Text, nullable=True)
    internal_notes = Column(Text, nullable=True)
    awarded_points = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    submission = relationship("Submission")
    reviewer = relationship("User")


class PointsLedger(Base):
    __tablename__ = "points_ledger"

    id = Column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    user_id = Column(PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    amount = Column(Integer, nullable=False)
    type = Column(
        SQLEnum(LedgerType, name="ledger_type", create_type=False),
        nullable=False,
    )
    submission_id = Column(PGUUID(as_uuid=True), ForeignKey("submissions.id", ondelete="RESTRICT"), nullable=True)
    redemption_id = Column(PGUUID(as_uuid=True), nullable=True)
    description = Column(Text, nullable=False, server_default="")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    user = relationship("User")
    submission = relationship("Submission")
