"""
Auth router — POST /auth/otp/request, /auth/otp/verify, /auth/refresh, /auth/logout.
Also exposes temporary test-only role-guard routes (TODO-remove before GA).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth_deps import get_current_user, require_role
from app.db import get_db
from app.models.auth import User, UserRole, UserStatus
from app.schemas.auth import (
    AuthSessionResponse,
    AuthTokenPair,
    ErrorResponse,
    OtpRequest,
    OtpRequestResponse,
    OtpVerifyRequest,
    RefreshRequest,
    UserProfile,
)
from app.services.audit import write_audit
from app.services.otp import (
    OtpVerifyError,
    check_cooldown,
    create_otp,
    normalise_phone,
    _check_ip_rate_limit,
)
from app.services.sms import get_sms_provider
from app.services.tokens import (
    create_access_token,
    create_refresh_token,
    revoke_refresh_token,
    rotate_refresh_token,
)

router = APIRouter(prefix="/auth", tags=["Auth"])


def _get_client_ip(request: Request) -> Optional[str]:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


# ── POST /auth/otp/request ────────────────────────────────────────────────────

@router.post(
    "/otp/request",
    response_model=OtpRequestResponse,
    status_code=200,
    responses={
        400: {"model": ErrorResponse},
        429: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)
async def request_otp(
    body: OtpRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Request a 6-digit SMS OTP for an Indian phone number.

    Returns the same response whether or not the phone has an existing account.
    Rate-limited: 30-second cooldown per phone, 10 requests/hour per IP.
    """
    # Validate + normalise phone
    try:
        phone = normalise_phone(body.phone)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": "invalid_phone", "message": str(exc)},
        )

    ip = _get_client_ip(request)

    # Per-IP rate limit
    if ip and not _check_ip_rate_limit(ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error": "rate_limit_exceeded",
                "message": "Too many OTP requests from this IP. Please try again later.",
            },
            headers={"Retry-After": "3600"},
        )

    # Per-phone cooldown
    cooldown = await check_cooldown(db, phone)
    if cooldown is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error": "cooldown_active",
                "message": f"Please wait {cooldown} seconds before requesting another OTP.",
            },
            headers={"Retry-After": str(cooldown)},
        )

    # Generate OTP and send via SMS provider
    sms = get_sms_provider(settings.ENVIRONMENT)
    code, otp_row = await create_otp(db, phone, ip)

    sent = await sms.send_otp(phone, code)
    if not sent:
        # SMS failed — still persist the row (for audit) but surface the error
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "sms_failed", "message": "Failed to send OTP. Please try again."},
        )

    await write_audit(
        db,
        action="otp_requested",
        entity="otp_requests",
        entity_id=otp_row.id,
        ip_address=ip,
        details={"phone_suffix": phone[-4:]},
    )
    await db.commit()

    return OtpRequestResponse(
        message="OTP sent successfully",
        expiresInSeconds=settings.OTP_TTL_SECONDS,
    )


# ── POST /auth/otp/verify ─────────────────────────────────────────────────────

