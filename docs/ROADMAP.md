# MedAssist – Build Roadmap

Phase-by-phase plan for building MedAssist. Details for every item are in `docs/PROJECT_SPEC.md` (section numbers in brackets).

**How to use this file**
- Work on one phase at a time, in order. Each phase ends with something working that you can demo.
- Tick items (`[x]`) as they are finished and add short notes under "Notes / decisions".
- At the end of each phase: all tests pass, lint is clean, the README is updated, and there is a Git commit.

## Progress overview

| Phase | Name | Status |
|---|---|---|
| 0 | Project setup | ✅ Done |
| 1 | Authentication, RBAC and audit logging | ✅ Done |
| 2 | Admin setup data | 🟡 In progress |
| 3 | Patients | ⬜ Not started |
| 4 | Appointments and queue | ⬜ Not started |
| 5 | Visit notes and prescriptions | ⬜ Not started |
| 6 | Lab workflow and documents | ⬜ Not started |
| 7 | Billing | ⬜ Not started |
| 8 | Patient timeline, portal and follow-ups | ⬜ Not started |
| 9 | AI features | ⬜ Not started |
| 10 | Dashboards, notifications, reports and printing | ⬜ Not started |
| 11 | Testing, polish and deployment | ⬜ Not started |

Status key: ⬜ Not started · 🟡 In progress · ✅ Done

---

## Phase 0 – Project setup
**Goal:** a clean monorepo with the shared backend building blocks every later feature uses.
**Spec:** §3.2–3.7, §7.1, §16

- [x] npm workspaces monorepo: `server/` (Express + Mongoose) and `client/` (React + Vite + Tailwind)
- [x] ESLint (flat config) + Prettier + `.editorconfig` + `.gitignore`
- [x] Env config validated with Zod; `.env.example` for server and client
- [x] Pino logger with redaction + request ids
- [x] `ApiError`, `sendSuccess`, `asyncHandler`
- [x] `validate()` middleware (Zod)
- [x] Central error handler + 404 handler (standard error format)
- [x] Helmet, CORS, compression, cookie-parser, rate limiter
- [x] MongoDB connection + graceful shutdown
- [x] `GET /api/v1/health`
- [x] Client: router, layout, axios instance, home page showing API/DB status
- [x] Tests: health, 404, validation, error handler, malformed JSON
- [x] README + first Git commit

**Done when:** `npm run dev` shows "API: ok, DB: connected" in the browser; `npm test` and `npm run lint` pass.

**Notes / decisions:**
- 2026-09-23 – **TypeScript** instead of JavaScript (overrides spec §3.2 "JavaScript, no TypeScript"). Files named `.js`/`.jsx` in the spec are `.ts`/`.tsx`. Server: `tsc` build to `server/dist`, dev via nodemon + tsx. Added `npm run typecheck`.
- Dev API port is **5001** (macOS AirPlay uses 5000).
- Env: only Phase 0 variables are validated; later ones from §3.6 are listed (commented out) in `.env.example` and added per phase.
- Health: `data: { status: 'ok', uptime, timestamp, db }` where `db` is the Mongoose state (`connected` / `disconnected` / `connecting` / `disconnecting`); always 200 while the API is up.
- `VALIDATION_ERROR.details` shape: `[{ field: 'body.email', message }]`. Error responses include `stack` in development only.
- New error code `PAYLOAD_TOO_LARGE` (413) for oversized JSON / urlencoded bodies (1 mb limit); not in §16. `FILE_TOO_LARGE` stays for uploads.
- New error code `BUSINESS_RULE_VIOLATION` (422) for `ApiError.unprocessable()` when no specific §16 code fits; not in §16.
- Server config is exported as a frozen `config` object (`config.isProd`, `config.isTest`, …); `MONGO_URI` is optional when `NODE_ENV=test`. `PORT` defaults to 5000 but `.env.example` sets 5001 (macOS AirPlay).
- Duplicate-key errors → `409 CONFLICT` with `details.fields` only (values never echoed).
- Global rate limit 300 req / 15 min per IP (env `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`); auth limiters come in Phase 1.
- Incoming `X-Request-Id` is reused only if it matches `[A-Za-z0-9_-]{8,64}` (prevents log/header injection), otherwise a UUID is generated.
- Global rate limiter is mounted on `/api` and skipped when `NODE_ENV=test` (tests use `createRateLimiter()` directly). `trust proxy` is 1 in every environment.
- Zod v4. React 18 pinned per spec. `npm audit` reports 2 moderate React Router v6 advisories (fix only in v7); revisit before deploy.
- Client uses axios for the health check; plan is RTK Query with an axios-based `baseQuery` in Phase 1.
- Local MongoDB (Homebrew) is standalone; needs converting to a replica set before Phase 4 (see README).
- Errors are logged via `serializeError()` (name/message/stack only) so request bodies and duplicate-key values never reach logs; covered by `tests/logging.test.ts`.
- Tests: one in-memory replica set per test file (`tests/setup.ts`); test-only routes via `createApp({ extraRoutes })`. 53 tests at the end of Phase 0.
- Spec divergences above are recorded here rather than in spec §20 "Open decisions" (the spec was kept read-only during Phase 0).

