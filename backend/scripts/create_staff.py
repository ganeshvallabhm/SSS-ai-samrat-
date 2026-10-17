#!/usr/bin/env python3
"""
create_staff.py — Create a reviewer or admin account.

Reviewer and admin accounts are NEVER created through the public API.
Use this script (run inside the api container or with local DB access).

Usage:
    python scripts/create_staff.py --phone 9876543210 --name "Priya Sharma" --role reviewer
    python scripts/create_staff.py --phone 9876543211 --name "Admin User"   --role admin

The phone must be a 10-digit Indian mobile number (no +91 prefix).
"""
import argparse
import asyncio
import sys
from pathlib import Path

# Allow running from repo root: python backend/scripts/create_staff.py
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.config import settings
from app.models.auth import User, UserRole, UserStatus


async def create_staff(phone: str, name: str, role: str) -> None:
    if role not in ("reviewer", "admin"):
        print(f"ERROR: role must be 'reviewer' or 'admin', got {role!r}", file=sys.stderr)
        sys.exit(1)

    if not phone.isdigit() or len(phone) != 10:
        print("ERROR: phone must be exactly 10 digits (no +91 prefix)", file=sys.stderr)
        sys.exit(1)

    engine = create_async_engine(settings.DATABASE_URL, future=True)
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with Session() as db:
        result = await db.execute(sa.select(User).where(User.phone == phone))
        existing = result.scalar_one_or_none()

        if existing is not None:
            if existing.role.value not in ("reviewer", "admin"):
                print(
                    f"ERROR: {phone} already exists as role={existing.role.value}. "
                    "Cannot change a citizen to staff via this script.",
                    file=sys.stderr,
                )
                sys.exit(1)
            # Update name / role
            existing.name = name
            existing.role = UserRole(role)
            await db.commit()
            print(f"Updated existing user {existing.id} → name={name!r}, role={role}")
        else:
            user = User(
                phone=phone,
                name=name,
                role=UserRole(role),
                status=UserStatus.active,
                language="en",
            )
            db.add(user)
            await db.commit()
            await db.refresh(user)
            print(f"Created {role} account: id={user.id}, phone={phone}, name={name!r}")

    await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a staff (reviewer/admin) account")
    parser.add_argument("--phone", required=True, help="10-digit Indian mobile number")
    parser.add_argument("--name", required=True, help="Full name")
    parser.add_argument("--role", required=True, choices=["reviewer", "admin"], help="Staff role")
    args = parser.parse_args()
    asyncio.run(create_staff(args.phone, args.name, args.role))


if __name__ == "__main__":
    main()
