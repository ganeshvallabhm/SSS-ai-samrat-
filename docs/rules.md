# SSS Civic Tech — Business Rules

> All rules are numbered, testable, and reference the specific database table or config key that enforces them.  
> Config values are in `app_config` and are editable at runtime without a deployment.

---

## 1. Points — Category Reward Values

**R-001** The default points awarded per approved submission by category are:

| Category slug | Config key | Default value |
| :--- | :--- | :--- |
| `civic` | `points_civic` | **20 pts** |
| `green` | `points_green` | **40 pts** |
| `health` | `points_health` | **50 pts** |
| `governance` | `points_governance` | **10 pts** (default survey completion) |

**R-002** A reviewer may override the default award for any individual submission via `reviews.awarded_points`. If `reviews.awarded_points IS NULL` on an approval, the application MUST fall back to the task's `tasks.points_reward`.

**R-003** `tasks.points_reward` MUST be set at task creation time and MUST be `> 0` (`CHECK` constraint). It is the source of truth for a specific task's reward and may differ from the category default (e.g., a special event task worth 80 pts). For surveys, `surveys.points` is the source of truth for survey rewards; the config key `points_governance` is only the default used when a survey is created.

---

## 2. Monthly Earning Cap

**R-004** A citizen MUST NOT earn more than the value of `app_config('monthly_earn_cap')` (default **500**) points from `type = 'earned'` ledger entries within a single IST calendar month (`Asia/Kolkata`). All timestamps stay in UTC in the database; month boundaries are computed in IST.

**R-005** Before inserting any `earned` ledger row, the application MUST query the live `points_ledger` (or IST-aware live calculation) for the current user and IST month. If `monthly_earned + proposed_amount > monthly_earn_cap`, the points MUST be capped: `actual_award = monthly_earn_cap - monthly_earned`. If the result is `<= 0`, no ledger row is inserted and the submission is still approved.

**R-006** The monthly cap applies **only** to `type = 'earned'` entries. Redemption deductions and adjustments are not capped.

---

## 3. Minimum Redemption Threshold

**R-007** A citizen may only initiate a voucher redemption if `v_wallet_balance.balance >= vouchers.points_cost` for the chosen voucher, AND `vouchers.points_cost >= app_config('min_redemption_points')` (default **100**).

**R-008** The minimum redemption check is enforced in a serialisable database transaction. If two concurrent redemptions would together drive the balance below zero, only the first COMMIT succeeds; the second MUST raise a conflict error and return HTTP 400.

**R-009** The balance MUST never become negative. The application MUST verify `balance >= points_cost` inside the same transaction that inserts the redemption and ledger rows.

---

## 4. GPS Quality Rules

**R-010** Accepted GPS accuracy: `submissions.accuracy_m` MUST be `<= app_config('max_gps_accuracy_m')` (default **50** metres). Submissions with `accuracy_m > 50` MUST be rejected at the API layer with HTTP 422 before any database write.

**R-011** Photo timestamp skew: the absolute difference between `submissions.captured_at` (client-reported) and `submissions.received_at` (server time) MUST be `<= app_config('photo_timestamp_skew_s')` (default **600** seconds = 10 minutes). Submissions exceeding this MUST be rejected at the API layer with HTTP 422.

**R-012** Task geofence: when `tasks.geofence_radius_m IS NOT NULL`, the application MUST verify that `ST_Distance(submissions.location, tasks.required_location) <= tasks.geofence_radius_m`. A submission outside the geofence MUST be auto-flagged with `{"code":"OUTSIDE_GEOFENCE","auto_hold":true}` and may be routed to a reviewer rather than auto-rejected, to allow manual override.

---

## 5. Duplicate Detection

**R-013** **Exact-hash duplicate**: if `submissions.photo_sha256` already exists in the `submissions` table for any submission belonging to the same `user_id` that is not `rejected`, the new submission MUST be auto-flagged with `{"code":"DUPLICATE_HASH","auto_hold":true}`. An auto-hold submission enters `under_review` status but is surface-highlighted in the reviewer queue.

**R-014** **Spatial near-duplicate**: if any existing submission by the same `user_id` with the same `category_id` is within `app_config('duplicate_radius_m')` metres (default **30 m**) AND was `received_at` within `app_config('duplicate_window_hours')` hours (default **24 h**), the new submission MUST be auto-flagged with `{"code":"NEAR_DUPLICATE","auto_hold":true}`.

**R-015** Duplicate detection applies only within the same `user_id`. Submissions from different citizens for the same location are allowed.

---

## 6. Rate Limiting

**R-016** A citizen MUST NOT create more than `app_config('max_submissions_per_hour')` (default **5**) submissions within any rolling 60-minute window. Submissions beyond this limit MUST be rejected at the API layer with HTTP 429 before any database write.

**R-017** OTP resend requests for the same phone number MUST be rate-limited to one request per `app_config('otp_cooldown_seconds')` (default **30** seconds), enforced by checking `MAX(created_at)` in `otp_requests`.

