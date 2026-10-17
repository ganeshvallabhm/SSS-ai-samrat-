#!/usr/bin/env python3
"""
Auth flow end-to-end curl demo (Python version to avoid bash quoting issues in Docker exec).
Simulates: request OTP → verify → test-citizen → refresh → logout → confirm revoked.
"""
import asyncio
import json
import sys
from datetime import datetime, timedelta, timezone

import httpx
import sqlalchemy as sa

BASE = "http://localhost:8000/api/v1"

# ── Step 0: Seed a known OTP in the DB ───────────────────────────────────────
async def seed_otp(phone: str, code: str) -> None:
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    from app.config import settings
    from app.services.otp import _hmac_otp

    engine = create_async_engine(settings.DATABASE_URL)
    S = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with S() as db:
        await db.execute(sa.text("DELETE FROM otp_requests WHERE phone = :p"), {"p": phone})
        await db.execute(sa.text("""
            INSERT INTO otp_requests (phone, code_hash, expires_at, attempts)
            VALUES (:phone, :hash, :exp, 0)
        """), {"phone": phone, "hash": _hmac_otp(code),
               "exp": datetime.now(timezone.utc) + timedelta(minutes=5)})
        await db.commit()
    await engine.dispose()

asyncio.run(seed_otp("9900000042", "424242"))
print("✓ OTP seeded for demo phone 9900000042 / code 424242\n")

# ── HTTP demo ─────────────────────────────────────────────────────────────────
def pp(label: str, resp: httpx.Response) -> dict:
    print(f"\n{'='*60}")
    print(f"  {label}")
    print(f"  HTTP {resp.status_code}")
    try:
        body = resp.json()
        print(json.dumps(body, indent=2))
    except Exception:
        print(resp.text)
    return resp.json() if resp.is_success else {}

with httpx.Client(base_url=BASE, timeout=10) as c:

    # Step 1: Request OTP (new phone — same response shape)
    r1 = c.post("/auth/otp/request", json={"phone": "+919900000099"})
    pp("Step 1: POST /auth/otp/request (new phone +919900000099)", r1)

    # Step 2: Verify (pre-seeded code)
    r2 = c.post("/auth/otp/verify", json={"phone": "+919900000042", "code": "424242"})
    data2 = pp("Step 2: POST /auth/otp/verify (code 424242)", r2)
    if r2.status_code != 200:
        print("ERROR: verify failed, stopping")
        sys.exit(1)
    access = data2["accessToken"]
    refresh = data2["refreshToken"]

    # Step 3: Test citizen route (should be 200)
    r3 = c.get("/auth/me/test-citizen", headers={"Authorization": f"Bearer {access}"})
    pp("Step 3: GET /auth/me/test-citizen (should 200)", r3)

    # Step 3b: Test reviewer route as citizen (should be 403)
    r3b = c.get("/auth/me/test-reviewer", headers={"Authorization": f"Bearer {access}"})
    pp("Step 3b: GET /auth/me/test-reviewer as citizen (should 403)", r3b)

    # Step 4: Refresh tokens
    r4 = c.post("/auth/refresh", json={"refreshToken": refresh})
    data4 = pp("Step 4: POST /auth/refresh", r4)
    if r4.status_code != 200:
        print("ERROR: refresh failed, stopping")
        sys.exit(1)
    new_access = data4["accessToken"]
    new_refresh = data4["refreshToken"]

    # Step 5: Logout
    r5 = c.post("/auth/logout",
                json={"refreshToken": new_refresh},
                headers={"Authorization": f"Bearer {new_access}"})
    pp("Step 5: POST /auth/logout", r5)

    # Step 6: Confirm revoked refresh token → 401
    r6 = c.post("/auth/refresh", json={"refreshToken": new_refresh})
    pp("Step 6: POST /auth/refresh after logout (should 401)", r6)

    # Step 7: No token → 401
    r7 = c.get("/auth/me/test-citizen")
    pp("Step 7: GET /auth/me/test-citizen no token (should 401)", r7)

print("\n" + "="*60)
print("  Full auth flow completed successfully!")
print("="*60)
