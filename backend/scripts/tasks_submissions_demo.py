#!/usr/bin/env python3
"""
End-to-end demo showing:
1. Citizen OTP Login -> JWT token
2. Seed active task (if needed)
3. List tasks (GET /tasks)
4. Submit civic proof with real photo (POST /submissions)
5. Retrieve submission status and timeline (GET /submissions/{id})
6. Download submitted photo (GET /submissions/{id}/photo)
"""
import asyncio
import io
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parents[1]
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))
if "/app" not in sys.path:
    sys.path.insert(0, "/app")

import httpx
import sqlalchemy as sa

BASE = "http://localhost:8000/api/v1"

DUMMY_JPEG = (
    b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00`\x00`\x00\x00"
    b"\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t"
    b"\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a"
    b"\x1f\x1e\x1d\x1a\x1c\x1c $.' \",#\x1c\x1c(7),01444\x1f'9=82<.342"
    b"\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00\x1f\x00"
    b"\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00"
    b"\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b\xff\xda\x00\x08\x01\x01\x00"
    b"\x00?\x00\xbf\x00\xff\xd9"
)


async def seed_demo_data():
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    from app.config import settings
    from app.services.otp import _hmac_otp

    engine = create_async_engine(settings.DATABASE_URL)
    S = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with S() as db:
        # 1. Seed OTP for phone 9900000042
        await db.execute(sa.text("DELETE FROM otp_requests WHERE phone = '9900000042'"))
        await db.execute(sa.text("""
            INSERT INTO otp_requests (phone, code_hash, expires_at, attempts)
            VALUES ('9900000042', :hash, :exp, 0)
        """), {"hash": _hmac_otp("424242"), "exp": datetime.now(timezone.utc) + timedelta(minutes=10)})

        # Clean up prior submissions for demo phone so demo is reproducible
        user_id = (await db.execute(sa.text("SELECT id FROM users WHERE phone = '9900000042'"))).scalar()
        if user_id:
            await db.execute(sa.text("DELETE FROM submission_events WHERE submission_id IN (SELECT id FROM submissions WHERE user_id = :u)"), {"u": user_id})
            await db.execute(sa.text("DELETE FROM submissions WHERE user_id = :u"), {"u": user_id})

        # 2. Ensure active demo task in Kondapur
        task_exists = (await db.execute(sa.text("SELECT id FROM tasks WHERE status = 'active' LIMIT 1"))).scalar()
        if not task_exists:
            await db.execute(sa.text("""
                INSERT INTO tasks (
                    id, title, description, requirements, category_id,
                    points_reward, required_location, geofence_radius_m,
                    location_label, status, created_at, updated_at
                ) VALUES (
                    gen_random_uuid(),
                    'Kondapur Community Tree Plantation Drive',
                    'Plant a native sapling in the designated civic area near Kondapur Lake.',
                    ARRAY['Plant one native sapling', 'Take a clear live photo', 'Keep location enabled'],
                    'green',
                    40,
                    ST_SetSRID(ST_MakePoint(78.3618, 17.4682), 4326)::geography,
                    500,
                    'Kondapur Lake Civic Zone',
                    'active',
                    now() - interval '5 minutes',
                    now()
                )
            """))
        await db.commit()
    await engine.dispose()


def pp(label: str, resp: httpx.Response) -> dict:
    print(f"\n{'='*70}")
    print(f"  {label}")
    print(f"  HTTP {resp.status_code}")
    try:
        body = resp.json()
        print(json.dumps(body, indent=2))
        return body
    except Exception:
        print(f"  [Binary Content / Text: {len(resp.content)} bytes, Content-Type: {resp.headers.get('content-type')}]")
        return {}


asyncio.run(seed_demo_data())
print("✓ Demo environment prepared (OTP & Active Task verified)\n")

with httpx.Client(base_url=BASE, timeout=15) as client:
    # ── Step 1: Login as Citizen ───────────────────────────────────────────────
    r_login = client.post("/auth/otp/verify", json={"phone": "+919900000042", "code": "424242"})
    login_data = pp("Step 1: POST /auth/otp/verify (Login as citizen)", r_login)
    if r_login.status_code != 200:
        print("Login failed, aborting.")
        sys.exit(1)

    token = login_data["accessToken"]
    headers = {"Authorization": f"Bearer {token}"}
    citizen_name = login_data["user"]["name"] or "Citizen"
    print(f"  -> Logged in as: {citizen_name} (Role: {login_data['user']['role']})")

    # ── Step 2: List Tasks ────────────────────────────────────────────────────
    r_tasks = client.get("/tasks?category=green&lat=17.4682&lng=78.3618", headers=headers)
    tasks_data = pp("Step 2: GET /tasks (List green tasks sorted by proximity)", r_tasks)
    if not tasks_data.get("items"):
        print("No tasks found.")
        sys.exit(1)

    task = tasks_data["items"][0]
    task_id = task["id"]
    print(f"  -> Selected Task: \"{task['title']}\" (ID: {task_id}, Points: {task['points']})")

    # ── Step 3: Create Live Submission with Real Photo ────────────────────────
    now_iso = datetime.now(timezone.utc).isoformat()
    files = {"photo": ("kondapur_sapling.jpg", io.BytesIO(DUMMY_JPEG), "image/jpeg")}
    form_data = {
        "lat": "17.46821",
        "lng": "78.36184",
        "accuracy": "8.5",
        "timestamp": now_iso,
        "categoryId": "green",
        "taskId": task_id,
        "note": "Planted a native sapling near the walkway. Well watered.",
        "address": "Kondapur Lake Trail, Ward 104",
    }
    r_sub = client.post("/submissions", data=form_data, files=files, headers=headers)
    sub_data = pp("Step 3: POST /submissions (Submit live photo with GPS & timestamp)", r_sub)
    if r_sub.status_code != 201:
        print("Submission failed, aborting.")
        sys.exit(1)

    sub_id = sub_data["id"]
    print(f"  -> Submission Created: ID={sub_id}, Status={sub_data['status']}")

    # ── Step 4: Get Submission Status & Timeline ──────────────────────────────
    r_detail = client.get(f"/submissions/{sub_id}", headers=headers)
    pp(f"Step 4: GET /submissions/{sub_id} (Retrieve audit status and timeline)", r_detail)

    # ── Step 5: Download Submitted Photo ──────────────────────────────────────
    r_photo = client.get(f"/submissions/{sub_id}/photo", headers=headers)
    pp(f"Step 5: GET /submissions/{sub_id}/photo (Download stored image)", r_photo)

print("\n" + "="*70)
print("  CITIZEN TASKS & SUBMISSIONS DEMO COMPLETED SUCCESSFULLY!")
print("="*70)
