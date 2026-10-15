-- =============================================================================
-- SSS Civic Tech - Reference / Seed Data
-- Run AFTER db/schema.sql
-- =============================================================================

-- ─────────────────────────────────────────────────────────────
-- 1. APP CONFIG (editable business rules)
-- ─────────────────────────────────────────────────────────────
INSERT INTO app_config (key, value, description) VALUES
  ('points_civic',              '20',  'Points awarded for approved civic audit/road report submission'),
  ('points_green',              '40',  'Points awarded for approved green plantation or clean drive submission'),
  ('points_health',             '50',  'Points awarded for approved blood donation or health camp submission'),
  ('points_governance',         '10',  'Points awarded for completed local governance survey'),
  ('monthly_earn_cap',          '500', 'Maximum points a citizen can earn in a single calendar month'),
  ('min_redemption_points',     '100', 'Minimum balance required to redeem any voucher'),
  ('max_gps_accuracy_m',        '50',  'Maximum acceptable GPS accuracy radius in metres'),
  ('photo_timestamp_skew_s',    '600', 'Max seconds between photo capture and server receipt (10 minutes)'),
  ('duplicate_radius_m',        '30',  'Radius in metres for spatial near-duplicate detection'),
  ('duplicate_window_hours',    '24',  'Time window in hours for spatial near-duplicate detection'),
  ('max_submissions_per_hour',  '5',   'Rate limit: maximum submissions a single user may create per hour'),
  ('otp_ttl_seconds',           '300', 'OTP validity window in seconds (5 minutes)'),
  ('otp_max_attempts',          '5',   'Maximum failed OTP verify attempts before the request is locked'),
  ('otp_cooldown_seconds',      '30',  'Minimum seconds between OTP resend requests for same phone'),
  ('jwt_access_ttl_seconds',    '3600','JWT access token lifetime in seconds (1 hour)'),
  ('jwt_refresh_ttl_days',      '30',  'JWT refresh token lifetime in days')
ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        description = EXCLUDED.description,
        updated_at = now();

-- ─────────────────────────────────────────────────────────────
-- 2. TASK CATEGORIES
-- ─────────────────────────────────────────────────────────────
INSERT INTO task_categories (id, label, short_label, icon_name) VALUES
  ('civic',      'Civic Audits & Road Reports',         'Civic audits',  'Construction'),
  ('green',      'Green Plantation & Clean Drives',     'Green drives',  'Sprout'),
  ('health',     'Blood Donation & Health Camps',       'Health camps',  'Heart'),
  ('governance', 'Local Governance Surveys',            'Local surveys', 'Landmark')
ON CONFLICT (id) DO UPDATE
    SET label       = EXCLUDED.label,
        short_label = EXCLUDED.short_label,
        icon_name   = EXCLUDED.icon_name;

-- ─────────────────────────────────────────────────────────────
-- 3. VOUCHERS (denominations for each brand)
--    points_cost = denomination numerically for MVP
-- ─────────────────────────────────────────────────────────────
INSERT INTO vouchers (brand, denomination_inr, points_cost, status) VALUES
  ('Amazon',   100, 100, 'active'),
  ('Amazon',   250, 250, 'active'),
  ('Amazon',   500, 500, 'active'),
  ('Flipkart', 100, 100, 'active'),
  ('Flipkart', 250, 250, 'active'),
  ('Flipkart', 500, 500, 'active')
ON CONFLICT (brand, denomination_inr) DO UPDATE
    SET points_cost = EXCLUDED.points_cost,
        status      = EXCLUDED.status,
        updated_at  = now();

-- ─────────────────────────────────────────────────────────────
-- 4. SAMPLE HYDERABAD WARDS
--    Centroids are approximate; boundaries NULL until GIS data loaded.
--    Format: ST_MakePoint(longitude, latitude)
-- ─────────────────────────────────────────────────────────────
INSERT INTO wards (name, city, number, centroid) VALUES
  ('Ward 104 - Kondapur',        'Hyderabad', 104, ST_SetSRID(ST_MakePoint(78.3618, 17.4682), 4326)::geography),
  ('Ward 105 - Hafeezpet',       'Hyderabad', 105, ST_SetSRID(ST_MakePoint(78.3504, 17.4831), 4326)::geography),
  ('Ward 106 - Masjid Banda',    'Hyderabad', 106, ST_SetSRID(ST_MakePoint(78.3740, 17.4591), 4326)::geography),
  ('Ward 107 - Gachibowli',      'Hyderabad', 107, ST_SetSRID(ST_MakePoint(78.3492, 17.4401), 4326)::geography),
  ('Ward 108 - Serilingampally', 'Hyderabad', 108, ST_SetSRID(ST_MakePoint(78.3102, 17.4951), 4326)::geography),
  ('Ward 109 - Raghavendra Colony', 'Hyderabad', 109, ST_SetSRID(ST_MakePoint(78.3889, 17.4721), 4326)::geography),
  ('Ward 110 - Sri Ram Nagar',   'Hyderabad', 110, ST_SetSRID(ST_MakePoint(78.3760, 17.4621), 4326)::geography),
  ('Ward 111 - Nallagandla',     'Hyderabad', 111, ST_SetSRID(ST_MakePoint(78.3241, 17.4761), 4326)::geography),
  ('Ward 112 - Miyapur',         'Hyderabad', 112, ST_SetSRID(ST_MakePoint(78.3504, 17.5091), 4326)::geography),
  ('Ward 113 - HITEC City',      'Hyderabad', 113, ST_SetSRID(ST_MakePoint(78.3756, 17.4500), 4326)::geography)
ON CONFLICT (name, city) DO UPDATE
    SET centroid   = EXCLUDED.centroid,
        number     = EXCLUDED.number,
        updated_at = now();
