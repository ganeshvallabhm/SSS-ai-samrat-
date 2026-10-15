-- =============================================================================
-- SSS Civic Tech - PostgreSQL 16 + PostGIS Database Schema
-- Version : 1.0.0
-- Created : 2026-10-12
-- =============================================================================

-- ─────────────────────────────────────────────────────────────
-- 0. EXTENSIONS
-- ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─────────────────────────────────────────────────────────────
-- 1. ENUMS
-- ─────────────────────────────────────────────────────────────
CREATE TYPE user_role AS ENUM ('citizen', 'reviewer', 'admin');
CREATE TYPE user_status AS ENUM ('active', 'suspended', 'deleted');
CREATE TYPE submission_status AS ENUM (
    'draft', 'queued_offline', 'submitted',
    'under_review', 'approved', 'rejected'
);
CREATE TYPE task_status AS ENUM ('draft', 'active', 'paused', 'expired');
CREATE TYPE task_category_slug AS ENUM ('civic', 'green', 'health', 'governance');
CREATE TYPE ledger_type AS ENUM ('earned', 'redeemed', 'adjustment', 'expired');
CREATE TYPE notification_type AS ENUM (
    'approved', 'rejected', 'points_added',
    'voucher_ready', 'submission_received', 'system'
);
CREATE TYPE voucher_brand AS ENUM ('Amazon', 'Flipkart');
CREATE TYPE voucher_status AS ENUM ('active', 'inactive');
CREATE TYPE redemption_status AS ENUM ('pending', 'fulfilled', 'expired', 'cancelled');
CREATE TYPE survey_question_type AS ENUM (
    'single_choice', 'multiple_choice', 'rating_1_to_5', 'text'
);
CREATE TYPE survey_status AS ENUM ('draft', 'active', 'closed');

