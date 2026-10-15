"""Initial database schema from db/schema.sql

Revision ID: 0001_initial_schema
Revises: 
Create Date: 2026-10-12 16:30:00.000000

"""
from pathlib import Path
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '0001_initial_schema'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def find_schema_sql() -> Path:
    candidates = [
        Path("/db/schema.sql"),
        Path(__file__).resolve().parents[3] / "db" / "schema.sql",
        Path(__file__).resolve().parents[2] / "db" / "schema.sql",
        Path("db/schema.sql"),
        Path("../db/schema.sql"),
    ]
    for path in candidates:
        if path.exists():
            return path
    raise FileNotFoundError("Could not find db/schema.sql in any expected candidate path.")


def upgrade() -> None:
    schema_path = find_schema_sql()
    with open(schema_path, "r", encoding="utf-8") as f:
        sql = f.read()

    connection = op.get_bind()
    # Execute raw schema SQL via DBAPI cursor to avoid bind parameter issues
    raw_conn = connection.connection
    cursor = raw_conn.cursor()
    cursor.execute(sql)
    cursor.close()


def downgrade() -> None:
    drop_sql = """
    DROP VIEW IF EXISTS v_wallet_balance CASCADE;
    DROP VIEW IF EXISTS v_monthly_points_earned CASCADE;
    DROP MATERIALIZED VIEW IF EXISTS mv_ward_stats CASCADE;
    DROP TABLE IF EXISTS audit_log CASCADE;
    DROP TABLE IF EXISTS survey_responses CASCADE;
    DROP TABLE IF EXISTS survey_questions CASCADE;
    DROP TABLE IF EXISTS surveys CASCADE;
    DROP TABLE IF EXISTS notifications CASCADE;
    DROP TABLE IF EXISTS points_ledger CASCADE;
    DROP TABLE IF EXISTS redemptions CASCADE;
    DROP TABLE IF EXISTS vouchers CASCADE;
    DROP TABLE IF EXISTS reviews CASCADE;
    DROP TABLE IF EXISTS submission_events CASCADE;
    DROP TABLE IF EXISTS submissions CASCADE;
    DROP TABLE IF EXISTS tasks CASCADE;
    DROP TABLE IF EXISTS refresh_tokens CASCADE;
    DROP TABLE IF EXISTS otp_requests CASCADE;
    DROP TABLE IF EXISTS users CASCADE;
    DROP TABLE IF EXISTS task_categories CASCADE;
    DROP TABLE IF EXISTS wards CASCADE;
    DROP TABLE IF EXISTS app_config CASCADE;
    DROP TYPE IF EXISTS survey_status CASCADE;
    DROP TYPE IF EXISTS survey_question_type CASCADE;
    DROP TYPE IF EXISTS redemption_status CASCADE;
    DROP TYPE IF EXISTS voucher_status CASCADE;
    DROP TYPE IF EXISTS voucher_brand CASCADE;
    DROP TYPE IF EXISTS notification_type CASCADE;
    DROP TYPE IF EXISTS ledger_type CASCADE;
    DROP TYPE IF EXISTS task_category_slug CASCADE;
    DROP TYPE IF EXISTS task_status CASCADE;
    DROP TYPE IF EXISTS submission_status CASCADE;
    DROP TYPE IF EXISTS user_status CASCADE;
    DROP TYPE IF EXISTS user_role CASCADE;
    DROP FUNCTION IF EXISTS trg_points_ledger_immutable() CASCADE;
    DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
    """
    connection = op.get_bind()
    connection.execute(sa.text(drop_sql))
