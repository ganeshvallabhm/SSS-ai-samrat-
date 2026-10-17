"""
JWT access token and opaque refresh token service.

- Access token: JWT signed with HS256, claims: sub (user UUID str), role, jti (random UUID str).
  TTL from settings.JWT_ACCESS_TTL_SECONDS (default 15 min).
- Refresh token: random opaque bytes (secrets.token_urlsafe).
  Only its SHA-256 hash stored in refresh_tokens.token_hash.
  TTL from settings.JWT_REFRESH_TTL_DAYS (default 30 days).

Refresh rotation:
  - Each refresh issues a NEW refresh token and revokes the old one.
  - If a *revoked* token is presented, ALL active tokens for that user are revoked
    (token reuse detected — possible theft) and 401 is returned.

Logout: revokes the supplied refresh token only.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID, uuid4

import sqlalchemy as sa
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.auth import RefreshToken, User


# ── Access tokens ─────────────────────────────────────────────────────────────

def create_access_token(user: User) -> str:
    """Create a signed JWT access token for user."""
    now = datetime.now(timezone.utc)
    jti = str(uuid4())
    payload = {
        "sub": str(user.id),
        "role": user.role.value if hasattr(user.role, "value") else str(user.role),
        "jti": jti,
        "iat": now,
        "exp": now + timedelta(seconds=settings.JWT_ACCESS_TTL_SECONDS),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")


def decode_access_token(token: str) -> dict:
    """
    Decode and validate a JWT access token.
    Raises JWTError on any failure (expired, invalid signature, malformed).
    """
    return jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])


# ── Refresh tokens ────────────────────────────────────────────────────────────

def _hash_token(token: str) -> str:
    """SHA-256 hex of opaque refresh token — only the hash is stored."""
    return hashlib.sha256(token.encode()).hexdigest()


def _generate_refresh_token() -> str:
    """Generate a cryptographically random opaque refresh token string."""
    return secrets.token_urlsafe(48)


async def create_refresh_token(
    db: AsyncSession,
    user: User,
    ip: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> str:
    """
    Create and persist a new refresh token for user.
    Returns the plain token (never stored — only the hash is).
    Caller must commit.
    """
    plain = _generate_refresh_token()
    token_hash = _hash_token(plain)
    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.JWT_REFRESH_TTL_DAYS)
    row = RefreshToken(
        user_id=user.id,
        token_hash=token_hash,
        expires_at=expires_at,
        ip_address=ip,
        user_agent=user_agent,
    )
    db.add(row)
    await db.flush()
    return plain


async def rotate_refresh_token(
    db: AsyncSession,
    plain_token: str,
    ip: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> tuple[str, str, User]:
    """
    Rotate a refresh token:
    1. Look up by hash.
    2. If not found → 401.
    3. If found but revoked → revoke ALL user tokens (reuse detected) → raise ValueError("reuse").
    4. If expired → 401.
    5. Revoke old token, issue new token.
    Returns (new_plain_token, new_access_token, user).
    Caller must commit.
    """
    token_hash = _hash_token(plain_token)
    now = datetime.now(timezone.utc)

    result = await db.execute(
        sa.select(RefreshToken)
        .where(RefreshToken.token_hash == token_hash)
        .with_for_update()
    )
    rt = result.scalar_one_or_none()

    if rt is None:
        raise ValueError("not_found")

    if rt.revoked_at is not None:
        # Token reuse detected — revoke all active tokens for this user
        await db.execute(
            sa.update(RefreshToken)
            .where(RefreshToken.user_id == rt.user_id)
            .where(RefreshToken.revoked_at.is_(None))
            .values(revoked_at=now)
        )
        await db.flush()
        raise ValueError("reuse")

    if rt.expires_at.replace(tzinfo=timezone.utc) < now:
        raise ValueError("expired")

    # Load user
    user_result = await db.execute(sa.select(User).where(User.id == rt.user_id))
    user = user_result.scalar_one_or_none()
    if user is None:
        raise ValueError("not_found")

    # Revoke old token
    rt.revoked_at = now

    # Issue new tokens
    new_plain = await create_refresh_token(db, user, ip=ip, user_agent=user_agent)
    new_access = create_access_token(user)

    await db.flush()
    return new_plain, new_access, user


async def revoke_refresh_token(db: AsyncSession, plain_token: str) -> bool:
    """
    Revoke a specific refresh token by its plain value.
    Returns True if found and revoked, False if not found or already revoked.
    Caller must commit.
    """
    token_hash = _hash_token(plain_token)
    now = datetime.now(timezone.utc)

    result = await db.execute(
        sa.select(RefreshToken)
        .where(RefreshToken.token_hash == token_hash)
        .where(RefreshToken.revoked_at.is_(None))
        .with_for_update()
    )
    rt = result.scalar_one_or_none()
    if rt is None:
        return False

    rt.revoked_at = now
    await db.flush()
    return True
