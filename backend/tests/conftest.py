import re
from pathlib import Path
import pytest
import sqlalchemy as sa
from sqlalchemy.pool import NullPool
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from httpx import AsyncClient, ASGITransport

from app.config import settings
from app.main import app
from app.db import get_db


def get_test_urls():
    """Derive isolated test database URLs from app settings."""
    async_base = re.sub(r'/[a-zA-Z0-9_\-]+(\?.*)?$', '', settings.DATABASE_URL)
    sync_base = re.sub(r'/[a-zA-Z0-9_\-]+(\?.*)?$', '', settings.sync_database_url)

    test_async_url = f"{async_base}/civic_spark_test"
    test_sync_url = f"{sync_base}/civic_spark_test"
    maintenance_sync_url = f"{sync_base}/postgres"
    return test_async_url, test_sync_url, maintenance_sync_url


TEST_ASYNC_URL, TEST_SYNC_URL, MAINTENANCE_SYNC_URL = get_test_urls()


def find_schema_sql() -> Path:
    candidates = [
        Path("/db/schema.sql"),
        Path(__file__).resolve().parents[2] / "db" / "schema.sql",
        Path(__file__).resolve().parents[1] / "db" / "schema.sql",
        Path("db/schema.sql"),
    ]
    for p in candidates:
        if p.exists():
            return p
    raise FileNotFoundError("Could not find db/schema.sql in expected paths")


@pytest.fixture(scope="session", autouse=True)
def setup_test_database():
    """Create isolated civic_spark_test database and apply schema if missing."""
    # 1. Connect to PostgreSQL maintenance database and ensure civic_spark_test exists
    m_engine = sa.create_engine(MAINTENANCE_SYNC_URL, isolation_level="AUTOCOMMIT")
    with m_engine.connect() as conn:
        db_exists = conn.execute(
            sa.text("SELECT 1 FROM pg_database WHERE datname = 'civic_spark_test'")
        ).scalar()
        if not db_exists:
            conn.execute(sa.text("CREATE DATABASE civic_spark_test"))
    m_engine.dispose()

    # 2. Apply schema.sql to civic_spark_test if not already applied
    t_engine = sa.create_engine(TEST_SYNC_URL, isolation_level="AUTOCOMMIT")
    with t_engine.connect() as conn:
        users_exist = conn.execute(
            sa.text("SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users'")
        ).scalar()
        if not users_exist:
            schema_file = find_schema_sql()
            with open(schema_file, "r", encoding="utf-8") as f:
                sql = f.read()
            raw_conn = conn.connection
            cur = raw_conn.cursor()
            cur.execute(sql)
            cur.close()

    yield

    t_engine.dispose()


@pytest.fixture
async def async_engine():
    """Create a new async engine per test with NullPool to prevent event-loop binding issues."""
    engine = create_async_engine(TEST_ASYNC_URL, poolclass=NullPool, future=True)
    yield engine
    await engine.dispose()


@pytest.fixture
async def async_db(async_engine):
    """Create an isolated async session per test function with automatic rollback."""
    session_factory = async_sessionmaker(
        bind=async_engine,
        autocommit=False,
        autoflush=False,
        expire_on_commit=False,
        class_=AsyncSession,
    )
    async with session_factory() as session:
        yield session
        await session.rollback()


@pytest.fixture
async def client(async_db):
    """Async test client bound to the isolated test database session."""
    async def override_get_db():
        yield async_db

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