@router.post(
    "/otp/verify",
    response_model=AuthSessionResponse,
    status_code=200,
    responses={
        400: {"model": ErrorResponse},
        401: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)
async def verify_otp(
    body: OtpVerifyRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Verify a 6-digit SMS OTP and exchange for JWT access + refresh tokens.

    First successful verification for a phone creates a citizen account.
    Blocked / inactive users cannot log in.
    """
    from app.services.otp import verify_otp as _verify_otp  # avoid circular at module level

    try:
        phone = normalise_phone(body.phone)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": "invalid_phone", "message": str(exc)},
        )

    ip = _get_client_ip(request)

    # Verify OTP (raises OtpVerifyError on failure)
    try:
        await _verify_otp(db, phone, body.code)
    except OtpVerifyError as exc:
        # Audit failed attempt (do not log the code)
        await write_audit(
            db,
            action="login_failed",
            entity="otp_requests",
            ip_address=ip,
            details={"reason": exc.reason, "phone_suffix": phone[-4:]},
        )
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "otp_invalid", "message": "Invalid, expired, or used OTP code"},
        )

    # Upsert user (first verify → create citizen; subsequent → update timestamp)
    result = await db.execute(sa.select(User).where(User.phone == phone).with_for_update())
    user = result.scalar_one_or_none()

    if user is None:
        user = User(
            phone=phone,
            role=UserRole.citizen,
            language="en",
            status=UserStatus.active,
        )
        db.add(user)
        await db.flush()
    else:
        if user.status != UserStatus.active:
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"error": "account_inactive", "message": "Account is blocked or inactive"},
            )

    # Issue tokens
    access_token = create_access_token(user)
    refresh_token = await create_refresh_token(
        db, user, ip=ip,
        user_agent=request.headers.get("User-Agent"),
    )

    await write_audit(
        db,
        action="login_success",
        entity="users",
        entity_id=user.id,
        actor_id=user.id,
        ip_address=ip,
        details={"role": user.role.value if hasattr(user.role, "value") else str(user.role)},
    )
    await db.commit()

    phone_display = f"+91{phone}"
    profile = UserProfile(
        id=user.id,
        phone=phone_display,
        name=user.name,
        role=user.role.value if hasattr(user.role, "value") else str(user.role),
        language=user.language,
    )

    return AuthSessionResponse(
        user=profile,
        accessToken=access_token,
        refreshToken=refresh_token,
        expiresIn=settings.JWT_ACCESS_TTL_SECONDS,
    )


# ── POST /auth/refresh ────────────────────────────────────────────────────────

@router.post(
    "/refresh",
    response_model=AuthTokenPair,
    status_code=200,
    responses={401: {"model": ErrorResponse}},
)
async def refresh_token(
    body: RefreshRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Rotate refresh token: revoke old, issue new access + refresh tokens.
    If a revoked token is reused, all active tokens for the user are revoked.
    """
    ip = _get_client_ip(request)

    try:
        new_refresh, new_access, user = await rotate_refresh_token(
            db,
            body.refreshToken,
            ip=ip,
            user_agent=request.headers.get("User-Agent"),
        )
    except ValueError as exc:
        reason = str(exc)
        if reason == "reuse":
            await write_audit(
                db,
                action="token_reuse_detected",
                entity="refresh_tokens",
                ip_address=ip,
                details={},
            )
            await db.commit()
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"error": "token_reuse", "message": "Refresh token reuse detected. All sessions revoked."},
            )
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "invalid_refresh_token", "message": "Refresh token is invalid, expired, or revoked"},
        )

    await write_audit(
        db,
        action="token_refreshed",
        entity="users",
        entity_id=user.id,
        actor_id=user.id,
        ip_address=ip,
        details={},
    )
    await db.commit()

    return AuthTokenPair(
        accessToken=new_access,
        refreshToken=new_refresh,
        expiresIn=settings.JWT_ACCESS_TTL_SECONDS,
    )


# ── POST /auth/logout ─────────────────────────────────────────────────────────

@router.post(
    "/logout",
    status_code=200,
    responses={401: {"model": ErrorResponse}},
)
async def logout(
    body: RefreshRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Revoke the supplied refresh token. Requires a valid Bearer access token.
    """
    ip = _get_client_ip(request)
    await revoke_refresh_token(db, body.refreshToken)

    await write_audit(
        db,
        action="logout",
        entity="users",
        entity_id=current_user.id,
        actor_id=current_user.id,
        ip_address=ip,
        details={},
    )
    await db.commit()

    return {"signedOut": True}


# ── TODO-remove: Temporary role-guard test routes ─────────────────────────────

@router.get(
    "/me/test-citizen",
    tags=["Auth"],
    summary="[TODO-remove] Test citizen role guard",
)
async def test_citizen(current_user: User = Depends(require_role("citizen"))):
    """Temporary test route — remove before GA."""
    return {
        "role": current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role),
        "id": str(current_user.id),
    }


@router.get(
    "/me/test-reviewer",
    tags=["Auth"],
    summary="[TODO-remove] Test reviewer role guard",
)
async def test_reviewer(current_user: User = Depends(require_role("reviewer"))):
    """Temporary test route — remove before GA."""
    return {
        "role": current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role),
        "id": str(current_user.id),
    }


@router.get(
    "/me/test-admin",
    tags=["Auth"],
    summary="[TODO-remove] Test admin role guard",
)
async def test_admin(current_user: User = Depends(require_role("admin"))):
    """Temporary test route — remove before GA."""
    return {
        "role": current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role),
        "id": str(current_user.id),
    }