**R-018** OTP verification: after `app_config('otp_max_attempts')` (default **5**) failed attempts against a single `otp_requests` row (`attempts >= otp_max_attempts`), that OTP row MUST be treated as exhausted. Further attempts on the same row MUST return HTTP 401 without incrementing `attempts` further.

---

## 7. Fraud Flags

Each fraud flag stored in `submissions.fraud_flags` JSONB has the shape:

```jsonc
{
  "code": "DUPLICATE_HASH",  // string code
  "auto_hold": true,         // boolean: true → submission is auto-held pending manual review
  "flagged_at": "2026-10-12T09:30:00Z"
}
```

| Flag Code | Trigger Condition | `auto_hold` | Consequence |
| :--- | :--- | :--- | :--- |
| `DUPLICATE_HASH` | Same `photo_sha256` from same user (non-rejected) | `true` | Submission enters `under_review`; shown prominently in reviewer queue |
| `NEAR_DUPLICATE` | Same user, same category, within 30 m & 24 h | `true` | Same as above |
| `OUTSIDE_GEOFENCE` | `ST_Distance` > `geofence_radius_m` when task has geofence | `true` | Reviewer sees geofence violation; may override |
| `ACCURACY_EXCEEDED` | `accuracy_m > max_gps_accuracy_m` | N/A | Rejected at API layer before insert (R-010) |
| `TIMESTAMP_SKEW` | `|captured_at - received_at| > photo_timestamp_skew_s` | N/A | Rejected at API layer before insert (R-011) |
| `RATE_LIMIT` | `submissions > max_submissions_per_hour` in rolling window | N/A | Rejected at API layer before insert (R-016) |
| `LOW_TRUST_USER` | Inactive in MVP (all submissions undergo manual review; `trust_score` has no decay) | `false` | Not evaluated in MVP |

**R-019** Flags with `auto_hold = true` do NOT auto-reject the submission. They set `submissions.status = 'under_review'` and create a `submission_events` row with `actor_label = 'System / Fraud Detection'`. A human reviewer makes the final decision.

**R-020** Each fraud flag appended to `submissions.fraud_flags` MUST also emit a row in `audit_log` with `action = 'submission.fraud_flag'`.

---

## 8. Submission Status State Machine

### States

| State | Meaning | Visible to Citizen? |
| :--- | :--- | :--- |
| `draft` | Saved locally, not yet uploaded | Internal only |
| `queued_offline` | Queued for upload (offline-first) | Internal only |
| `submitted` | Received by server, pre-validation | Internal only |
| `under_review` | Queued for human review | ✅ |
| `approved` | Reviewer approved; points minted | ✅ |
| `rejected` | Reviewer rejected with reason | ✅ |

> The contract only exposes `under_review`, `approved`, `rejected` to citizens. The first three states are internal.

### Allowed Transitions

```
draft ──────────────────────────────► queued_offline
queued_offline ─────────────────────► submitted
submitted ──────────────────────────► under_review   (system: after fraud checks pass)
submitted ──────────────────────────► rejected       (system: if API validation fails post-insert — rare)
under_review ───────────────────────► approved       (reviewer)
under_review ───────────────────────► rejected       (reviewer)
rejected ───────────────────────────► under_review   (citizen: via /resubmit — creates a NEW submission row)
```

**R-021** Every status transition MUST insert a row into `submission_events` with the new `status`, `actor_id` (or NULL for system), `actor_label`, and optionally `reason`.

**R-022** A submission in `approved` status MUST NOT be transitioned to any other status. Disputes are handled via new submissions or `audit_log` entries.

**R-023** A resubmission (`/submissions/{id}/resubmit`) MUST only be accepted if `submissions.status = 'rejected'`. The endpoint creates a **new** `submissions` row with `resubmission_of = original_id`, and sets the original submission's `idempotency_key` to NULL so the same key is not reused.

**R-024** The transition from `under_review` to `approved` or `rejected` MUST be performed by a user with `role IN ('reviewer', 'admin')`.

---

## 9. Points Minting on Approval

**R-025** Points are minted ONLY when a submission's status transitions to `approved`. No other state transition may insert an `earned` row into `points_ledger`.

**R-026** Minting MUST occur inside a single serialisable database transaction that:
1. Updates `submissions.status` to `approved`.
2. Inserts the `reviews` row (or updates if re-reviewing — though re-reviewing is disallowed per R-022).
3. Checks the monthly cap (`v_monthly_points_earned` evaluated over the IST month) and computes `actual_award`.
4. Inserts one row into `points_ledger` with `type = 'earned'` and `amount = actual_award` and `submission_id = submission.id`.
5. Inserts a row into `submission_events`.
6. Inserts a `notifications` row for the citizen (type `approved` and, if points > 0, type `points_added`).
7. Inserts rows into `audit_log`.