-- ─────────────────────────────────────────────────────────────
-- 2. APP CONFIGURATION
-- ─────────────────────────────────────────────────────────────
CREATE TABLE app_config (
    key         TEXT        PRIMARY KEY,
    value       TEXT        NOT NULL,
    description TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE app_config IS 'Editable platform configuration. Keys: points_civic, points_green, points_health, points_governance, monthly_earn_cap, min_redemption_points, max_gps_accuracy_m, photo_timestamp_skew_s, duplicate_radius_m, duplicate_window_hours, max_submissions_per_hour, otp_ttl_seconds, otp_max_attempts, otp_cooldown_seconds, jwt_access_ttl_seconds, jwt_refresh_ttl_days.';

-- ─────────────────────────────────────────────────────────────
-- 3. WARDS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE wards (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    city        TEXT        NOT NULL DEFAULT 'Hyderabad',
    number      INTEGER,
    boundary    geography(POLYGON, 4326),
    centroid    geography(POINT, 4326),
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wards_name_city_uq UNIQUE (name, city)
);
COMMENT ON COLUMN wards.centroid IS 'WGS-84 lon/lat centroid for proximity queries.';
COMMENT ON COLUMN wards.boundary IS 'Full ward polygon; NULL until GIS data loaded.';

-- ─────────────────────────────────────────────────────────────
-- 4. TASK CATEGORIES
-- ─────────────────────────────────────────────────────────────
CREATE TABLE task_categories (
    id          task_category_slug  PRIMARY KEY,
    label       TEXT                NOT NULL,
    short_label TEXT                NOT NULL,
    icon_name   TEXT,
    created_at  TIMESTAMPTZ         NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 5. USERS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE users (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    phone               TEXT        NOT NULL,
    name                TEXT        NOT NULL DEFAULT '',
    role                user_role   NOT NULL DEFAULT 'citizen',
    status              user_status NOT NULL DEFAULT 'active',
    ward_id             UUID        REFERENCES wards(id) ON DELETE SET NULL,
    language            TEXT        NOT NULL DEFAULT 'en',
    trust_score         NUMERIC(5,2) NOT NULL DEFAULT 100.00
                            CHECK (trust_score BETWEEN 0 AND 100),
    consent_accepted_at TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT users_phone_uq     UNIQUE (phone),
    CONSTRAINT users_phone_format CHECK (phone ~ '^\d{10}$')
);
COMMENT ON COLUMN users.trust_score IS 'Reputation score 0-100. Penalised on fraud flags.';

-- ─────────────────────────────────────────────────────────────
-- 6. OTP REQUESTS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE otp_requests (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    phone       TEXT        NOT NULL,
    code_hash   TEXT        NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    attempts    SMALLINT    NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    used_at     TIMESTAMPTZ,
    ip_address  INET,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT otp_phone_format CHECK (phone ~ '^\d{10}$')
);
COMMENT ON COLUMN otp_requests.code_hash IS 'bcrypt hash via pgcrypto. NEVER store raw OTP.';
COMMENT ON COLUMN otp_requests.used_at IS 'Non-NULL = already consumed. Single-use enforced.';

-- ─────────────────────────────────────────────────────────────
-- 7. REFRESH TOKENS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE refresh_tokens (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT        NOT NULL UNIQUE,
    issued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    ip_address  INET,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 8. TASKS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE tasks (
    id                UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    title             TEXT                NOT NULL,
    description       TEXT                NOT NULL DEFAULT '',
    requirements      TEXT[]              NOT NULL DEFAULT '{}',
    category_id       task_category_slug  NOT NULL REFERENCES task_categories(id),
    ward_id           UUID                REFERENCES wards(id) ON DELETE SET NULL,
    points_reward     INTEGER             NOT NULL CHECK (points_reward > 0),
    required_location geography(POINT, 4326),
    geofence_radius_m INTEGER             CHECK (geofence_radius_m > 0),
    location_label    TEXT                NOT NULL DEFAULT '',
    deadline          DATE,
    status            task_status         NOT NULL DEFAULT 'active',
    created_by        UUID                REFERENCES users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ         NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ         NOT NULL DEFAULT now(),
    CONSTRAINT tasks_geofence_pair CHECK (
        (required_location IS NULL AND geofence_radius_m IS NULL) OR
        (required_location IS NOT NULL AND geofence_radius_m IS NOT NULL)
    )
);
COMMENT ON COLUMN tasks.required_location IS 'WGS-84 point. Submission must be within geofence_radius_m when set.';
COMMENT ON COLUMN tasks.geofence_radius_m IS 'Geofence radius in metres. NULL = no spatial constraint.';

-- ─────────────────────────────────────────────────────────────
-- 9. SUBMISSIONS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE submissions (
    id                  UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID                NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    task_id             UUID                NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
    category_id         task_category_slug  NOT NULL REFERENCES task_categories(id),
    status              submission_status   NOT NULL DEFAULT 'submitted',
    photo_url           TEXT,
    photo_thumbnail_url TEXT,
    photo_sha256        TEXT,
    location            geography(POINT, 4326) NOT NULL,
    accuracy_m          NUMERIC(8,2)        NOT NULL CHECK (accuracy_m > 0),
    captured_at         TIMESTAMPTZ         NOT NULL,
    received_at         TIMESTAMPTZ         NOT NULL DEFAULT now(),
    area_name           TEXT,
    note                TEXT,
    fraud_flags         JSONB               NOT NULL DEFAULT '[]'::JSONB,
    resubmission_of     UUID                REFERENCES submissions(id) ON DELETE SET NULL,
    idempotency_key     TEXT                UNIQUE,
    created_at          TIMESTAMPTZ         NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ         NOT NULL DEFAULT now(),
    CONSTRAINT submissions_accuracy_max     CHECK (accuracy_m <= 50),
    CONSTRAINT submissions_note_length      CHECK (char_length(note) <= 500),
    CONSTRAINT submissions_sha256_format
        CHECK (photo_sha256 IS NULL OR photo_sha256 ~ '^[0-9a-f]{64}$')
);
COMMENT ON COLUMN submissions.location     IS 'Device GPS point (WGS-84).';
COMMENT ON COLUMN submissions.captured_at  IS 'Client shutter timestamp. Must be within 10 min of received_at.';
COMMENT ON COLUMN submissions.photo_sha256 IS 'SHA-256 hex of raw JPEG for exact-duplicate detection.';
COMMENT ON COLUMN submissions.fraud_flags  IS 'Array: [{"code":"DUPLICATE_HASH","auto_hold": true,"flagged_at":"..."}]';
COMMENT ON COLUMN submissions.resubmission_of IS 'Links new submission to the rejected predecessor.';

-- ─────────────────────────────────────────────────────────────
-- 10. SUBMISSION EVENTS (status timeline)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE submission_events (
    id            UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID              NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    status        submission_status NOT NULL,
    actor_id      UUID              REFERENCES users(id) ON DELETE SET NULL,
    actor_label   TEXT,
    reason        TEXT,
    internal_notes TEXT,
    created_at    TIMESTAMPTZ       NOT NULL DEFAULT now()
);
COMMENT ON TABLE submission_events IS 'Immutable append-only status timeline for each submission.';

-- ─────────────────────────────────────────────────────────────
-- 11. REVIEWS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE reviews (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID        NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE RESTRICT,
    reviewer_id   UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    decision      TEXT        NOT NULL CHECK (decision IN ('approve', 'reject')),
    reason        TEXT,
    internal_notes TEXT,
    awarded_points INTEGER    CHECK (awarded_points >= 0),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT reviews_reject_needs_reason
        CHECK (decision <> 'reject' OR (reason IS NOT NULL AND char_length(reason) > 0))
);
COMMENT ON COLUMN reviews.awarded_points IS 'Actual points minted; defaults to task.points_reward when NULL on approval.';

-- ─────────────────────────────────────────────────────────────
-- 12. POINTS LEDGER (APPEND-ONLY)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE points_ledger (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    amount        INTEGER     NOT NULL,
    type          ledger_type NOT NULL,
    submission_id UUID        REFERENCES submissions(id) ON DELETE RESTRICT,
    redemption_id UUID,
    description   TEXT        NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ledger_nonzero         CHECK (amount <> 0),
    CONSTRAINT ledger_one_source      CHECK (submission_id IS NULL OR redemption_id IS NULL),
    CONSTRAINT ledger_earned_positive CHECK (type <> 'earned' OR amount > 0),
    CONSTRAINT ledger_redeemed_neg    CHECK (type NOT IN ('redeemed', 'expired') OR amount < 0)
);
COMMENT ON TABLE points_ledger IS 'Append-only ledger. Balance = SUM(amount) per user. UPDATE/DELETE blocked by trigger.';

CREATE OR REPLACE FUNCTION fn_ledger_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'points_ledger is append-only. Row id=%', OLD.id
        USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER trg_ledger_immutable
    BEFORE UPDATE OR DELETE ON points_ledger
    FOR EACH ROW EXECUTE FUNCTION fn_ledger_immutable();

-- ─────────────────────────────────────────────────────────────
-- 13. VOUCHERS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE vouchers (
    id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    brand            voucher_brand  NOT NULL,
    denomination_inr INTEGER        NOT NULL CHECK (denomination_inr IN (100, 250, 500)),
    points_cost      INTEGER        NOT NULL CHECK (points_cost > 0),
    status           voucher_status NOT NULL DEFAULT 'active',
    provider_sku     TEXT,
    created_at       TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ    NOT NULL DEFAULT now(),
    CONSTRAINT vouchers_brand_denom_uq UNIQUE (brand, denomination_inr)
);
COMMENT ON COLUMN vouchers.denomination_inr IS 'Face value INR: 100, 250, or 500.';
COMMENT ON COLUMN vouchers.points_cost IS 'Points to spend. MVP: cost equals denomination numerically.';

-- ─────────────────────────────────────────────────────────────
-- 14. REDEMPTIONS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE redemptions (
    id               UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID               NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    voucher_id       UUID               NOT NULL REFERENCES vouchers(id) ON DELETE RESTRICT,
    points_spent     INTEGER            NOT NULL CHECK (points_spent > 0),
    code_encrypted   BYTEA              NOT NULL,
    provider_ref     TEXT,
    barcode_data     TEXT,
    qr_code_data     TEXT,
    expires_at       TIMESTAMPTZ        NOT NULL,
    status           redemption_status  NOT NULL DEFAULT 'pending',
    idempotency_key  TEXT               NOT NULL UNIQUE,
    created_at       TIMESTAMPTZ        NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ        NOT NULL DEFAULT now()
);
COMMENT ON COLUMN redemptions.code_encrypted  IS 'Gift code encrypted at rest; decrypted transiently in app.';
COMMENT ON COLUMN redemptions.idempotency_key IS 'Client UUID. UNIQUE prevents double-spend on network retry.';

ALTER TABLE points_ledger
    ADD CONSTRAINT ledger_redemption_fk
        FOREIGN KEY (redemption_id) REFERENCES redemptions(id) ON DELETE RESTRICT;

-- ─────────────────────────────────────────────────────────────
-- 15. NOTIFICATIONS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE notifications (
    id            UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID               NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type          notification_type  NOT NULL,
    title         TEXT               NOT NULL,
    message       TEXT               NOT NULL,
    submission_id UUID               REFERENCES submissions(id) ON DELETE SET NULL,
    redemption_id UUID               REFERENCES redemptions(id) ON DELETE SET NULL,
    read_at       TIMESTAMPTZ,
    created_at    TIMESTAMPTZ        NOT NULL DEFAULT now()
);
COMMENT ON COLUMN notifications.read_at IS 'NULL = unread. Set to now() on citizen read.';

-- ─────────────────────────────────────────────────────────────
-- 16. SURVEYS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE surveys (
    id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    title       TEXT          NOT NULL,
    description TEXT          NOT NULL DEFAULT '',
    ward_id     UUID          REFERENCES wards(id) ON DELETE SET NULL,
    points      INTEGER       NOT NULL DEFAULT 10 CHECK (points >= 0),
    status      survey_status NOT NULL DEFAULT 'draft',
    expires_at  TIMESTAMPTZ,
    created_by  UUID          REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TABLE survey_questions (
    id         UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_id  UUID                 NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    sort_order SMALLINT             NOT NULL DEFAULT 0,
    prompt     TEXT                 NOT NULL,
    type       survey_question_type NOT NULL,
    options    TEXT[],
    is_required BOOLEAN             NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ          NOT NULL DEFAULT now()
);

CREATE TABLE survey_responses (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    survey_id      UUID        NOT NULL REFERENCES surveys(id) ON DELETE RESTRICT,
    user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    question_id    UUID        NOT NULL REFERENCES survey_questions(id) ON DELETE RESTRICT,
    answer_text    TEXT,
    answer_options TEXT[],
    answer_rating  SMALLINT    CHECK (answer_rating BETWEEN 1 AND 5),
    points_awarded INTEGER     NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT survey_responses_uq UNIQUE (survey_id, user_id, question_id)
);
COMMENT ON TABLE survey_responses IS 'One row per answered question per user. Points tracked at completion.';

-- ─────────────────────────────────────────────────────────────
-- 17. AUDIT LOG
-- ─────────────────────────────────────────────────────────────
CREATE TABLE audit_log (
    id          BIGSERIAL   PRIMARY KEY,
    actor_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
    action      TEXT        NOT NULL,
    entity      TEXT        NOT NULL,
    entity_id   UUID,
    details     JSONB       NOT NULL DEFAULT '{}'::JSONB,
    ip_address  INET,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE audit_log IS 'Immutable event log. Never updated or deleted.';

-- ─────────────────────────────────────────────────────────────
-- 18. VIEWS AND MATERIALIZED VIEWS
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_wallet_balance AS
SELECT user_id, COALESCE(SUM(amount), 0)::INTEGER AS balance
FROM points_ledger
GROUP BY user_id;
COMMENT ON VIEW v_wallet_balance IS 'Live balance per user. Query: SELECT balance FROM v_wallet_balance WHERE user_id = .';

CREATE OR REPLACE VIEW v_monthly_points_earned AS
SELECT
    user_id,
    DATE_TRUNC('month', created_at AT TIME ZONE 'Asia/Kolkata') AS month_start_ist,
    SUM(amount)::INTEGER AS monthly_earned
FROM points_ledger
WHERE type = 'earned'
GROUP BY user_id, DATE_TRUNC('month', created_at AT TIME ZONE 'Asia/Kolkata');
COMMENT ON VIEW v_monthly_points_earned IS 'Points earned per user per IST calendar month (Asia/Kolkata). Enforces 500-point monthly cap per R-004/R-040.';

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_ward_stats AS
SELECT
    w.id                                                        AS ward_id,
    w.name                                                      AS ward_name,
    COUNT(s.id)                                                 AS total_submissions,
    COUNT(s.id) FILTER (WHERE s.status = 'approved')           AS approved_submissions,
    COUNT(DISTINCT s.user_id)                                   AS active_citizens
FROM wards w
LEFT JOIN tasks t       ON t.ward_id = w.id
LEFT JOIN submissions s ON s.task_id = t.id
GROUP BY w.id, w.name;
CREATE UNIQUE INDEX mv_ward_stats_ward_id_idx ON mv_ward_stats (ward_id);
COMMENT ON MATERIALIZED VIEW mv_ward_stats IS 'Cached ward stats. REFRESH MATERIALIZED VIEW CONCURRENTLY mv_ward_stats after bulk reviews.';

-- ─────────────────────────────────────────────────────────────
-- 19. INDEXES
-- ─────────────────────────────────────────────────────────────
CREATE INDEX idx_users_phone     ON users (phone);
CREATE INDEX idx_users_ward_id   ON users (ward_id);
CREATE INDEX idx_users_role      ON users (role);
CREATE INDEX idx_otp_phone_created ON otp_requests (phone, created_at DESC);
CREATE INDEX idx_refresh_user_id   ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_expires   ON refresh_tokens (expires_at);
CREATE INDEX idx_tasks_category_id ON tasks (category_id);
CREATE INDEX idx_tasks_ward_id     ON tasks (ward_id);
CREATE INDEX idx_tasks_status      ON tasks (status);
CREATE INDEX idx_tasks_deadline    ON tasks (deadline);
CREATE INDEX idx_tasks_fts ON tasks USING GIN (to_tsvector('english', title || ' ' || description));
CREATE INDEX idx_tasks_location    ON tasks USING GIST (required_location);
CREATE INDEX idx_sub_user_id       ON submissions (user_id);
CREATE INDEX idx_sub_task_id       ON submissions (task_id);
CREATE INDEX idx_sub_category_id   ON submissions (category_id);
CREATE INDEX idx_sub_status        ON submissions (status);
CREATE INDEX idx_sub_received_at   ON submissions (received_at DESC);
CREATE INDEX idx_sub_location      ON submissions USING GIST (location);
CREATE INDEX idx_sub_sha256        ON submissions (photo_sha256) WHERE photo_sha256 IS NOT NULL;
CREATE INDEX idx_sub_resub_of      ON submissions (resubmission_of) WHERE resubmission_of IS NOT NULL;
CREATE INDEX idx_sub_events_sub_id ON submission_events (submission_id, created_at DESC);
CREATE INDEX idx_reviews_reviewer  ON reviews (reviewer_id);
CREATE INDEX idx_reviews_created   ON reviews (created_at DESC);
CREATE INDEX idx_ledger_user_id    ON points_ledger (user_id);
CREATE INDEX idx_ledger_type       ON points_ledger (type);
CREATE INDEX idx_ledger_created    ON points_ledger (created_at DESC);
CREATE INDEX idx_ledger_sub_id     ON points_ledger (submission_id) WHERE submission_id IS NOT NULL;
CREATE INDEX idx_ledger_red_id     ON points_ledger (redemption_id) WHERE redemption_id IS NOT NULL;
CREATE INDEX idx_redemptions_user  ON redemptions (user_id);
CREATE INDEX idx_redemptions_status ON redemptions (status);
CREATE INDEX idx_redemptions_exp   ON redemptions (expires_at);
CREATE INDEX idx_notif_user        ON notifications (user_id, created_at DESC);
CREATE INDEX idx_notif_unread      ON notifications (user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX idx_surveys_status    ON surveys (status);
CREATE INDEX idx_surveys_expires   ON surveys (expires_at);
CREATE INDEX idx_survey_q_survey   ON survey_questions (survey_id, sort_order);
CREATE INDEX idx_survey_r_user     ON survey_responses (user_id);
CREATE INDEX idx_survey_r_survey   ON survey_responses (survey_id, user_id);
CREATE INDEX idx_wards_centroid    ON wards USING GIST (centroid);
CREATE INDEX idx_wards_boundary    ON wards USING GIST (boundary) WHERE boundary IS NOT NULL;
CREATE INDEX idx_audit_actor       ON audit_log (actor_id);
CREATE INDEX idx_audit_entity      ON audit_log (entity, entity_id);
CREATE INDEX idx_audit_created     ON audit_log (created_at DESC);
