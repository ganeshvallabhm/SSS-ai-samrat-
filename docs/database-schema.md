# SSS Civic Tech — Database Schema

> **Engine**: PostgreSQL 16 + PostGIS 3  
> **Schema file**: [`db/schema.sql`](../db/schema.sql)  
> **Seed file**: [`db/seed_reference.sql`](../db/seed_reference.sql)

---

## Table Count

| Category | Tables |
| :--- | :--- |
| Config | `app_config` |
| Geography | `wards` |
| Reference | `task_categories` |
| Auth | `users`, `otp_requests`, `refresh_tokens` |
| Tasks | `tasks` |
| Submissions | `submissions`, `submission_events`, `reviews` |
| Economy | `points_ledger`, `vouchers`, `redemptions` |
| Engagement | `notifications`, `surveys`, `survey_questions`, `survey_responses` |
| Ops | `audit_log` |
| **Total** | **18 tables** |

Plus 2 live views (`v_wallet_balance`, `v_monthly_points_earned`) and 1 materialized view (`mv_ward_stats`).

---

## ER Diagram

```mermaid
erDiagram
    wards {
        UUID id PK
        TEXT name
        TEXT city
        INTEGER number
        geography boundary
        geography centroid
        BOOLEAN is_active
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }

    task_categories {
        task_category_slug id PK
        TEXT label
        TEXT short_label
        TEXT icon_name
    }

    app_config {
        TEXT key PK
        TEXT value
        TEXT description
        TIMESTAMPTZ updated_at
    }

    users {
        UUID id PK
        TEXT phone UK
        TEXT name
        user_role role
        user_status status
        UUID ward_id FK
        TEXT language
        NUMERIC trust_score
        TIMESTAMPTZ consent_accepted_at
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }

    otp_requests {
        UUID id PK
        TEXT phone
        TEXT code_hash
        TIMESTAMPTZ expires_at
        SMALLINT attempts
        TIMESTAMPTZ used_at
        INET ip_address
        TIMESTAMPTZ created_at
    }

    refresh_tokens {
        UUID id PK
        UUID user_id FK
        TEXT token_hash UK
        TIMESTAMPTZ issued_at
        TIMESTAMPTZ expires_at
        TIMESTAMPTZ revoked_at
        INET ip_address
        TEXT user_agent
    }

    tasks {
        UUID id PK
        TEXT title
        TEXT description
        TEXT[] requirements
        task_category_slug category_id FK
        UUID ward_id FK
        INTEGER points_reward
        geography required_location
        INTEGER geofence_radius_m
        TEXT location_label
        DATE deadline
        task_status status
        UUID created_by FK
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }

    submissions {
        UUID id PK
        UUID user_id FK
        UUID task_id FK
        task_category_slug category_id FK
        submission_status status
        TEXT photo_url
        TEXT photo_thumbnail_url
        TEXT photo_sha256
        geography location
        NUMERIC accuracy_m
        TIMESTAMPTZ captured_at
        TIMESTAMPTZ received_at
        TEXT area_name
        TEXT note
        JSONB fraud_flags
        UUID resubmission_of FK
        TEXT idempotency_key UK
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }

    submission_events {
        UUID id PK
        UUID submission_id FK
        submission_status status
        UUID actor_id FK
        TEXT actor_label
        TEXT reason
        TEXT internal_notes
        TIMESTAMPTZ created_at
    }

    reviews {
        UUID id PK
        UUID submission_id FK UK
        UUID reviewer_id FK
        TEXT decision
        TEXT reason
        TEXT internal_notes
        INTEGER awarded_points
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }

    points_ledger {
        UUID id PK
        UUID user_id FK
        INTEGER amount
        ledger_type type
        UUID submission_id FK
        UUID redemption_id FK
        TEXT description
        TIMESTAMPTZ created_at
    }

    vouchers {
        UUID id PK
        voucher_brand brand
        INTEGER denomination_inr
        INTEGER points_cost
        voucher_status status
        TEXT provider_sku
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }

    redemptions {
        UUID id PK
        UUID user_id FK
        UUID voucher_id FK
        INTEGER points_spent
        BYTEA code_encrypted
        TEXT provider_ref
        TEXT barcode_data
        TEXT qr_code_data
        TIMESTAMPTZ expires_at
        redemption_status status
        TEXT idempotency_key UK
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }

    notifications {
        UUID id PK
        UUID user_id FK
        notification_type type
        TEXT title
        TEXT message
        UUID submission_id FK
        UUID redemption_id FK
        TIMESTAMPTZ read_at
        TIMESTAMPTZ created_at
    }

    surveys {
        UUID id PK
        TEXT title
        TEXT description
        UUID ward_id FK
        INTEGER points
        survey_status status
        TIMESTAMPTZ expires_at
        UUID created_by FK
        TIMESTAMPTZ created_at
        TIMESTAMPTZ updated_at
    }

    survey_questions {
        UUID id PK
        UUID survey_id FK
        SMALLINT sort_order
        TEXT prompt
        survey_question_type type
        TEXT[] options
        BOOLEAN is_required
        TIMESTAMPTZ created_at
    }

    survey_responses {
        UUID id PK
        UUID survey_id FK
        UUID user_id FK
        UUID question_id FK
        TEXT answer_text
        TEXT[] answer_options
        SMALLINT answer_rating
        INTEGER points_awarded
        TIMESTAMPTZ created_at
    }

    audit_log {
        BIGINT id PK
        UUID actor_id FK
        TEXT action
        TEXT entity
        UUID entity_id
        JSONB details
        INET ip_address
        TIMESTAMPTZ created_at
    }

    wards ||--o{ users : "ward_id"
    wards ||--o{ tasks : "ward_id"
    wards ||--o{ surveys : "ward_id"

    users ||--o{ refresh_tokens : "user_id"
    users ||--o{ submissions : "user_id"
    users ||--o{ reviews : "reviewer_id"
    users ||--o{ points_ledger : "user_id"
    users ||--o{ redemptions : "user_id"
    users ||--o{ notifications : "user_id"
    users ||--o{ survey_responses : "user_id"
    users ||--o{ audit_log : "actor_id"

    task_categories ||--o{ tasks : "category_id"
    task_categories ||--o{ submissions : "category_id"

    tasks ||--o{ submissions : "task_id"

    submissions ||--o{ submission_events : "submission_id"
    submissions ||--|| reviews : "submission_id"
    submissions ||--o{ points_ledger : "submission_id"
    submissions ||--o{ notifications : "submission_id"
    submissions ||--o{ submissions : "resubmission_of"

    vouchers ||--o{ redemptions : "voucher_id"

    redemptions ||--o{ points_ledger : "redemption_id"
    redemptions ||--o{ notifications : "redemption_id"

    surveys ||--o{ survey_questions : "survey_id"
    surveys ||--o{ survey_responses : "survey_id"
    survey_questions ||--o{ survey_responses : "question_id"
```

