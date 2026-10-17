"""
test_auth.py — Full auth flow test suite (11 test cases).

Runs against the isolated civic_spark_test database via conftest fixtures.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from uuid import uuid4

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.auth import OtpRequest, RefreshToken, User, UserRole, UserStatus
from app.services.otp import normalise_phone

# ── Helpers ───────────────────────────────────────────────────────────────────

TEST_PHONE = "9876543210"
TEST_PHONE_E164 = "+919876543210"


async def _clear_otp_cooldown(db: AsyncSession, phone: str) -> None:
    """Backdate all OTP rows for this phone so the cooldown has expired."""
    await db.execute(
        sa.update(OtpRequest)
        .where(OtpRequest.phone == phone)
        .values(created_at=datetime.now(timezone.utc) - timedelta(seconds=settings.OTP_COOLDOWN_SECONDS + 5))
    )
    await db.commit()


async def _clear_otp_rows(db: AsyncSession, phone: str) -> None:
    """Delete all OTP rows for this phone (test isolation)."""
    await db.execute(sa.delete(OtpRequest).where(OtpRequest.phone == phone))
    await db.commit()


async def _clear_user(db: AsyncSession, phone: str) -> None:
    """Delete user and related rows for this phone (test isolation)."""
    result = await db.execute(sa.select(User).where(User.phone == phone))
    user = result.scalar_one_or_none()
    if user:
        await db.execute(sa.delete(RefreshToken).where(RefreshToken.user_id == user.id))
        await db.execute(sa.delete(User).where(User.id == user.id))
    await db.commit()


# ── Test 1: Full happy-path flow ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_full_flow_new_citizen(client: AsyncClient, async_db: AsyncSession):
    """1. Request, verify → tokens issued for a new citizen."""
    phone = "9800000001"
    phone_e164 = f"+91{phone}"
    await _clear_otp_rows(async_db, phone)
    await _clear_user(async_db, phone)

    known_code = "123456"
    with patch("app.services.otp.generate_otp_code", return_value=known_code):
        resp = await client.post("/api/v1/auth/otp/request", json={"phone": phone_e164})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["message"] == "OTP sent successfully"
    assert data["expiresInSeconds"] == settings.OTP_TTL_SECONDS

    resp2 = await client.post(
        "/api/v1/auth/otp/verify",
        json={"phone": phone_e164, "code": known_code},
    )
    assert resp2.status_code == 200, resp2.text
    auth = resp2.json()
    assert "accessToken" in auth
    assert "refreshToken" in auth
    assert auth["user"]["role"] == "citizen"
    assert auth["user"]["phone"] == phone_e164


# ── Test 2: Wrong code increments attempts; 6th is blocked ───────────────────

@pytest.mark.asyncio
async def test_wrong_code_increments_attempts(client: AsyncClient, async_db: AsyncSession):
    """2. Wrong code increments attempts; the 6th attempt is blocked (already at max)."""
    phone = "9800000002"
    phone_e164 = f"+91{phone}"
    await _clear_otp_rows(async_db, phone)
    await _clear_user(async_db, phone)

    known_code = "654321"
    wrong_code = "000001"

    with patch("app.services.otp.generate_otp_code", return_value=known_code):
        r = await client.post("/api/v1/auth/otp/request", json={"phone": phone_e164})
    assert r.status_code == 200, r.text

    # 5 wrong attempts
    for i in range(5):
        resp = await client.post(
            "/api/v1/auth/otp/verify",
            json={"phone": phone_e164, "code": wrong_code},
        )
        assert resp.status_code == 401, f"attempt {i+1} should fail with 401"

    # 6th attempt — attempts exhausted, should still be 401
    resp6 = await client.post(
        "/api/v1/auth/otp/verify",
        json={"phone": phone_e164, "code": known_code},
    )
    assert resp6.status_code == 401


# ── Test 3: Expired and already-used OTP are rejected ────────────────────────

@pytest.mark.asyncio
async def test_expired_and_used_otp_rejected(client: AsyncClient, async_db: AsyncSession):
    """3. Expired and already-used OTP are rejected."""
    # Test expired
    phone_exp = "9800000031"
    phone_exp_e164 = f"+91{phone_exp}"
    await _clear_otp_rows(async_db, phone_exp)
    await _clear_user(async_db, phone_exp)

    with patch("app.services.otp.generate_otp_code", return_value="111111"):
        await client.post("/api/v1/auth/otp/request", json={"phone": phone_exp_e164})

    # Expire it
    await async_db.execute(
        sa.update(OtpRequest)
        .where(OtpRequest.phone == phone_exp)
        .where(OtpRequest.used_at.is_(None))
        .values(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1))
    )
    await async_db.commit()

    resp = await client.post(
        "/api/v1/auth/otp/verify",
        json={"phone": phone_exp_e164, "code": "111111"},
    )
    assert resp.status_code == 401

    # Test already-used
    phone_used = "9800000032"
    phone_used_e164 = f"+91{phone_used}"
    await _clear_otp_rows(async_db, phone_used)
    await _clear_user(async_db, phone_used)

    with patch("app.services.otp.generate_otp_code", return_value="222222"):
        await client.post("/api/v1/auth/otp/request", json={"phone": phone_used_e164})

    # First verify — should succeed
    resp_ok = await client.post(
        "/api/v1/auth/otp/verify",
        json={"phone": phone_used_e164, "code": "222222"},
    )
    assert resp_ok.status_code == 200, resp_ok.text

    # Second verify with same code — OTP used_at is set, should fail
    resp_used = await client.post(
        "/api/v1/auth/otp/verify",
        json={"phone": phone_used_e164, "code": "222222"},
    )
    assert resp_used.status_code == 401


# ── Test 4: 30-second cooldown returns 429 ───────────────────────────────────

@pytest.mark.asyncio
async def test_cooldown_returns_429(client: AsyncClient, async_db: AsyncSession):
    """4. The 30-second cooldown returns 429 with Retry-After."""
    phone = "9800000004"
    phone_e164 = f"+91{phone}"
    await _clear_otp_rows(async_db, phone)

    with patch("app.services.otp.generate_otp_code", return_value="333333"):
        r1 = await client.post("/api/v1/auth/otp/request", json={"phone": phone_e164})
    assert r1.status_code == 200, r1.text

    # Immediate resend — should get 429
    with patch("app.services.otp.generate_otp_code", return_value="333333"):
        r2 = await client.post("/api/v1/auth/otp/request", json={"phone": phone_e164})
    assert r2.status_code == 429
    assert "retry-after" in r2.headers or "Retry-After" in r2.headers


# ── Test 5: 000000 fails; another 6-digit code succeeds in development ────────

@pytest.mark.asyncio
async def test_mock_sms_000000_fails(client: AsyncClient, async_db: AsyncSession):
    """5. 000000 fails; another 6-digit code succeeds in development."""
    phone = "9800000005"
    phone_e164 = f"+91{phone}"
    await _clear_otp_rows(async_db, phone)

    # 000000 → SMS send fails → 500 (OTP row is still committed, but we then backdate it)
    with patch("app.services.otp.generate_otp_code", return_value="000000"):
        r = await client.post("/api/v1/auth/otp/request", json={"phone": phone_e164})
    assert r.status_code == 500, r.text

    # Backdate the row so cooldown doesn't block the retry
    await _clear_otp_cooldown(async_db, phone)

    # A valid code → 200
    with patch("app.services.otp.generate_otp_code", return_value="456789"):
        r2 = await client.post("/api/v1/auth/otp/request", json={"phone": phone_e164})
    assert r2.status_code == 200, r2.text


# ── Test 6: App refuses to start in production with mock provider ─────────────

def test_production_refuses_mock():
    """6. The app refuses to start in production with the mock provider."""
    from app.services.sms import get_sms_provider

    with pytest.raises(RuntimeError, match="production"):
        get_sms_provider("production")


# ── Test 7: Refresh rotates tokens; reusing old refresh token revokes family ──

@pytest.mark.asyncio
async def test_refresh_rotation_and_reuse_detection(client: AsyncClient, async_db: AsyncSession):
    """7. Refresh rotates tokens; reusing an old refresh token revokes the whole family."""
    phone = "9800000007"
    phone_e164 = f"+91{phone}"
    await _clear_otp_rows(async_db, phone)
    await _clear_user(async_db, phone)

    known_code = "567890"
    with patch("app.services.otp.generate_otp_code", return_value=known_code):
        await client.post("/api/v1/auth/otp/request", json={"phone": phone_e164})
    login_resp = await client.post(
        "/api/v1/auth/otp/verify",
        json={"phone": phone_e164, "code": known_code},
    )
    assert login_resp.status_code == 200, login_resp.text
    original_refresh = login_resp.json()["refreshToken"]
    original_access = login_resp.json()["accessToken"]

    # Rotate refresh token
    refresh_resp = await client.post(
        "/api/v1/auth/refresh",
        json={"refreshToken": original_refresh},
        headers={"Authorization": f"Bearer {original_access}"},
    )
    assert refresh_resp.status_code == 200, refresh_resp.text
    new_refresh = refresh_resp.json()["refreshToken"]
    assert new_refresh != original_refresh

    # Reuse the OLD refresh token → 401 + all tokens revoked
    reuse_resp = await client.post(
        "/api/v1/auth/refresh",
        json={"refreshToken": original_refresh},
    )
    assert reuse_resp.status_code == 401
    detail = reuse_resp.json().get("detail", {})
    assert "reuse" in str(detail).lower()

    # The NEW refresh token should also now be revoked
    after_reuse_resp = await client.post(
        "/api/v1/auth/refresh",
        json={"refreshToken": new_refresh},
    )
    assert after_reuse_resp.status_code == 401


# ── Test 8: Logout revokes the refresh token ─────────────────────────────────

@pytest.mark.asyncio
async def test_logout_revokes_refresh_token(client: AsyncClient, async_db: AsyncSession):
    """8. Logout revokes the refresh token."""
    phone = "9800000008"
    phone_e164 = f"+91{phone}"
    await _clear_otp_rows(async_db, phone)
    await _clear_user(async_db, phone)

    known_code = "678901"
    with patch("app.services.otp.generate_otp_code", return_value=known_code):
        await client.post("/api/v1/auth/otp/request", json={"phone": phone_e164})
    login = await client.post(
        "/api/v1/auth/otp/verify",
        json={"phone": phone_e164, "code": known_code},
    )
    assert login.status_code == 200, login.text
    access = login.json()["accessToken"]
    refresh = login.json()["refreshToken"]

    logout_resp = await client.post(
        "/api/v1/auth/logout",
        json={"refreshToken": refresh},
        headers={"Authorization": f"Bearer {access}"},
    )
    assert logout_resp.status_code == 200
    assert logout_resp.json()["signedOut"] is True

    # Using the refresh token after logout should fail
    after_logout = await client.post(
        "/api/v1/auth/refresh",
        json={"refreshToken": refresh},
    )
    assert after_logout.status_code == 401


# ── Test 9: Role guards ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_role_guards(client: AsyncClient, async_db: AsyncSession):
    """9. Role guards: citizen gets 403 on reviewer route; no token = 401; expired = 401."""
    phone = "9800000009"
    phone_e164 = f"+91{phone}"
    await _clear_otp_rows(async_db, phone)
    await _clear_user(async_db, phone)

    known_code = "789012"
    with patch("app.services.otp.generate_otp_code", return_value=known_code):
        await client.post("/api/v1/auth/otp/request", json={"phone": phone_e164})
    login = await client.post(
        "/api/v1/auth/otp/verify",
        json={"phone": phone_e164, "code": known_code},
    )
    assert login.status_code == 200, login.text
    access = login.json()["accessToken"]

    # Citizen accesses citizen route → 200
    r_ok = await client.get(
        "/api/v1/auth/me/test-citizen",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert r_ok.status_code == 200

    # Citizen accesses reviewer route → 403
    r_forbidden = await client.get(
        "/api/v1/auth/me/test-reviewer",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert r_forbidden.status_code == 403

    # No token → 401
    r_no_token = await client.get("/api/v1/auth/me/test-citizen")
    assert r_no_token.status_code == 401

    # Expired access token → 401
    from jose import jwt as jose_jwt
    payload = {
        "sub": str(uuid4()),
        "role": "citizen",
        "jti": str(uuid4()),
        "exp": datetime.now(timezone.utc) - timedelta(seconds=1),
    }
    expired_token = jose_jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")
    r_expired = await client.get(
        "/api/v1/auth/me/test-citizen",
        headers={"Authorization": f"Bearer {expired_token}"},
    )
    assert r_expired.status_code == 401


# ── Test 10: Same response for existing and non-existing phones ───────────────

@pytest.mark.asyncio
async def test_same_response_for_existing_and_new_phone(client: AsyncClient, async_db: AsyncSession):
    """10. Same 200 response shape for existing and non-existing phone numbers."""
    phone_new = "9800000010"
    phone_new_e164 = f"+91{phone_new}"
    phone_existing = "9800000011"
    phone_existing_e164 = f"+91{phone_existing}"

    # Clean up before test
    await _clear_otp_rows(async_db, phone_new)
    await _clear_otp_rows(async_db, phone_existing)
    await _clear_user(async_db, phone_new)
    await _clear_user(async_db, phone_existing)

    # Create user for the "existing" phone
    user = User(phone=phone_existing, role=UserRole.citizen, status=UserStatus.active, language="en")
    async_db.add(user)
    await async_db.commit()

    # Request for new phone
    with patch("app.services.otp.generate_otp_code", return_value="111222"):
        r_new = await client.post("/api/v1/auth/otp/request", json={"phone": phone_new_e164})

    # Request for existing phone
    with patch("app.services.otp.generate_otp_code", return_value="333444"):
        r_exist = await client.post("/api/v1/auth/otp/request", json={"phone": phone_existing_e164})

    assert r_new.status_code == 200, r_new.text
    assert r_exist.status_code == 200, r_exist.text
    # Both responses have exactly the same shape
    assert set(r_new.json().keys()) == set(r_exist.json().keys())


# ── Test 11: Original 3 schema tests still pass ───────────────────────────────

@pytest.mark.asyncio
async def test_health_endpoint_still_passes(client: AsyncClient):
    """11. The original /health test continues to pass."""
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
