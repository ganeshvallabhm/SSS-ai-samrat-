"""
OTP service — generation, hashing, rate-limiting, and verification.

Security properties:
- OTP codes generated with secrets.token_digits (CSPRNG).
- Only HMAC-SHA256(code, OTP_HMAC_SECRET) stored — raw code never persisted or logged.
- Constant-time comparison via hmac.compare_digest.
- 30-second cooldown per phone (429 with Retry-After header value).
- Per-IP limit: 10 requests per hour (replaceable small service).
- Max 5 wrong attempts; 6th call returns 401 without incrementing.
- Expired and already-used OTPs are rejected.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.auth import OtpRequest


# ── In-memory per-IP rate limit (replaceable with Redis) ─────────────────────
# Maps IP → list of request timestamps in UTC.
_ip_request_log: dict[str, list[datetime]] = {}


def _check_ip_rate_limit(ip: str) -> bool:
    """Returns True if within limit, False if exceeded."""
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=1)
    timestamps = _ip_request_log.get(ip, [])
    # Evict old entries
    timestamps = [t for t in timestamps if t > cutoff]
    _ip_request_log[ip] = timestamps
    if len(timestamps) >= settings.OTP_IP_LIMIT_PER_HOUR:
        return False
    timestamps.append(now)
    _ip_request_log[ip] = timestamps
    return True


# ── Phone normalisation ───────────────────────────────────────────────────────

def normalise_phone(raw: str) -> str:
    """
    Accept Indian mobile numbers in various formats and return 10-digit string.
    Raises ValueError for invalid input.
    """
    phone = raw.strip().replace(" ", "").replace("-", "")
    # Strip leading +91 or 91
    if phone.startswith("+91"):
        phone = phone[3:]
    elif phone.startswith("91") and len(phone) == 12:
        phone = phone[2:]
    if not phone.isdigit() or len(phone) != 10:
        raise ValueError(f"Invalid Indian mobile number: {raw!r}")
    # Indian mobile numbers start with 6-9
    if phone[0] not in "6789":
        raise ValueError(f"Invalid Indian mobile number: {raw!r}")
    return phone


# ── HMAC helpers ──────────────────────────────────────────────────────────────

def _hmac_otp(code: str) -> str:
    """Return HMAC-SHA256 hex digest of code using OTP_HMAC_SECRET."""
    secret = settings.OTP_HMAC_SECRET.encode()
    return hmac.new(secret, code.encode(), hashlib.sha256).hexdigest()


def _verify_otp_code(plain: str, stored_hash: str) -> bool:
    """Constant-time comparison of plain code against stored HMAC hash."""
    expected = _hmac_otp(plain)
    return hmac.compare_digest(expected, stored_hash)


# ── Code generation ───────────────────────────────────────────────────────────

def generate_otp_code() -> str:
    """Generate a cryptographically random 6-digit OTP code string."""
    return f"{secrets.randbelow(1_000_000):06d}"


# ── Database helpers ──────────────────────────────────────────────────────────

async def get_latest_otp(db: AsyncSession, phone: str) -> Optional[OtpRequest]:
    """Return the most recently created OTP for this phone, or None."""
    result = await db.execute(
        sa.select(OtpRequest)
        .where(OtpRequest.phone == phone)
        .order_by(OtpRequest.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def check_cooldown(db: AsyncSession, phone: str) -> Optional[int]:
    """
    Return seconds remaining in cooldown, or None if cooldown has passed.
    Cooldown = otp_cooldown_seconds since last OTP row for this phone.
    """
    latest = await get_latest_otp(db, phone)
    if latest is None:
        return None
    now = datetime.now(timezone.utc)
    elapsed = (now - latest.created_at.replace(tzinfo=timezone.utc)).total_seconds()
    remaining = settings.OTP_COOLDOWN_SECONDS - elapsed
    if remaining > 0:
        return int(remaining) + 1
    return None


async def create_otp(db: AsyncSession, phone: str, ip: Optional[str]) -> tuple[str, OtpRequest]:
    """
    Generate a new OTP, store its hash, and return (plain_code, otp_row).
    Caller must commit the session.
    """
    code = generate_otp_code()
    code_hash = _hmac_otp(code)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=settings.OTP_TTL_SECONDS)
    row = OtpRequest(
        phone=phone,
        code_hash=code_hash,
        expires_at=expires_at,
        attempts=0,
        ip_address=ip,
    )
    db.add(row)
    return code, row


# ── Verification ──────────────────────────────────────────────────────────────

class OtpVerifyError(Exception):
    """Raised with a reason string when OTP verification fails."""
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


async def verify_otp(db: AsyncSession, phone: str, code: str) -> OtpRequest:
    """
    Verify an OTP code.

    Returns the matching OtpRequest row on success (caller must mark used_at and commit).
    Raises OtpVerifyError with reason on any failure.
    """
    now = datetime.now(timezone.utc)

    # Fetch the most recent unused OTP for this phone
    result = await db.execute(
        sa.select(OtpRequest)
        .where(OtpRequest.phone == phone)
        .where(OtpRequest.used_at.is_(None))
        .order_by(OtpRequest.created_at.desc())
        .limit(1)
        .with_for_update()
    )
    otp = result.scalar_one_or_none()

    if otp is None:
        raise OtpVerifyError("no_active_otp")

    # Check expiry
    if otp.expires_at.replace(tzinfo=timezone.utc) < now:
        raise OtpVerifyError("otp_expired")

    # Check attempt limit (do NOT increment if already exhausted)
    if otp.attempts >= settings.OTP_MAX_ATTEMPTS:
        raise OtpVerifyError("too_many_attempts")

    # Increment attempts before comparing (prevents timing attacks on attempt count)
    otp.attempts = otp.attempts + 1

    # Constant-time comparison
    if not _verify_otp_code(code, otp.code_hash):
        # Save incremented attempt count
        await db.flush()
        raise OtpVerifyError("invalid_code")

    # Mark as used
    otp.used_at = now
    await db.flush()
    return otp