---

## Endpoint → Table Mapping

> **Legend**: R = Read, W = Write, R/W = Both  
> ⚠️ = contract field that had no schema home → fixed (see notes column)

### Auth

| Endpoint | Method | Tables Read | Tables Written | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `/auth/otp/request` | POST | `otp_requests` (rate-check) | `otp_requests` | — |
| `/auth/otp/verify` | POST | `otp_requests`, `users` | `users` (upsert), `refresh_tokens`, `audit_log` | Creates user on first login |
| `/auth/refresh` | POST | `refresh_tokens` | `refresh_tokens` (new row + revoke old) | — |
| `/auth/logout` | POST | `refresh_tokens` | `refresh_tokens` (set `revoked_at`) | — |

### Tasks

| Endpoint | Method | Tables Read | Tables Written | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `GET /tasks` | GET | `tasks`, `task_categories`, `wards` | — | ⚠️ `distance` field computed via `ST_Distance(tasks.required_location, user_point)` — not stored |
| `GET /tasks/{taskId}` | GET | `tasks`, `task_categories`, `wards` | — | — |

> **Contract fix ①**: `Task.distance` is a computed field (PostGIS). It has no home in the schema — this is correct and intentional; it is not persisted.  
> **Contract fix ②**: `Task.location` (string label) maps to `tasks.location_label` (TEXT). The schema adds `tasks.required_location` (geography) and `tasks.geofence_radius_m` which are not in the current contract — these were added to the schema to support geofence verification.

