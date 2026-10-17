"""
SQLAlchemy 2 ORM model for app_config table.
Matches db/schema.sql.
"""
from __future__ import annotations

from sqlalchemy import Column, DateTime, Text
from sqlalchemy.sql import func

from app.models.auth import Base


class AppConfig(Base):
    __tablename__ = "app_config"

    key = Column(Text, primary_key=True)
    value = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