---

## Phase 1 – Authentication, RBAC and audit logging
**Goal:** secure login for all five roles, role-based access, and an append-only audit trail.
**Spec:** §2, §6.3, §6.4, §6.25, §7.2, §7.3, §10.1–10.5, §13.1–13.2

- [x] User and Session models
- [x] Register (patient), login, refresh (rotation + reuse detection), logout, logout-all, me
- [x] Change password, forgot/reset password, session list/revoke
- [x] Account lockout after failed logins; `mustChangePassword`
- [x] `authenticate` and `authorize(...roles)` middleware
- [x] `canAccessPatient` policy module (skeleton, filled in as modules arrive)
- [x] Audit service + AuditLog model (append-only hooks, hash chain) + `GET /audit-logs`
- [x] Admin user management (`/users`)
- [x] Rate limits on login/register
- [x] Client: Redux store + RTK Query with auto-refresh, login/register/forgot/reset pages
- [x] Client: `ProtectedRoute`, `RoleRoute`, app layout with role-based sidebar, placeholder dashboards per role
- [x] Seed: one account per role
- [x] Tests: auth flows, lockout, refresh reuse, RBAC denial cases, audit immutability

**Done when:** each role logs in and lands on its own dashboard; wrong roles get 403; audit entries appear for logins.