**R-027** If the monthly cap has already been reached (`actual_award <= 0`), steps 4 and 6 (points_added notification) are skipped. The submission is still marked approved and the citizen receives the `approved` notification.

**R-028** A rejected submission MUST NOT mint any points. If a rejection follows a fraud flag that was `auto_hold`, no `earned` ledger row exists for this submission.

---

## 10. Redemption — Idempotency and Safety

**R-029** Every redemption request MUST carry an `idempotency_key` (UUID). The `redemptions.idempotency_key` column has a `UNIQUE` constraint. If a key already exists, the API MUST return the existing `redemption` record with HTTP 200 (idempotent success) without deducting points twice.

**R-030** Redemption MUST occur in a single serialisable transaction that:
1. Locks the user's ledger balance with `SELECT SUM(amount) FROM points_ledger WHERE user_id = $1 FOR UPDATE`.
2. Verifies `balance >= vouchers.points_cost`. If not, roll back and return HTTP 400.
3. Inserts a row into `redemptions`.
4. Inserts a row into `points_ledger` with `type = 'redeemed'`, `amount = -vouchers.points_cost`, `redemption_id = redemptions.id`.
5. Inserts a `notifications` row (type `voucher_ready`).
6. Inserts an `audit_log` row.

**R-031** The gift card code is encrypted with AES-256-GCM before inserting into `redemptions.code_encrypted`. The plaintext code is held only in application memory and returned to the client in the API response. It is NEVER logged.

**R-032** Points transfer between users is architecturally impossible: `points_ledger` has no `to_user_id` column, and the immutability trigger blocks any attempt to update existing rows.

---

## 11. OTP Authentication Rules

**R-033** OTP codes are 6-digit numeric (`\d{6}`). They are generated by the server, hashed with bcrypt, and stored in `otp_requests.code_hash`. The raw code is sent only via SMS.

**R-034** An OTP expires after `app_config('otp_ttl_seconds')` seconds (default **300 s / 5 min**) from `otp_requests.created_at`.

**R-035** An OTP is single-use. On successful verification, `otp_requests.used_at` is set to `now()`. Subsequent verify calls against the same row MUST be rejected even if the code matches and the row has not expired.

**R-036** On first successful OTP verify for a phone number, the application MUST upsert a `users` row (`ON CONFLICT (phone) DO UPDATE SET ...`). This is the only user-creation pathway.

---

## 12. Data Retention and Privacy

**R-037** `audit_log` rows MUST NOT be updated or deleted. Retention policy is set externally (e.g., partition pruning after N years).

**R-038** When a user is soft-deleted (`users.status = 'deleted'`), their `submissions`, `points_ledger`, and `redemptions` rows are retained for audit. Personally identifiable fields (`users.name`, `users.phone`) are nulled/pseudonymised by a scheduled job.

**R-039** `otp_requests` rows older than 24 hours may be hard-deleted by a maintenance job. Rows with `used_at IS NOT NULL` may be deleted after 1 hour.

---

## 13. Ledger Concurrency and Materialized Views

**R-040** The materialized view (`mv_ward_stats`) is for analytics only. Wallet balance and monthly-cap checks MUST read the live ledger (`points_ledger`) inside the same transaction, after locking the user row with `SELECT ... FOR UPDATE`, so concurrent requests cannot overspend or exceed the cap.

---

## 14. Product Decisions (Reconciled from Section 13)

All previously uncertain rules are reconciled and marked as **DECIDED**:

| # | Rule | Status | Resolution & Rationale |
| :--- | :--- | :--- | :--- |
| U-01 | Monthly cap resets on first day of month | **DECIDED** | **IST calendar month (`Asia/Kolkata`)**: Resets on the 1st of each calendar month at 00:00:00 IST. All timestamps remain in UTC in the database; month boundaries are computed in IST to match citizens' local calendar. |
| U-02 | Points for survey completion | **DECIDED** | **`surveys.points` is the source of truth**: The survey's own points value determines the reward amount. The `points_governance` config key is only the default used when creating a new survey. |
| U-03 | Re-reviewing an approved submission | **DECIDED** | **Blocked (R-022 stands)**: Disallowing re-review of approved submissions prevents race conditions and ledger anomalies in the MVP; disputes are handled manually by admins or via new submissions. |
| U-04 | Voucher expiry duration | **DECIDED** | **Hardcoded 1 year (`redeemedAt + 1 year`)**: Simplest policy for MVP; avoids dynamic config lookups or database complexity. |
| U-05 | `users.trust_score` decay algorithm | **DECIDED** | **Column retained, NO decay and NO auto-approval in MVP**: Every submission goes to a reviewer queue. Simplifies MVP while preserving schema forward-compatibility. |
| U-06 | `LOW_TRUST_USER` threshold | **DECIDED** | **Omitted / Inactive for MVP**: Because 100% of submissions undergo manual human review and `trust_score` has no decay in MVP, low-trust threshold routing is unnecessary. |

