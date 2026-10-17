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
- `points_ledger` is append-only (trigger `trg_ledger_immutable`)
- Monthly earning cap computed in IST (`Asia/Kolkata`) timezone
- Redemptions require an `idempotency_key` UUID (UNIQUE constraint)
- GPS accuracy enforced: `accuracy_m <= 50m` (CHECK constraint)
- Phone numbers: 10-digit Indian mobile format (regex CHECK)

---

## Authentication Flow

All auth endpoints are under `/api/v1/auth/`. Phone numbers are accepted as `+91XXXXXXXXXX`, `91XXXXXXXXXX`, or `XXXXXXXXXX` (10 digits). Indian numbers only (prefix 6–9).

### OTP Request + Verify

```
Client                                 API
  │                                     │
  │  POST /auth/otp/request             │
  │  { "phone": "+919876543210" }       │
  │ ──────────────────────────────────► │
  │                                     │── generate CSPRNG 6-digit code
  │                                     │── store HMAC-SHA256(code, OTP_HMAC_SECRET)
  │                                     │── send via SmsProvider
  │  200 { message, expiresInSeconds }  │
  │ ◄────────────────────────────────── │
  │                                     │
  │  POST /auth/otp/verify              │
  │  { "phone": "...", "code": "..." }  │
  │ ──────────────────────────────────► │
  │                                     │── constant-time compare(HMAC(code), stored)
  │                                     │── upsert user (citizen on first verify)
  │                                     │── issue JWT access token (15 min)
  │                                     │── issue opaque refresh token (30 days)
  │  200 { user, accessToken, ...}      │
  │ ◄────────────────────────────────── │
```

**Security properties:**
- Plain OTP code is **never stored or logged** — only `HMAC-SHA256(code, OTP_HMAC_SECRET)`
- Constant-time comparison prevents timing attacks
- 30-second per-phone cooldown (R-017)
- 5 max attempts per OTP row; 6th returns 401 without incrementing (R-018)
- 10 OTP requests per hour per IP (replaceable service in `app/services/otp.py`)
- Same response shape for existing and non-existing phone numbers (no user enumeration)
- OTP expires after `OTP_TTL_SECONDS` seconds (default 5 min, R-034)
- Single-use: `used_at` is set on success (R-035)

### Token Lifecycle

| Operation | Endpoint | Effect |
|---|---|---|
| Login | `POST /auth/otp/verify` | Issues access + refresh tokens |
| Refresh | `POST /auth/refresh` | Rotates: revokes old, issues new |
| Logout | `POST /auth/logout` | Revokes supplied refresh token |
| Reuse detection | `POST /auth/refresh` | If revoked token presented, ALL tokens for that user are revoked → 401 |

**JWT access token** (`Authorization: Bearer <token>`):
- Claims: `sub` (user UUID), `role`, `jti` (unique per token)
- TTL: `JWT_ACCESS_TTL_SECONDS` (default 900 s / 15 min)

**Refresh token** (opaque, URL-safe random string):
- Only `SHA-256(token)` stored in `refresh_tokens.token_hash`
- TTL: `JWT_REFRESH_TTL_DAYS` (default 30 days)
- Rotation: each refresh creates a new row and revokes the old one

### Role-Based Access Control

| Role | Created via | Access |
|---|---|---|
| `citizen` | First OTP verify (public API) | Own submissions, wallet, vouchers |
| `reviewer` | `scripts/create_staff.py` only | Review queue, approve/reject |
| `admin` | `scripts/create_staff.py` only | KPIs, analytics |

Middleware: `get_current_user` dependency (401 on invalid/missing/expired token).  
Factory: `require_role("reviewer")` (403 on wrong role).

---

## Staff Management (`create_staff.py`)

Reviewer and admin accounts are **never** created through the public API.
Use this script (run inside the api container):

```bash
# Create a reviewer account
wsl docker compose exec api python scripts/create_staff.py \
  --phone 9876543210 \
  --name "Priya Sharma" \
  --role reviewer

# Create an admin account
wsl docker compose exec api python scripts/create_staff.py \
  --phone 9876543211 \
  --name "Admin User" \
  --role admin
```

**Rules:**
- `--phone` must be exactly 10 digits (no +91 prefix)
- `--role` must be `reviewer` or `admin`
- If the phone already exists as a citizen, the script refuses (prevents accidental escalation)
- If the phone already exists as reviewer/admin, the name/role is updated

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | Async PostgreSQL URL (`postgresql+asyncpg://...`) | — |
| `DATABASE_URL_SYNC` | Sync URL for Alembic (`postgresql+psycopg2://...`) | — |
| `JWT_SECRET` | HS256 signing key (≥32 chars) | — |
| `JWT_ACCESS_TTL_SECONDS` | Access token lifetime (seconds) | `900` |
| `JWT_REFRESH_TTL_DAYS` | Refresh token lifetime (days) | `30` |
| `OTP_HMAC_SECRET` | HMAC-SHA256 key for OTP hashing — generate with:<br>`python -c "import secrets; print(secrets.token_hex(32))"` | — |
| `OTP_TTL_SECONDS` | OTP expiry (seconds) | `300` |
| `OTP_MAX_ATTEMPTS` | Max wrong OTP attempts per row | `5` |
| `OTP_COOLDOWN_SECONDS` | Per-phone resend cooldown | `30` |
| `OTP_IP_LIMIT_PER_HOUR` | Per-IP OTP requests per hour | `10` |
| `VOUCHER_ENCRYPTION_KEY` | AES-256-GCM key (hex, 64 chars) | — |
| `UPLOAD_DIR` | Photo upload directory | `./uploads` |
| `ENVIRONMENT` | `development` \| `production` | `development` |

> **Never commit `.env`**. Only commit `.env.example` with placeholder values.
> In `ENVIRONMENT=production` the app **refuses to start** with MockSmsProvider.

---

## SMS Provider

`app/services/sms.py` defines `SmsProvider` (abstract) and `MockSmsProvider` (development).

- **Development**: `MockSmsProvider` accepts any 6-digit code **except** `000000` (always-fail sentinel for tests)
- **Production**: Wire a real SMS provider by implementing `SmsProvider.send_otp()` and updating `get_sms_provider()`
- The app calls `get_sms_provider(settings.ENVIRONMENT)` at startup; in production it raises `RuntimeError` if only mock is available

---

## Audit Log

Every auth event writes to `audit_log`:

| Action | Trigger |
|---|---|
| `otp_requested` | Successful OTP dispatch |
| `login_success` | Successful OTP verify + token issue |
| `login_failed` | Invalid/expired/used OTP |
| `token_refreshed` | Successful refresh rotation |
| `token_reuse_detected` | Revoked refresh token presented again |
| `logout` | Explicit logout |

OTP codes and tokens are **never** stored in `audit_log.details`.
