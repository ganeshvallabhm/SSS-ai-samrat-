#!/usr/bin/env python3
"""Seed reference data from db/seed_reference.sql into PostgreSQL."""

import sys
from pathlib import Path
import sqlalchemy as sa

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parents[1]
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.config import settings


def find_seed_sql() -> Path:
    candidates = [
        Path("/db/seed_reference.sql"),
        Path(__file__).resolve().parents[2] / "db" / "seed_reference.sql",
        Path(__file__).resolve().parents[1] / "db" / "seed_reference.sql",
        Path("db/seed_reference.sql"),
        Path("../db/seed_reference.sql"),
    ]
    for path in candidates:
        if path.exists():
            return path
    raise FileNotFoundError("Could not find db/seed_reference.sql in candidate paths.")


def seed_reference_data():
    seed_path = find_seed_sql()
    print(f"Loading reference seed data from: {seed_path}")

    with open(seed_path, "r", encoding="utf-8-sig") as f:
        sql = f.read()

    engine = sa.create_engine(settings.sync_database_url)
    with engine.begin() as conn:
        raw_conn = conn.connection
        cur = raw_conn.cursor()
        cur.execute(sql)
        cur.close()

        config_count = conn.execute(sa.text("SELECT count(*) FROM app_config")).scalar()
        cat_count = conn.execute(sa.text("SELECT count(*) FROM task_categories")).scalar()
        voucher_count = conn.execute(sa.text("SELECT count(*) FROM vouchers")).scalar()
        ward_count = conn.execute(sa.text("SELECT count(*) FROM wards")).scalar()

    print("Reference seed data loaded successfully!")
    print(f" - app_config rows: {config_count}")
    print(f" - task_categories rows: {cat_count}")
    print(f" - vouchers rows: {voucher_count}")
    print(f" - wards rows: {ward_count}")


if __name__ == "__main__":
    seed_reference_data()
