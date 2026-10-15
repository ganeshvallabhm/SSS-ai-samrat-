# SSS Civic Tech — Backend

FastAPI + SQLAlchemy 2 + Alembic backend for the SSS Civic Tech platform.

## Stack

| Layer | Technology |
|---|---|
| Runtime | Python 3.12 |
| Framework | FastAPI 0.115 |
| ORM | SQLAlchemy 2 (async) |
| Migrations | Alembic 1.13 |
| Database | PostgreSQL 16 + PostGIS 3.4 |
| Config | pydantic-settings 2 |
| Tests | pytest + pytest-asyncio + httpx |
| Container | Docker + Docker Compose |

## Prerequisites

- **Docker Desktop** (Windows/macOS) or **Docker Engine** (Linux/WSL2)
- **Python 3.12** (for running outside container)

---

## Quick Start

### Windows (PowerShell via WSL2)

```powershell
# 1. Start Docker daemon in WSL2 (if using raw WSL, not Docker Desktop)
wsl -d Ubuntu -e sudo service docker start

# 2. Copy environment file and set secrets
Copy-Item .env.example .env
# Edit .env and set real JWT_SECRET and VOUCHER_ENCRYPTION_KEY

# 3. Start PostgreSQL + API
wsl -d Ubuntu -e sh -c "cd /mnt/c/path/to/civic-spark-main && docker compose up -d"

# 4. Run initial migration
wsl -d Ubuntu -e sh -c "cd /mnt/c/path/to/civic-spark-main && docker compose exec api alembic upgrade head"

# 5. Seed reference data
wsl -d Ubuntu -e sh -c "cd /mnt/c/path/to/civic-spark-main && docker compose exec api python scripts/seed_reference.py"

# 6. Verify health
curl http://localhost:8000/health
```

### macOS / Linux

```bash
# 1. Copy and edit environment variables
cp .env.example .env
# Set JWT_SECRET and VOUCHER_ENCRYPTION_KEY

# 2. Start services
docker compose up -d

# 3. Run migrations
docker compose exec api alembic upgrade head

# 4. Seed reference data
docker compose exec api python scripts/seed_reference.py

# 5. Verify
curl http://localhost:8000/health
```

Expected `/health` response:
```json
{
  "status": "ok",
  "database": "connected",
  "postgis": "POSTGIS=\"3.4.x ...\"",
  "environment": "development"
}
```

---

## Project Structure

```
backend/
├── app/
│   ├── main.py          # FastAPI app, CORS, router registration
│   ├── config.py        # pydantic-settings Settings class
│   ├── db.py            # SQLAlchemy async engine + session factory
│   ├── routers/
│   │   ├── __init__.py
│   │   └── health.py    # GET /health
│   ├── models/          # SQLAlchemy ORM models (future)
│   ├── schemas/         # Pydantic request/response schemas (future)
│   ├── services/        # Business logic layer (future)
│   └── core/            # Auth, security utilities (future)
├── alembic/
│   ├── env.py
│   ├── script.py.mako
│   └── versions/
│       └── 0001_initial_schema.py   # Applies db/schema.sql
├── scripts/
│   └── seed_reference.py            # Loads db/seed_reference.sql
├── tests/
│   ├── conftest.py       # Fixtures (engine, async client)
│   └── test_schema.py    # Schema, trigger, health tests
├── Dockerfile
├── requirements.txt
├── alembic.ini
├── pytest.ini
└── README.md
```

---

## Running Tests

### Inside Docker (recommended)

```bash
# macOS / Linux
docker compose exec api pytest tests/ -v

# Windows PowerShell
wsl -d Ubuntu -e sh -c "cd /mnt/c/path/to/civic-spark-main && docker compose exec api pytest tests/ -v"
```

### Locally (outside Docker)

```bash
# Install dependencies
pip install -r requirements.txt

# Set DATABASE_URL pointing to local or Docker Postgres
export DATABASE_URL="postgresql+asyncpg://postgres:postgrespassword@localhost:5432/civic_spark"

# Run tests
cd backend
pytest tests/ -v
```

---

## Environment Variables

| Variable | Description | Example |
|---|---|---|
| `DATABASE_URL` | Async PostgreSQL URL | `postgresql+asyncpg://user:pass@db:5432/civic_spark` |
| `DATABASE_URL_SYNC` | Sync URL for Alembic | `postgresql://user:pass@db:5432/civic_spark` |
| `JWT_SECRET` | HS256 signing key (≥32 chars) | `some-long-random-secret` |
| `VOUCHER_ENCRYPTION_KEY` | AES-256-GCM key (hex, 64 chars) | `0123...abcdef` |
| `UPLOAD_DIR` | Photo upload directory | `/app/uploads` |
| `ENVIRONMENT` | `development` \| `production` \| `test` | `development` |

> **Never commit `.env`**. Only commit `.env.example` with placeholder values.

---

## Migrations

```bash
# Apply all pending migrations
alembic upgrade head

# Show migration history
alembic history

# Rollback one step
alembic downgrade -1

# Rollback all (drops all tables)
alembic downgrade base
```

---

## API Documentation

When running in `development`, interactive docs are available at:
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc
- **OpenAPI JSON**: http://localhost:8000/openapi.json

Full contract: [`docs/api-contract.yaml`](../docs/api-contract.yaml)

---

## Business Rules

See [`docs/rules.md`](../docs/rules.md) for all numbered business rules (R-001 through R-040).

Key constraints enforced at the database level:
- `points_ledger` is append-only (trigger `trg_ledger_immutable`)
- Monthly earning cap computed in IST (`Asia/Kolkata`) timezone
- Redemptions require an `idempotency_key` UUID (UNIQUE constraint)
- GPS accuracy enforced: `accuracy_m <= 50m` (CHECK constraint)
- Phone numbers: 10-digit Indian mobile format (regex CHECK)