### Submissions

| Endpoint | Method | Tables Read | Tables Written | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `POST /submissions` | POST | `tasks`, `users`, `v_monthly_points_earned`, `v_wallet_balance` | `submissions`, `submission_events`, `audit_log` | ⚠️ `address` field maps to `submissions.area_name` (renamed for clarity — contract uses `address`) |
| `GET /submissions/mine` | GET | `submissions`, `tasks` | — | — |
| `GET /submissions/{id}` | GET | `submissions`, `submission_events`, `reviews`, `tasks` | — | `timeline` field = `submission_events` rows |
| `POST /submissions/{id}/resubmit` | POST | `submissions` (status check) | `submissions` (new row), `submission_events`, `audit_log` | New row created; `resubmission_of` set to original `id` |

> **Contract fix ③**: `SubmissionDetail.reviewedAt` maps to `reviews.created_at`. The schema separates the review timestamp from the submission timestamp — no change needed.  
> **Contract fix ④**: `SubmissionDetail.reason` maps to `reviews.reason` (publicly visible rejection feedback). `reviews.internal_notes` is reviewer-only and **not** exposed in the citizen API response.

### Wallet

| Endpoint | Method | Tables Read | Tables Written | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `GET /wallet` | GET | `v_wallet_balance`, `v_monthly_points_earned` | — | `balance` and `monthlyPoints` come from views |
| `GET /wallet/transactions` | GET | `points_ledger`, `submissions`, `redemptions` | — | `title` field must be derived (task title or voucher label) — see note ⑤ |
| `GET /wallet/redemptions` | GET | `redemptions`, `vouchers` | — | `code` field is decrypted transiently from `redemptions.code_encrypted` |

> **Contract fix ⑤**: `PointsTransaction.title` (e.g. "Neighbourhood tree care") has no dedicated column. The schema's `points_ledger.description` field stores this string. Application layer must populate `description` at insert time. Added `description TEXT NOT NULL DEFAULT ''` to `points_ledger`.

### Vouchers

| Endpoint | Method | Tables Read | Tables Written | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `GET /vouchers` | GET | `vouchers` | — | — |
| `GET /vouchers/{id}` | GET | `vouchers` | — | — |
| `POST /vouchers/{id}/redeem` | POST | `vouchers`, `v_wallet_balance` (balance check) | `redemptions`, `points_ledger`, `notifications`, `audit_log` | Runs in single DB transaction; `idempotency_key` in body mapped to `redemptions.idempotency_key` |

> **Contract fix ⑥**: `RedeemRequest` has only `brand`. Added `idempotency_key` (UUID string) to the contract's `RedeemRequest` body — the schema's `redemptions.idempotency_key` UNIQUE constraint depends on it. **This is a schema-driven contract addition.**  
> **Contract fix ⑦**: `Redemption.code` (plain string in contract) maps to `redemptions.code_encrypted` (BYTEA). The application layer decrypts and returns only the plaintext `code` field.

### Reviewer

| Endpoint | Method | Tables Read | Tables Written | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `GET /reviewer/queue` | GET | `submissions`, `tasks`, `task_categories`, `users`, `wards` | — | `distanceKm` is computed, not stored |
| `GET /reviewer/submissions/{id}` | GET | `submissions`, `submission_events`, `reviews`, `tasks`, `users` | — | `trustScore` comes from `users.trust_score` |
| `POST /reviewer/submissions/{id}/review` | POST | `submissions`, `tasks`, `v_wallet_balance` | `reviews`, `submissions` (status update), `submission_events`, `points_ledger` (if approve), `notifications`, `audit_log` | All writes in one transaction |

