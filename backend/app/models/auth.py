"""
SQLAlchemy 2 ORM models for auth-related tables.

Tables covered: users, otp_requests, refresh_tokens, audit_log, wards (referenced by users).
These match db/schema.sql exactly. Do not import from here in non-auth code yet.
"""
from __future__ import annotations

import enum
from datetime import datetime
from typing import List, Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, relationship
from sqlalchemy.sql import func


class Base(DeclarativeBase):
    __allow_unmapped__ = True


# ── Enums (mirror db/schema.sql) ────────────────────────────────────────────

class UserRole(str, enum.Enum):
    citizen = "citizen"
    reviewer = "reviewer"
    admin = "admin"


class UserStatus(str, enum.Enum):
    active = "active"
    suspended = "suspended"
    deleted = "deleted"


# ── Wards (minimal; needed for the FK in users) ──────────────────────────────

class Ward(Base):
    __tablename__ = "wards"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    name = Column(Text, nullable=False)
    city = Column(Text, nullable=False, server_default="Hyderabad")
    number = Column(Integer, nullable=True)
    is_active = Column(Boolean, nullable=False, server_default="TRUE")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("name", "city", name="wards_name_city_uq"),
    )


# ── Users ────────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    phone = Column(Text, nullable=False, unique=True)
    name = Column(Text, nullable=False, server_default="")
    role = Column(
        Enum(UserRole, name="user_role", create_type=False),
        nullable=False,
        server_default="citizen",
    )
    status = Column(
        Enum(UserStatus, name="user_status", create_type=False),
        nullable=False,
        server_default="active",
    )
    ward_id = Column(UUID(as_uuid=True), ForeignKey("wards.id", ondelete="SET NULL"), nullable=True)
    language = Column(Text, nullable=False, server_default="en")
    trust_score = Column(Integer, nullable=False, server_default="100")
    consent_accepted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __allow_unmapped__ = True

    __table_args__ = (
        CheckConstraint(r"phone ~ '^\d{10}$'", name="users_phone_format"),
        UniqueConstraint("phone", name="users_phone_uq"),
    )

    refresh_tokens: List[RefreshToken] = relationship(
        "RefreshToken", back_populates="user", cascade="all, delete-orphan"
    )


# ── OTP Requests ─────────────────────────────────────────────────────────────

class OtpRequest(Base):
    __tablename__ = "otp_requests"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    phone = Column(Text, nullable=False)
    code_hash = Column(Text, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    attempts = Column(SmallInteger, nullable=False, server_default="0")
    used_at = Column(DateTime(timezone=True), nullable=True)
    ip_address = Column(INET, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        CheckConstraint(r"phone ~ '^\d{10}$'", name="otp_phone_format"),
    )


# ── Refresh Tokens ────────────────────────────────────────────────────────────

class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash = Column(Text, nullable=False, unique=True)
    issued_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    ip_address = Column(INET, nullable=True)
    user_agent = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __allow_unmapped__ = True

    user: User = relationship("User", back_populates="refresh_tokens")  # type: ignore[assignment]


# ── Audit Log ─────────────────────────────────────────────────────────────────

class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    actor_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action = Column(Text, nullable=False)
    entity = Column(Text, nullable=False)
    entity_id = Column(UUID(as_uuid=True), nullable=True)
    details = Column(JSONB, nullable=False, server_default="{}")
    ip_address = Column(INET, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
