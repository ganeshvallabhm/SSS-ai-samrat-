import pytest
import sqlalchemy as sa
from sqlalchemy.exc import DBAPIError, InternalError
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_schema_applied_to_database(async_db):
    """(a) Test that schema applied all required tables, views, and extensions."""
    # Check PostGIS extension
    postgis_ver = await async_db.execute(sa.text("SELECT PostGIS_Version()"))
    assert postgis_ver.scalar() is not None

    # Check key tables exist
    query = sa.text("""
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
    """)
    result = await async_db.execute(query)
    existing_tables = {row[0] for row in result.fetchall()}

    expected_tables = {
        "app_config",
        "wards",
        "task_categories",
        "users",
        "otp_requests",
        "refresh_tokens",
        "tasks",
        "submissions",
        "submission_events",
        "reviews",
        "points_ledger",
        "vouchers",
        "redemptions",
        "notifications",
        "surveys",
        "survey_questions",
        "survey_responses",
        "audit_log",
    }
    for table in expected_tables:
        assert table in existing_tables, f"Table {table} should exist in public schema"

    # Check views exist
    view_query = sa.text("""
        SELECT table_name 
        FROM information_schema.views 
        WHERE table_schema = 'public'
    """)
    v_res = await async_db.execute(view_query)
    existing_views = {row[0] for row in v_res.fetchall()}
    assert "v_wallet_balance" in existing_views
    assert "v_monthly_points_earned" in existing_views


@pytest.mark.asyncio
async def test_ledger_immutability_trigger(async_db):
    """(b) Test that UPDATE and DELETE on points_ledger are strictly rejected by the trigger."""
    # We run inside an isolated transaction that rolls back at the end
    # First, insert a temporary test user
    user_res = await async_db.execute(sa.text("""
        INSERT INTO users (phone, name, role)
        VALUES ('9999999999', 'Trigger Test User', 'citizen')
        ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
    """))
    user_id = user_res.scalar()

    # Insert a ledger entry
    ledger_res = await async_db.execute(sa.text("""
        INSERT INTO points_ledger (user_id, amount, type, description)
        VALUES (:user_id, 50, 'earned', 'Test points for trigger verification')
        RETURNING id
    """), {"user_id": user_id})
    ledger_id = ledger_res.scalar()
    assert ledger_id is not None

    # Verify UPDATE is rejected by trigger
    with pytest.raises((DBAPIError, InternalError)) as exc_info_update:
        # Use savepoint so transaction isn't aborted for the next test
        async with async_db.begin_nested():
            await async_db.execute(sa.text("""
                UPDATE points_ledger
                SET amount = 999
                WHERE id = :id
            """), {"id": ledger_id})

    assert "points_ledger is append-only" in str(exc_info_update.value).lower() or \
           "updates are forbidden" in str(exc_info_update.value).lower()

    # Verify DELETE is rejected by trigger
    with pytest.raises((DBAPIError, InternalError)) as exc_info_delete:
        async with async_db.begin_nested():
            await async_db.execute(sa.text("""
                DELETE FROM points_ledger
                WHERE id = :id
            """), {"id": ledger_id})

    assert "points_ledger is append-only" in str(exc_info_delete.value).lower() or \
           "deletes are forbidden" in str(exc_info_delete.value).lower()

    # Clean rollback
    await async_db.rollback()


@pytest.mark.asyncio
async def test_health_endpoint(client: AsyncClient):
    """(c) Test GET /health endpoint returns 200, status ok, and PostGIS info."""
    response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["database"] == "connected"
    assert "postgis" in data
    assert "POSTGIS" in data["postgis"] or "3." in data["postgis"]
