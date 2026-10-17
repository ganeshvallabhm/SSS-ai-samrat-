"""
Audit log service — thin wrapper to write audit_log entries.

Never store OTP codes, tokens, passwords, or any secret material in details.
"""
from __future__ import annotations

from typing import Any, Optional
from uuid import UUID

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import AuditLog


async def write_audit(
    db: AsyncSession,
    *,
    action: str,
    entity: str,
    entity_id: Optional[UUID] = None,
    actor_id: Optional[UUID] = None,
    details: Optional[dict[str, Any]] = None,
    ip_address: Optional[str] = None,
) -> None:
    """Append an audit log entry. Caller must commit."""
    row = AuditLog(
        actor_id=actor_id,
        action=action,
        entity=entity,
        entity_id=entity_id,
        details=details or {},
        ip_address=ip_address,
    )
    db.add(row)
    await db.flush()