> **Contract fix ⑧**: `ReviewAuditDetail.verificationChecks.gpsWithinGeofence` is computed at review time via `ST_Distance(submissions.location, tasks.required_location) <= tasks.geofence_radius_m`. Not stored separately — computed on demand.  
> **Contract fix ⑨**: `ReviewAuditDetail.verificationChecks.tamperDetected` maps to `submissions.fraud_flags` JSONB array. The contract field is a derived boolean; the schema stores the full flag array.

### Admin

| Endpoint | Method | Tables Read | Tables Written | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `GET /admin/kpis` | GET | `submissions`, `reviews`, `points_ledger`, `redemptions`, `users` | — | All aggregated at query time |
| `GET /admin/heatmap` | GET | `submissions`, `wards` | — | ST_AsGeoJSON on `submissions.location` |
| `GET /admin/wards` | GET | `mv_ward_stats` (materialized view) | — | `REFRESH MATERIALIZED VIEW mv_ward_stats` after bulk events |

> **Contract fix ⑩**: `WardSummary.wardId` (string `"ward-104"`) maps to `wards.id` (UUID). The API layer serialises the UUID as a string. The schema also has `wards.number` (INTEGER) which can be used to produce a human-readable ward ID.

### Notifications

| Endpoint | Method | Tables Read | Tables Written | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `GET /notifications` | GET | `notifications` | — | `read` field = `read_at IS NULL` |
| `POST /notifications/mark-read` | POST | `notifications` | `notifications` (set `read_at = now()`) | — |

> **Contract fix ⑪**: `Notification.date` (string) maps to `notifications.created_at` (TIMESTAMPTZ). `Notification.read` (boolean) is derived from `read_at IS NULL`. These have no mismatch.

### Surveys

| Endpoint | Method | Tables Read | Tables Written | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `GET /surveys` | GET | `surveys`, `survey_questions` | — | — |
| `POST /surveys/{id}/responses` | POST | `surveys`, `survey_questions`, `v_monthly_points_earned` | `survey_responses`, `points_ledger`, `audit_log` | Deduplicated by `survey_responses_uq` (survey_id, user_id, question_id) |

---

## Unresolved Schema Fields / Gaps (Summary)

| # | Contract Field | Schema Resolution | Action |
| :--- | :--- | :--- | :--- |
| ① | `Task.distance` | Computed via PostGIS; not stored | No fix needed — document only |
| ② | `Task.location` (string) | `tasks.location_label` TEXT | Added `location_label`; also added `required_location` geography |
| ③ | `SubmissionDetail.reviewedAt` | `reviews.created_at` | No mismatch |
| ④ | `SubmissionDetail.reason` | `reviews.reason` | No mismatch — `internal_notes` not exposed to citizens |
| ⑤ | `PointsTransaction.title` | `points_ledger.description` | App layer must populate at insert |
| ⑥ | `RedeemRequest` missing `idempotency_key` | `redemptions.idempotency_key` | **Add `idempotency_key` to contract request body** |
| ⑦ | `Redemption.code` (plaintext) | `redemptions.code_encrypted` BYTEA | App decrypts; no schema change |
| ⑧ | `gpsWithinGeofence` (boolean) | Computed from PostGIS at review time | No stored column needed |
| ⑨ | `tamperDetected` (boolean) | Derived from `submissions.fraud_flags` JSONB | App extracts from JSONB |
| ⑩ | `WardSummary.wardId` (string slug) | `wards.id` UUID | App serialises; also expose `wards.number` |
| ⑪ | `Notification.read` (boolean) | `notifications.read_at IS NULL` | No mismatch |
| ⑫ | `SubmissionStatus` contract enum is `under_review\|approved\|rejected` | DB enum adds `draft`, `queued_offline`, `submitted` | Extra states are internal; API filters to contract set for citizen endpoints |