**Notes / decisions:** (all recorded as D1–D23 in spec §20 "Decisions made")
- Patient signup creates a `patient` User only; Patient record, DOB and linking come in Phase 3 (D1).
- Sessions: refresh token = 64 random bytes, SHA-256 stored, rotated on every refresh, sliding 7-day expiry, `'rotated'` revoke reason, 10-s reuse grace window, later reuse revokes the family + `auth.refresh_reuse` (D3–D5, D20).
- `authenticate` checks user + session on every request, so revocation is immediate. Access tokens of a rotated session stay valid while the family (one login on one device) is live; logout and device revocation act on the whole family (D6, D7).
- Server-side `mustChangePassword` enforcement (D12). Lockout via new `lastFailedLoginAt` (D10). Enumeration-safe login responses (D11).
- New staff get a "set your password" email link, not a temp password (D9). `POST /users` creates admin/receptionist/labtech only; doctors come from the seed now and `POST /doctors` in Phase 2 (D17).
- Email service: `console` (dev/test, prints links) and `smtp` transports; `EMAIL_TRANSPORT` must be `smtp` in production (D8).
- Audit: in-process queue, `seq` field, HMAC chain from `GENESIS`, append-only hooks (all update/delete/replace queries, document saves, `insertMany`, `bulkWrite` → 409 `RECORD_LOCKED`), `recordRead()` with 5-min debounce ready for Phase 3, failures never fail requests (D13–D16). `GET /audit-logs`, `GET /audit-logs/verify`; `/audit-logs/patient/:id` waits for Phase 3 (D21).
- `canAccessPatient(user, patientId, scope)` skeleton in `server/src/policies/patientAccess.ts`: doctors are denied until care relationships exist (Phase 4/5). `assertCanAccessPatient` → 404 + `access.denied` audit.
- New env vars: `JWT_ACCESS_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `REFRESH_TOKEN_TTL_DAYS`, `COOKIE_SECURE`, `COOKIE_SAMESITE`, `BCRYPT_ROUNDS`, `AUDIT_HASH_SECRET`, `EMAIL_TRANSPORT`, `SMTP_*`, `MAIL_FROM`. Secrets are required outside test (tests get placeholders). **Existing local `server/.env` files need `JWT_ACCESS_SECRET` and `AUDIT_HASH_SECRET` (≥ 32 chars).**
- Common-password list (top 1,000 from SecLists, MIT) lives in `server/src/data/commonPasswords.ts` so it ships in the build.
- Seed: `npm run seed` (users only, 7 demo accounts, password `Password@123`); `npm run seed -- --reset` (D22).
- Client: Redux store + RTK Query `axiosBaseQuery` over `utils/http.ts` with a shared refresh mutex; session restored on page load; `ProtectedRoute` / `RoleRoute` / `PublicOnlyRoute`; lazy role bundles; role sidebar with mobile drawer; auth, profile, change-password and sessions pages; placeholder dashboards. Admin Users and Audit log pages are built with the other admin pages in Phase 2 (D23).
- Client tests: Vitest + jsdom + React Testing Library (`npm test` now runs server and client).
- Follow-up (step 1 prompt): `AUTH_LIMITS`, `'deactivated'` revoke reason, `COOKIE_SECURE` required in production, `checkPasswordStrength()` with the name/email rule, `User.fullName` / `comparePassword()` / `toJSON` hiding secrets, email templates, `utils/cookies.ts` with the session's `expiresAt`, unit tests in `server/tests/unit/` (D24–D27).
- Tests: 285 server (was 53) + 17 client.

---

## Phase 2 – Admin setup data
**Goal:** the admin can configure the clinic, departments, services, doctors and lab tests.
**Spec:** §4.2, §6.5–6.10, §6.19, §7.4–7.6, §15.3

- [ ] Clinic settings (single document) + public settings endpoint
- [ ] Departments CRUD (activate/deactivate)
- [ ] Services CRUD with prices in paise
- [ ] Doctor profiles (create User + profile in one transaction)
- [ ] Weekly schedules and leave
- [ ] Lab test catalogue with parameters and reference ranges
- [ ] Counter service for human-readable numbers
- [ ] Admin pages: settings (tabs), departments, services, doctors (profile/schedule/leave), lab tests, users, audit logs (APIs from Phase 1)
- [ ] Seed script v1 (`npm run seed`, `--reset`)
- [ ] Tests for validation, permissions and schedule overlap rules

**Done when:** a fresh seed produces a fully configured clinic that the admin can edit in the UI.

**Notes / decisions:**

---

## Phase 3 – Patients
**Goal:** register, search and manage patients; give patients portal access safely.
**Spec:** §4.3–4.4, §6.11, §7.7, §12.1

- [ ] Patient model with MRN, allergies, chronic conditions, consent
- [ ] Create with duplicate check (+ audited override)
- [ ] Search (MRN/phone/name), filters, pagination
- [ ] Role-based serializers (field-level visibility, §2.5)
- [ ] `/patients/me` for patients
- [ ] Portal invite + self-signup linking with reception confirmation
- [ ] Reception pages: patient list, new patient form, patient details
- [ ] Patient profile page
- [ ] Tests: duplicates, visibility per role, `patient.view` audit entries

**Done when:** reception registers and finds patients; a patient logs in and sees only their own profile.

**Notes / decisions:**

---

## Phase 4 – Appointments and queue
**Goal:** conflict-free booking and a live queue.
**Spec:** §4.5–4.6, §4.13, §5.1, §6.12, §7.8–7.9, §8.1–8.4, §8.11

- [ ] Slot generation (schedules, leave, existing bookings, timezone)
- [ ] Booking with transaction + partial unique index (doctor clash, patient clash, limits)
- [ ] Reschedule, cancel (with policy), walk-ins with overbook allowance
- [ ] Appointment state machine + action endpoints
- [ ] Check-in, tokens, queue ordering, call next
- [ ] Socket.IO for queue updates; queue board (no names)
- [ ] Jobs: reminders, no-show marking
- [ ] Doctor leave → affected appointments
- [ ] UI: reception calendar (drag to reschedule), booking modal, patient booking wizard, queue screens
- [ ] Tests: slot generation, concurrent booking race, invalid transitions, cancellation window

**Done when:** two people cannot book the same slot, and the queue updates live on the doctor's and reception's screens.

**Notes / decisions:**

---

## Phase 5 – Visit notes and prescriptions
**Goal:** doctors document consultations and prescribe safely.
**Spec:** §4.7, §5.2–5.3, §6.13–6.16, §7.10, §7.12, §8.5–8.6

- [ ] Encounter model (draft → signed → amended), created on consultation start
- [ ] Vitals (BMI auto), notes, diagnoses, plan, follow-up plan
- [ ] Autosave with optimistic concurrency
- [ ] Sign transaction (issue prescription, complete appointment)
- [ ] Amendments with reason and versions
- [ ] Prescriptions with allergy warning + acknowledgement; cancel/reissue
- [ ] Care-relationship checks in `canAccessPatient`
- [ ] Consult workspace UI (patient header, allergy banner, tabs, sign)
- [ ] Tests: locked after sign, amendments, access without care relationship → 404

**Done when:** a doctor completes a full consultation from queue to signed note and issued prescription.

**Notes / decisions:**

---

## Phase 6 – Lab workflow and documents
**Goal:** lab orders from ordering to release, and secure file uploads.
**Spec:** §4.8, §5.4, §6.20, §6.23, §7.14, §7.16, §8.7, §12.2

- [ ] Lab orders from encounters (priority, clinical notes)
- [ ] Sample collection (sample id), rejection, recollect
- [ ] Result entry with automatic flags; critical value alerts
- [ ] Dual verification, send back, release, revision after release
- [ ] Lab report PDF generated on release
- [ ] Documents: upload (type/size checks), list, authorized download, soft delete
- [ ] Lab worklist UI (tabs by status), order detail with results grid
- [ ] Doctor "results to review" page
- [ ] Tests: flags, self-verification blocked, patient visibility only after release

**Done when:** an order moves through every status and the patient sees the released PDF report.

**Notes / decisions:**

---

## Phase 7 – Billing
**Goal:** correct invoices, partial payments and refunds.
**Spec:** §4.9, §5.5, §6.21–6.22, §7.15, §8.9

- [ ] Draft invoice created automatically on signing (consultation + lab tests)
- [ ] Edit draft, discount limits, issue (number assigned, locked)
- [ ] Payments (cannot exceed balance), refunds, void rules
- [ ] Server-side totals and tax in paise
- [ ] Invoice and receipt PDFs
- [ ] Reception invoice list/editor + payment modal; patient invoice pages
- [ ] Tests: totals and rounding, overpayment, refund, void

**Done when:** a completed visit produces an invoice that can be paid in parts and printed.

**Notes / decisions:**

---

## Phase 8 – Patient timeline, portal and follow-ups
**Goal:** one chronological view of a patient's care, and a complete patient portal.
**Spec:** §4.10, §5.6, §6.18, §7.13, §8.8

- [ ] Timeline aggregation service (permission-filtered, paginated)
- [ ] Timeline UI for doctors, reception (non-clinical) and patients
- [ ] Patient portal: appointments, prescriptions, lab reports, invoices, documents
- [ ] Follow-up requests: create, threaded messages, schedule, close/reject
- [ ] Follow-up reminders job
- [ ] Tests: timeline filtering per role, follow-up flows

**Done when:** a patient can see their whole history and request a follow-up that reception schedules.

**Notes / decisions:**

---

## Phase 9 – AI features
**Goal:** AI clinical summaries and patient explanations with strict guardrails.
**Spec:** §4.11–4.12, §5.7, §6.15, §6.17, §6.26, §7.11, §9

- [ ] `ai.service.js` with `anthropic` and `mock` providers, versioned prompts
- [ ] De-identification of input; JSON output validated with Zod; one retry
- [ ] Clinical summary: generate, edit, approve/reject; server checks on diagnoses and medicines
- [ ] Patient explanation: consistency check, forbidden-phrase check, template fallback, fixed disclaimer, caching, rate limit
- [ ] Settings kill switches + patient AI consent
- [ ] `ai_interactions` log + admin AI monitor page
- [ ] UI: summary panel in consult workspace; "Explain in simple words" on prescriptions and follow-up plans
- [ ] Tests: mock flows, guardrail blocks, AI turned off
- [ ] `npm run ai:eval` script

**Done when:** a doctor approves an AI summary, and a patient reads a safe explanation of their prescription in English or Hindi.

**Notes / decisions:**

---

## Phase 10 – Dashboards, notifications, reports and printing
**Goal:** role dashboards, notifications and printable reports.
**Spec:** §6.24, §7.17–7.18, §11, §12.3, §14

- [ ] Notification service: in-app + Socket.IO + email (no clinical details in email)
- [ ] Notification bell, list, mark read
- [ ] Dashboards for all five roles
- [ ] Reports: appointments, revenue, doctor utilisation, lab turnaround, no-shows (+ CSV export)
- [ ] Global search
- [ ] Remaining PDFs (visit summary, appointment slip) + print CSS
- [ ] Tests: dashboard numbers against seeded data, notification triggers

**Done when:** every role's dashboard shows live data and key events trigger notifications.

**Notes / decisions:**

---

## Phase 11 – Testing, polish and deployment
**Goal:** a reliable, demo-ready app online.
**Spec:** §15, §17, §18

- [ ] Full seed data (spec §15.3) + demo accounts in README
- [ ] RBAC matrix test across all endpoints
- [ ] Coverage ≥ 80 % on services and policies; frontend component tests
- [ ] Optional Playwright end-to-end happy path
- [ ] Responsive and accessibility pass
- [ ] Security review (spec §10 checklist)
- [ ] GitHub Actions CI (lint, format, tests, build)
- [ ] Deploy: MongoDB Atlas, API on Render/Railway, client on Vercel, files on Cloudinary
- [ ] Final README: setup, architecture overview, demo accounts, screenshots

**Done when:** the deployed app works end to end with seeded demo data.

**Notes / decisions:**