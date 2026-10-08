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
| 2 | Admin setup data | ✅ Done |
| 3 | Patients | ✅ Done |
| 4 | Appointments and queue | ✅ Done |
| 5 | Visit notes and prescriptions | ✅ Done |
| 6 | Lab workflow and documents | ✅ Done |
| 7 | Billing | ✅ Done |
| 8 | Patient timeline, portal and follow-ups | ✅ Done |
| 9 | AI features | 🟡 In progress |
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
- Follow-up (step 2 prompt): `audit.record({ req, … })`, nested secret redaction, `diffChanges()`, `verifyChain()` → `{ ok, checked, firstBrokenId, reason }` in `(at, _id)` order, audit indexes `{ at: -1, _id: -1 }` and `{ action: 1, at: -1 }`, `canonicalJson` unit tests (D28).
- Follow-up (step 3 prompt): register takes `dateOfBirth` + `acceptTerms`; session checked before user in `authenticate`; `req.user` adds `sessionId`, `email`, `mustChangePassword`; change password starts a fresh session; `newPassword` on reset; per-IP password-reset limiters; pure `canAccessPatient` with `SCOPES` (D29–D33).
- Follow-up (step 4 prompt): staff creation includes doctors with a forced password change; `?sort=` on `/users`; prefix `action` filter on `/audit-logs`; upserting seed with a login table; exact-status RBAC matrix; README auth overview and env table (D34–D36).
- Follow-up (step 5–6 prompts): UI kit (FormField, Input, Select, PasswordInput, Card, Badge, EmptyState, Modal, ConfirmDialog, Table with phone cards, Pagination), routeConfig-driven routes and sidebar, top-bar user menu, toasts, live password checklist, admin Users (list/detail/add staff/actions) and Audit log (filters, expandable rows, integrity check) pages, MSW client tests (D37–D39).
- Browser check (Chrome via Playwright, seeded local DB): every demo account lands on its dashboard, patient → /403 on admin pages, reload keeps the session, no token in web storage, logout, admin users/filters/audit verify, 360 px layouts. It found the refresh-body bug (D37).
- Busy-port handling and `npm run smoke` (reuses a running API, never stops it).
- Security review (§10.1–10.5), 2026-09-23. All items passed; one fix:
  - Responses: no password, hash, token or cookie in any body (`auth.noSecrets` sweep). Logs: a full auth flow logs none (`logging` test). The only exception is the dev/test console email transport, which logs reset links on purpose (D8) and is refused in production. **Fixed:** request logs used to include query strings; now path only (D40). Audit: `audit.coverage` scans every entry.
  - Refresh cookie `ma_rt`: HttpOnly, SameSite from env, Path `/api/v1/auth`, Secure required in production, expires with the session. The client keeps the access token in Redux memory only (no web storage; checked in the browser).
  - `routeInventory`: all 17 non-public routes return 401 without a token; all 10 `/users` and `/audit-logs` routes return 403 to a patient; every route has an RBAC row.
  - Lockout (tests); rate limiters mounted on login/register/forgot/reset (factory tests + live check: 11th login → 429); refresh without `X-Requested-With` → 403 (tests + live).
  - All 19 Phase 1 audit actions are written by real endpoints; audit logs reject every Mongoose update/delete path with 409 `RECORD_LOCKED`.
- Tests: 356 server (was 53) + 35 client. Phase 1 complete 2026-09-23.

---

## Phase 2 – Admin setup data
**Goal:** the admin can configure the clinic, departments, services, doctors and lab tests.
**Spec:** §4.2, §6.5–6.10, §6.19, §7.4–7.6, §15.3

- [x] Clinic settings (single document) + public settings endpoint
- [x] Departments CRUD (activate/deactivate)
- [x] Services CRUD with prices in paise
- [x] Doctor profiles (create User + profile in one transaction)
- [x] Weekly schedules and leave
- [x] Lab test catalogue with parameters and reference ranges
- [x] Counter service for human-readable numbers
- [x] Admin pages: settings (tabs), departments, services, doctors (profile/schedule/leave), lab tests (users and audit logs were built in Phase 1)
- [x] Seed script v1 (`npm run seed`, `--reset`)
- [x] Tests for validation, permissions and schedule overlap rules

**Done when:** a fresh seed produces a fully configured clinic that the admin can edit in the UI.
Verified 2026-09-23: `npm run seed -- --reset` on the local replica set, then `npm run smoke` (21 checks: settings, 5 departments, 12 services, 8 doctors with schedules, 2 with leave, 15 lab tests, no private fields in public responses, all 15 demo logins, audit chain). Editing in the UI is covered by component tests (RTL + MSW); a manual browser pass is in the Phase 2 test script (see below).

**Notes / decisions:** (recorded as D41–D59 in spec §20 "Decisions made")
- Doctors are identified by their **User id** everywhere; `POST /doctors` creates User + DoctorProfile in one transaction; `POST /users` rejects `doctor` (D41, D42).
- Schedule and leave responses return `affectedAppointments: []` with `TODO(Phase 4)` (D43). Logo is a URL until uploads (D44).
- Settings: one document, cached in memory, refreshed after each update plus a 60 s TTL; reading never writes (D45).
- Money is integer paise in the API and database; the UI types rupees (`MoneyInput`); tax is % in the UI and basis points in the API (D46).
- Weekly schedules are versioned 7-day templates (`effectiveFrom`/`effectiveTo` calendar dates at UTC midnight; session times `HH:mm` clinic time); saving closes the previous version the day before (D47). Leave is `[startAt, endAt)` in UTC; full days are converted with the clinic timezone; overlaps → 409, serialised per doctor (D49).
- Lab test catalogue stores and validates reference ranges; flag helpers come in Phase 6 (D48).
- Public reads (`/settings/public`, `/departments`, `/services`, `/doctors`) use `optionalAuthenticate`; admins get extra fields (D50). Accepted deviations 3a–3f from the step reports (D51).
- New audit actions beyond §10.4 (D54). **Audit chain fix:** the writer now reads the chain head from the database on every write and retries on a `seq` clash; before, a seed `--reset` while `npm run dev` was running broke the chain, and a second writer could lose an entry (D55).
- Seed v1: faker `en_IN` with a fixed seed, 8 doctors, 2 receptionists, 2 lab techs; seeders go through the services (validation + audit) and are idempotent (D56). **Local MongoDB must now be a replica set** (doctor creation uses a transaction).
- date-fns + date-fns-tz on server and client; the client takes the clinic timezone from `GET /settings/public` at app start (supersedes D38) (D57).
- Server additions for the admin UI: active doctor count in the admin department view, admin `isActive` filter on services.
- Fixed along the way: Zod 4 object refinements run even after a field fails (schedule/lab validation could 500); settings loads bumped `updatedAt`; identical lab-test parameters counted as a change; a flaky Phase 1 audit test (secret "abc" could appear in hex hashes).
- Guard tests added: every allowed write in the RBAC matrix must write an audit entry; anonymous public reads are scanned for private keys; `npm run smoke` covers the Phase 2 data.
- **Watch:** three one-off failures in full-suite runs (`routeInventory`/`rbac`, different routes, < 100 ms, not reproducible in 9 full runs + 6 parallel stress runs). Assertions now print the response body so the next one can be diagnosed.
- Not verified in a real browser by Claude (Playwright not installed); see the manual test script.
- Tests: 747 server (was 356) + 78 client (was 35). Phase 2 complete 2026-09-23.

---

## Phase 3 – Patients
**Goal:** register, search and manage patients; give patients portal access safely.
**Spec:** §4.3–4.4, §6.11, §7.7, §12.1

- [x] Patient model with MRN, allergies, chronic conditions, consent
- [x] Create with duplicate check (+ audited override)
- [x] Search (MRN/phone/name), filters, pagination
- [x] Role-based serializers (field-level visibility, §2.5)
- [x] `/patients/me` for patients
- [x] Portal invite + self-signup linking with reception confirmation
- [x] Reception pages: patient list, new patient form, patient details
- [x] Patient profile page
- [x] Tests: duplicates, visibility per role, `patient.view` audit entries

**Done when:** reception registers and finds patients; a patient logs in and sees only their own profile.
Verified 2026-09-24: `npm run seed -- --reset` then `npm run seed` (second run creates nothing), `npm run smoke` (31 checks, incl. patient1 → own record 200 / another record 404, phone search in national format, reception vs admin field sets, pending sign-up blocked, doctors see no patients, lab techs 403). Live API check: a patient gets 404 on another record and 403 on every staff endpoint; five reads by one receptionist → one `patient.view` entry. Browser check (Playwright + Chrome, 360 px and 1280 px): patients list, search, new patient, pending verifications, patient details, admin list, patient dashboard and profile, pending sign-up landing – no horizontal overflow. Full suite run 3 times in a row: all green.

**Notes / decisions:** (recorded as D60–D78 in spec §20 "Decisions made")
- **Access (D60–D62):** receptionists see and record **allergies** (new `allergies` access scope) but not chronic conditions; admins see neither and have read-only patient pages (plus deactivate/reactivate); lab technicians get no patient endpoints until Phase 6; doctors pass the role check on list/read/clinical profile but `canAccessPatient` returns false until Phase 5 (empty list / 404). Patients may open only their own record (`/patients/me` or their own id); any other id → 404.
- **Linking (D63–D65):** self-signup matches phone + DOB in one transaction – no match → new record, linked; match without an account → user `pending_verification` (sees nothing; `authenticate` only sets `patientId` for linked users); every match already has an account → 422 with a generic message. Reception confirms (email "records available") or rejects (a new record with a new MRN, e.g. twins). `PATIENT_LINK_PENDING` (403) for `/patients/me` while pending. Registration now requires `consent.dataProcessing: true`.
- **Data (D66–D69):** phones are E.164 via `libphonenumber-js` (default +91) for **every** phone field, including staff and settings; `nameKey` (lower-case, single spaces) for the name + DOB duplicate check; MRN `MRN-000001` from the counter inside the create transaction; ages in the clinic timezone.
- **Search (D70):** MRN → exact; phone-like → exact E.164; otherwise every word must be an anchored, case-insensitive prefix of the first or last name (`^word`, escaped). No `$text` fallback yet (the text index exists). Older admin catalogue/user searches keep their escaped substring match.
- **Audit (D71–D72):** new actions `patient.update_duplicate_override`, `patient.deactivate`, `patient.activate`, `patient.link_confirm`, `patient.link_reject`; patient updates record changed field names, with values only for gender, blood group, language, active status and consents (names, DOB, contact details and allergies are `[REDACTED]`). `patient.view` is debounced 5 min per user + patient; list and duplicate-check reads are not audited per row. `patient.clinical_profile_update` is covered with a stand-in care relationship until Phase 5.
- **Endpoints beyond §7.7 (D73):** `GET /patients/pending-links`, `POST /patients/:id/reject-link`, `POST /patients/:id/activate`; `?force=true` became `force: true` + `reason` (≥ 10 chars) in the body; deactivate/activate need a reason (≥ 5).
- **Seed + migration (D74):** 60 patients through the service (reception1 as actor), `patient1…8` linked, `pending1@medassist.dev` pending (reset to pending on every run), two "Amit Patel" records; `npm run migrate:link-patients` links pre-Phase 3 patient users (dev/test only, idempotent, lists users with missing data).
- **Client (D75–D76):** pending patients start at `/patient/verify-identity` from login, register and the home redirects (`homeFor()`), so the redirects never race; live duplicate check on the new-patient form; the sidebar shows the pending-verification count (60 s poll). `Card` sections are now labelled by their title.
- **Not built (D77):** `GET /audit-logs/patient/:id` (D21) – still open; patient timeline (Phase 8); global `/search`.
- **Flaky tests fixed (D78):** the rare `Parse Error: Expected HTTP/` / "login failed: 404 {}" failures (also the three one-offs noted in Phase 2) came from supertest starting a server on `::` per request and connecting to `127.0.0.1:<port>`; on macOS another process (e.g. another worker's in-memory mongod) can hold that port on 127.0.0.1 and wins. Test servers now listen on 127.0.0.1 only: one shared server per test file (`api()`), `serve(app)` for small test apps.
- Tests: 948 server (was 747) + 106 client (was 78). Phase 3 complete 2026-09-24.

<details>
<summary>Phase 3 manual test script (seeded DB, password <code>Password@123</code>)</summary>

Receptionist (`reception1@medassist.dev`):
1. Patients → type `98765` into Search: nothing happens until you pause; the URL gets `?q=…`. Search by an MRN (`MRN-000010`, or `mrn 10`) and by part of a first name (`amit`): both "Amit Patel" records appear.
2. New patient → enter the name and date of birth of an existing patient (open "Amit Patel" first to copy them) or their phone + DOB. A "Possible existing patient" panel appears with "Open existing record". Click "This is a different person": an empty reason is refused; give one (≥ 10 characters) and the patient is saved with a new MRN (toast), and you land on the record.
3. On a new patient with an email: "Invite to patient portal" (banner, or the Portal access tab) → confirm. The console-email log in the API terminal shows the set-password link; the Portal tab shows "Portal invited".
4. Pending verifications (sidebar badge "1"): `pending1@medassist.dev` next to the matched record. "Confirm identity" → dialog reminds you to check photo ID → confirm; the list empties and the badge disappears. (Re-seed to reset it; or try "Not this person" with a reason → a separate record with a new MRN.)
5. Open a patient with allergies: red chips in the header; Edit details → set the phone and date of birth to another patient's → the duplicate panel appears (Cancel to discard).

Admin (`admin@medassist.dev`):
6. Patients: no "New patient" button; open a patient: no allergies anywhere, no Edit button. Deactivate → reason required → the badge shows "Inactive"; it disappears from reception's list; "Show inactive only" finds it; Reactivate.

Patient:
7. Register (log out first) with new details → you land on the dashboard; "My details" shows an MRN.
8. Register again (another email) with the phone + DOB of a seeded patient without a login (e.g. from reception's list, a patient with "No portal") → "Almost there – show your photo ID" page; the dashboard shows only the verification banner; My details says it is waiting. Register a third time with the same phone + DOB → "We couldn't create your account. Please contact the clinic." (+ the clinic phone).
9. As `patient1@medassist.dev`: My details → name, DOB, gender, blood group are read-only ("Contact reception to change these"); change the city and save; turn off AI explanations (a dialog explains it first); allergies and conditions are read-only.
10. At 360 px width (browser dev tools), repeat 1, 4 and 9: lists become cards, nothing scrolls sideways.
</details>

---

## Phase 4 – Appointments and queue
**Goal:** conflict-free booking and a live queue.
**Spec:** §4.5–4.6, §4.13, §5.1, §6.12, §7.8–7.9, §8.1–8.4, §8.11

- [x] Slot generation (schedules, leave, existing bookings, timezone)
- [x] Booking with transaction + partial unique index (doctor clash, patient clash, limits)
- [x] Reschedule, cancel (with policy), walk-ins with overbook allowance
- [x] Appointment state machine + action endpoints
- [x] Check-in, tokens, queue ordering, call next
- [x] Socket.IO for queue updates; queue board (no names)
- [x] Jobs: reminders, no-show marking
- [x] Doctor leave → affected appointments
- [x] UI: reception calendar (drag to reschedule), booking modal, patient booking wizard, queue screens
- [x] Tests: slot generation, concurrent booking race, invalid transitions, cancellation window

**Done when:** two people cannot book the same slot, and the queue updates live on the doctor's and reception's screens.
Verified 2026-09-24: race tests (10 parallel bookings of one slot → one 201; a 30-min and an overlapping 15-min service; one patient with two doctors; two reschedules into one slot; booking vs cancel) run 5 × in a row, all green. `npm run seed -- --reset` then `npm run seed` (second run creates nothing: 309 appointments unchanged). `npm run smoke` against the running dev API: 40+ checks incl. two real parallel bookings of one slot (one 201, one 409 `SLOT_UNAVAILABLE`), a real `queue.updated` Socket.IO event with ids only, the kiosk board (no patient data, wrong key 401), patient1 404 on someone else's appointment. Live queue updates are covered by server socket tests (events after commit, room rules) and a client test (a socket event refreshes the queue columns). **Not yet checked in a real browser** – see the manual test script below.

**Notes / decisions:** (recorded as D79–D96 in spec §20 "Decisions made")
- **Booking lock (D79–D80):** every booking/reschedule/walk-in/undo runs in `withTransaction` and bumps `bookingVersion` on the doctor and the patient first; overlapping transactions conflict and the driver's retry sees the first booking. The partial unique index `{ doctor, startAt }` stays as the last guard. Leave and schedule writes take the same lock. Patient clashes count open appointments only; the 15-min lead time applies to everyone; clinic working days apply on top of schedules.
- **State machine (D81):** `STATE_MACHINES` in constants, `assertTransition()` in `utils/stateMachine.ts`; every status change goes through `applyTransition()` (conditional update, `statusHistory`, `isSlotActive` – the model refuses status updates without it). New audit actions `appointment.update`, `appointment.undo_no_show`, `appointment.priority_change`.
- **Error codes (D82):** `SELF_BOOKING_DISABLED` 403, `OUTSIDE_BOOKING_WINDOW` 422, `OVERBOOK_LIMIT_REACHED` 422.
- **Scope (D83):** start only changes the status (`TODO(Phase 5)` encounter draft); cancel does not touch billing (`TODO(Phase 7)`). One consultation per doctor per clinic day.
- **Walk-ins, no-shows, priority, tokens (D84–D86):** next free slot of the running session, else an overbook place (settings limit); manual no-show only after the start; undo same day, flagged `noShowUndoneAt` for the job; queue priority with a reason in `priorityHistory`; tokens from `token:<doctorId>:<date>` inside the transaction (audit key `queueNumber`).
- **Queue, board, sockets (D87–D88):** ordering and estimated wait per §8.4; board with `KIOSK_KEY` (unset = off), tokens/doctors/rooms only, rate-limited; Socket.IO handshake with the access token (`resolveAccessToken`) or the kiosk key, rooms per doctor/date, ids-only events after commit.
- **Notifications and jobs (D89–D90):** `notify()` sends email only until Phase 10 (number + time + clinic, no clinical details); reception is emailed about leave impact; reminders ± 15 min, never twice; node-cron jobs only with `JOBS_ENABLED=true`, exported as `runReminderJob(now)` / `runNoShowJob(now)`.
- **Access (D91–D92):** reception acts on all appointments; admins view only (UI); doctors see their own with a minimal patient view and may start/complete; patients their own (others → 404), cancelling/rescheduling online only outside `minCancelHours` (now in the public settings).
- **Leave impact (D93):** leave and schedule responses list affected appointments; leave over appointments in consultation or completed → 409; reception emailed.
- **Seed (D94):** ~310 appointments (history, today's live queue, upcoming incl. patient1), prints the kiosk URL; `--reset` clears appointments and token counters.
- **Client (D95):** reception calendar (react-big-calendar with clinic "wall dates", drag to reschedule, resource columns) and list; booking modal; appointment details/drawer with status-aware actions; reception and doctor queue screens; walk-ins; patient appointments, booking wizard and token card; public kiosk board; admin read-only list; leave-impact panel. Found and fixed: a wrong kiosk key made the app loop refresh → logout → refetch (the board is now excluded from the 401 refresh).
- **Rate limits (D96):** patient bookings/reschedules 20/h per user; board 60/min per IP.
- New packages: `socket.io`, `node-cron` (server), `socket.io-client` (client; server dev for tests), `react-big-calendar` + `@types/react-big-calendar` (client).
- **You must set in `server/.env`:** `KIOSK_KEY` (≥ 24 random characters; the board is off without it) and `JOBS_ENABLED=true` on the one API instance that should run the reminder/no-show jobs. Restart the API after changing `.env`.
- `npm audit`: 2 moderate advisories in React Router (open redirect in `<Link>`/`navigate` with backslashes; SSR hydration) – fixed only in v7 (breaking); not addressed yet.
- Tests: 1301 server (was 948) + 148 client (was 106). Phase 4 complete 2026-09-24.

<details>
<summary>Phase 4 manual test script (seeded DB, password <code>Password@123</code>; restart <code>npm run dev</code> after editing <code>.env</code>)</summary>

Live queue – two windows side by side (use a private window for the second login):
1. Window A: `reception1@medassist.dev` → Queue → the doctor tab of `dr.mehta@medassist.dev`. Window B: `dr.mehta@medassist.dev` → My queue.
2. B: if someone is "With you now", click Complete → confirm. A: within a second the card moves to Done (short entrance animation), without reloading.
3. B: Call next. A: the emergency token (the seed puts one in the queue) moves to In consultation. B: Call next is now disabled ("with you now" shows the patient).
4. A: on a waiting card, Change priority → Emergency with a reason; B: the waiting list reorders at once.
5. A: Walk-in → search a patient (e.g. "amit") → General Medicine → Anil Mehta → priority Normal → Check in walk-in. The toast shows the token; B shows the new patient at the end of the waiting list.
6. A: under "Today's appointments", Check in a scheduled patient → a token appears in both windows.

Same slot from two windows at once:
7. Both windows as receptionists (`reception1` and `reception2`): Appointments → Book appointment, the same doctor, the same date and the same time, different patients. Click "Book appointment" in both as close together as you can: one succeeds; the other shows "This slot was just taken…", the times reload without that slot, and the patient/doctor/date stay filled in.
8. Appointments → Calendar (day view, all doctors): drag a scheduled appointment to another time → give a reason → it moves. Drag one onto a time that is taken → it snaps back with the error.

Patient:
9. `patient1@medassist.dev` → Dashboard: "Your token" (the seed puts patient1 in the queue of the first doctor working today – dr.mehta on Mon–Sat) with patients ahead and the estimated wait; Next appointment.
10. Appointments → Book appointment: General Medicine → a doctor card (fee, languages) → a date with free times → a time → a reason → Confirm. It appears under Upcoming.
11. On that appointment: Change time → another date/time → saved; then Cancel → confirm → it moves to Past as Cancelled. An appointment less than 2 hours away shows "please call the clinic" instead of the buttons.
12. Admin → Settings → Appointments: turn off patient self-booking → as patient1, Book appointment shows "Online booking is turned off" (turn it back on).

Kiosk board:
13. Open the URL the seed prints (`http://localhost:5173/queue-board?key=…`): full screen, clinic clock, one tile per doctor with room, "Now" and the next tokens – no names. Repeat step 3 in window B: the board updates within a second (or 15 s if the socket is blocked). Change one character of the key → "The kiosk key is not valid."

Other roles and sizes:
14. Doctor → Appointments: own calendar (read-only; no dragging); open an appointment – only Start/Complete buttons. Admin → Appointments: list and details with no action buttons.
15. At 360 px (dev tools): Appointments opens as a list, the queue columns stack, the booking wizard and the board fit without sideways scrolling.
</details>


---

## Phase 5 – Visit notes and prescriptions
**Goal:** doctors document consultations and prescribe safely.
**Spec:** §4.7, §5.2–5.3, §6.13–6.16, §7.10, §7.12, §8.5–8.6

- [x] Encounter model (draft → signed → amended), created on consultation start
- [x] Vitals (BMI auto), notes, diagnoses, plan, follow-up plan
- [x] Autosave with optimistic concurrency
- [x] Sign transaction (issue prescription, complete appointment)
- [x] Amendments with reason and versions
- [x] Prescriptions with allergy warning + acknowledgement; cancel/reissue
- [x] Care-relationship checks in `canAccessPatient`
- [x] Consult workspace UI (patient header, allergy banner, tabs, sign)
- [x] Tests: locked after sign, amendments, access without care relationship → 404

**Done when:** a doctor completes a full consultation from queue to signed note and issued prescription.
Verified 2026-09-24 (automated): `npm run lint`, `npm run format:check` and `npm test` three times in a row – 1544 server + 179 client tests, all green each run. `npm run seed -- --reset` then `npm run seed` (second run: 0 notes, 0 prescriptions created; "users 5 updated" is the existing demo-account repair). The full flow queue → start → autosaved note → allergy-acknowledged prescription → sign (note signed, RX issued, appointment completed in one transaction) → print → amend is covered end to end by server tests (`encounters.*`, `prescriptions.test.ts`, `phase5.security.test.ts`) and client tests (`ConsultWorkspace`, `Prescriptions`, `DoctorPages`). **Not yet checked in a real browser** – see the manual test script below.

**Notes / decisions:** (recorded as D97–D118 in spec §20 "Decisions made")
- **Care relationship (D97–D98):** `CARE_RELATIONSHIP_CHECKS` in `policies/patientAccess.ts` – for now "a non-cancelled appointment with the patient" (no-shows count). A doctor with a relationship gets demographics, clinical, lab and allergies (not billing); otherwise 404 + `access.denied`. `canAccessPatient` is async and cached per request (WeakMap keyed by the `AuthUser` object). Break-glass is not built.
- **Doctor patient endpoints (D99):** `GET /patients?scope=mine` (one aggregation: last visit, `hasAllergies`), `GET /patients/:id` (doctor view), `PATCH /patients/:id/clinical-profile`.
- **Encounters (D100–D104):** draft created in the start / call-next transaction (idempotent, unique per appointment; responses carry `encounterId`); `GET /appointments/:id/encounter`; `visitAt` added to §6.13; editing with `expectedVersion` = `__v` (API field `revision`) → 409 CONFLICT; documentation window: in consultation or ≤ 72 h after completion, else 422 `DOCUMENTATION_WINDOW_CLOSED`; drafts are private to their author, other related doctors see signed notes only; list rows carry no clinical text except the primary diagnosis in one patient's history (audited read); `GET /encounters?mine=true`.
- **Immutability (D105):** Mongoose hooks refuse every update of a signed/amended note unless the amendment service passes its internal token (`amendmentWriteOptions`); notes and prescriptions are never deleted; issued prescriptions allow status bookkeeping only; `note_amendments` is append-only with unique `{ encounter, version }`.
- **Signing (D106–D107):** `POST /encounters/:id/sign` needs `expectedVersion`; 422 `SIGN_VALIDATION_FAILED` / `ALLERGY_ACK_REQUIRED` with `details`; one transaction: note signed, draft prescription (with items) issued with its RX number, appointment in consultation → completed; audit + queue event after commit; empty vitals = warning. TODO(Phase 6/7/8) markers for lab orders, invoice and follow-up reminder.
- **Prescriptions (D108–D112):** `isCurrent` + partial unique index replaces "unique encounter"; number on issue; drafts may hold incomplete items (checked at sign/issue); reissue = cancel + a linked draft (acknowledgements cleared), editable although the note is signed, issued with `POST /prescriptions/:id/issue`; cancel/reissue/issue are not limited by the 72 h window; draft → cancelled not allowed; reception lists prescriptions only per patient/appointment/encounter (issued/completed); `GET /prescriptions/:id/print` (clinic registration/GSTIN, doctor registration, follow-up; no diagnosis).
- **Allergy check (D113):** whole-name match of drug, generic and formulary brand names against recorded allergies plus `data/allergyClasses.ts` (penicillins, cephalosporins, sulfonamides, NSAIDs, macrolides, quinolones, …); an allergy to one member warns for its class; acknowledgement stored per item, kept across autosaves of the same drug, re-checked against current allergies at sign/issue. Labelled a convenience check everywhere.
- **Audit (D114):** new actions `encounter.create|view|update|sign|amend`, `prescription.update|issue|cancel|reissue|complete|view`; clinical records audit field names and counts only; autosaves (`encounter.update`, `prescription.update`) debounced 5 min per user + record; 4xx messages never name drugs or allergies (details only).
- **Formulary + job (D115):** 123 drugs in `data/formulary.ts`, `GET /formulary?q=` (prefix of name or generic, doctors); `runPrescriptionCompletionJob` daily 02:00 (24-hour days from `issuedAt`).
- **Client (D116–D117):** consult workspace `/doctor/consult/:appointmentId` (sticky header, allergy banner announced once, tabs, history side panel/drawer), autosave (2 s debounce, blur, tab change, Ctrl/⌘+S, one request in flight, offline back-off, conflict banner with "Reload latest") in memory-only `consultDraft` / `rxDraft` slices; review & sign dialog with links to fields; amend modal; prescription editor (formulary combobox, allergy acknowledgement, preview; incomplete rows never sent); `/print/prescriptions/:id` without app chrome (`PrintLayout`, A4, diagnosis toggle for doctors only); My patients, patient page, Notes (drafts > 24 h "Unsigned").
- **Seed (D118):** ~20 note templates; a signed note for every completed appointment (seed-only path skipping the 72 h window), ~85 % prescriptions, ~40 % follow-ups, allergy-safe prescribing except one acknowledged demo, 3 amendments, drafts for today's consultations.
- Fixed on the way: a latent department-code collision in the RBAC matrix; a vital typed past its range left the last valid keystroke pending.
- No new packages.
- Tests: 1544 server (was 1301) + 179 client (was 148). Phase 5 complete 2026-09-24.

<details>
<summary>Phase 5 manual test script (seeded DB, password <code>Password@123</code>)</summary>

Seed data used: **Rahul Verma** (MRN-000002, penicillin allergy, portal login `patient2@medassist.dev`) is checked in with `dr.mehta` today; `dr.saini` has no appointment with him. (Today's queue depends on the clinic date – re-seed with `--reset` if it looks different.)

Doctor (`dr.mehta@medassist.dev`):
1. My queue → "With you now" shows a seeded patient already in consultation → Open consultation → a partly written draft (chief complaint, vitals). Review & sign → it lists "Add at least one diagnosis" as a link → the link opens Diagnosis & plan with the focus in place → add a diagnosis → Review & sign → Sign note. The success card offers "Call next patient".
2. Call next patient → the workspace of the next waiting patient opens (the header shows allergies in red or "No known allergies"). To reach Rahul: My queue → Appointments → Rahul's appointment → Start consultation (or repeat 1–2 until he is called).
3. Rahul's workspace: the red banner reads "Allergies: Penicillin (severe)". Vitals: weight 70, height 175 → BMI 22.9 appears; pulse 400 → "Between 20 and 250" (not saved). Notes: type a chief complaint, stop typing → header "Saving…" → "Saved hh:mm".
4. Second tab: open the same URL, change the plan there and wait for "Saved". Back in the first tab, type in any field → after 2 s the red banner "This note was changed in another tab or window" appears, Review & sign is disabled → Reload latest → confirm → the other tab's text shows.
5. Diagnosis & plan: add "Acute tonsillitis" (J03.9, primary). Prescription: Add drug → type "amox" → pick Amoxicillin (generic, strength, dose and TDS fill in). The row turns red: "Matches the recorded allergy “Penicillin” (Penicillins)". Review & sign → blocked with the allergy item listed. Tick "I have reviewed this allergy warning" → Review & sign → Sign note.
6. Print prescription → the print page (no sidebar): clinic header with registration/GSTIN (if set in Settings), doctor qualifications + registration no., "Three times a day", "After food", no diagnosis line; "Show diagnosis" adds it. Print → the browser's A4 preview shows only the sheet.
7. The signed note: "Signed by Dr Anil Mehta on …", Version 1 → Amend → tick Plan → change it → reason "short" is refused, a 10+ character reason saves → Version 2, the Amendment history shows before/after. Prescription: Reissue with a reason → a new draft opens → change the frequency → Issue prescription → a new RX number.
8. Notes (sidebar): drafts older than 24 h show "Unsigned". My patients: Rahul has the allergy flag; his page lets you edit allergies/conditions.

Reception (`reception1@medassist.dev`):
9. Appointments → Rahul's (now completed) appointment → Print prescription → the same sheet without the diagnosis toggle. Opening `/doctor/consult/<id>` directly shows the 403 page.

Other doctor (`dr.saini@medassist.dev`):
10. Open `/doctor/patients/<Rahul's patient id>` (copy it from dr.mehta's URL) → "Patient not found"; `/doctor/encounters/<note id>` → not found. My patients does not list him.

Patient (`patient2@medassist.dev`): 11. `/print/prescriptions/<RX id>` shows his own prescription (portal pages come in Phase 8).

At 360 px: the history panel is a drawer ("Patient history" button), prescription rows stack, nothing scrolls sideways.
</details>

---

## Phase 6 – Lab workflow and documents
**Goal:** lab orders from ordering to release, and secure file uploads.
**Spec:** §4.8, §5.4, §6.20, §6.23, §7.14, §7.16, §8.7, §12.2

- [x] Lab orders from encounters (priority, clinical notes)
- [x] Sample collection (sample id), rejection, recollect
- [x] Result entry with automatic flags; critical value alerts
- [x] Dual verification, send back, release, revision after release
- [x] Lab report PDF generated on release
- [x] Documents: upload (type/size checks), list, authorized download, soft delete
- [x] Lab worklist UI (tabs by status), order detail with results grid
- [x] Doctor "results to review" page
- [x] Tests: flags, self-verification blocked, patient visibility only after release

**Done when:** an order moves through every status and the patient sees the released PDF report.
Verified 2026-10-06: `npm run lint`, `npm run format:check`, `npm run typecheck` clean; `npm test` (server + client) run 3 times in a row – all green, nothing intermittent. `npm run seed -- --reset` then `npm run seed` (second run creates nothing: 80 lab orders and 3 documents unchanged). `npm run smoke` (61 checks, twice in a row) now has Phase 6 checks (lab worklist, minimal patient view for the lab, patient1's released reports without internals, PDF download headers, 404 on someone else's order, reception status-only view, admins 403 on `/lab-orders`, no `storageKey`, a fake PNG refused with 415). The manual test script below was run end-to-end over the HTTP API against a separate API instance on the seeded DB (30 checks: draft → ordered on signing, collect + label, processing, a critical value flagged by the server although the client sent "normal", `lab.critical` once with ids only, the doctor's critical row, self-verification blocked for results and for the revision, release with the PDF, the patient's view and download, revision pending → verified → "Corrected", only the current report visible to the patient, audit entries with field names only, fake PNG 415). Statuses `sample_rejected` → recollect, send-back and cancellation are covered by `labWorkflow.test.ts`. **Not checked in a real browser by Claude** – please run the script below in the UI.

Final check (security review of the checklist): patients never see draft/unreleased orders, pending revisions, previous versions or remarks; lab techs get name, MRN, age, sex and allergies only; receptionists never see results; admins have no lab order endpoints (document metadata only); flags are computed on the server (client flags stripped); critical alerts are claimed once per result version and carry no clinical text (email or socket); dual verification applies to verify and verify-revision; uploads are magic-byte checked, size-limited, per-role, never served statically, `storageKey` never exposed, downloads audited with `attachment`/`nosniff`/`no-store`; every lab status change goes through `assertTransition` (`applyOrderTransition`), is audited with field names/counts only and emits ids-only events after the commit; every Phase 6 endpoint has an RBAC matrix row (`routeInventory.test.ts` enforces it). **One leak found and fixed:** item remarks were hidden in the patient API but printed on the report PDF, which the patient downloads – remarks are now internal (lab + doctors) and the form says so (D127).

**Notes / decisions:** (recorded as D119–D134 in spec §20 "Decisions made")
- **Ordering (D119):** lab orders start as `draft` (private to the ordering doctor, editable/discardable) and are placed when the note is signed (in the sign transaction: `ordered`, `LAB-YYYY-NNNNNN`, `orderedAt`); "Order more tests" on a signed note within 72 h places at once. The doctor cancels a whole order only while no sample is held; single tests until their results are complete.
- **Access (D120–D121):** a placed lab order is a care relationship (`CARE_RELATIONSHIP_CHECKS` + `relatedPatientIds`); lab techs reach patients only through placed orders and see a minimal patient view; views per role (lab: everything; doctor: results once entered, marked unverified, criticals at once; reception: status + prices; patient: own released, current results only; admin: none).
- **Results (D122–D125):** flags only on the server (age at collection + sex, `abnormalOptions`); partial saves; `RESULTS_INCOMPLETE` (422, new code); dual verification (`SELF_VERIFICATION_NOT_ALLOWED`) for verify and verify-revision; send-back keeps values; revision after release = `released → released`, pending until a second technician verifies; released items locked at the model level except the revision path.
- **Critical values (D126):** email + `lab.critical` to the ordering doctor once per item result version (conditional claim), no clinical text; unacknowledged criticals count as "to review"; release resets the acknowledgement.
- **Remarks (D127):** internal – never in the patient view or the PDF.
- **PDF + files (D128–D130):** `services/pdf.service.ts` (PDFKit) for every server PDF; the lab report is built before and stored inside the release/revision transaction as a generated Document (older ones hidden from the patient); storage adapter (`local` under `UPLOAD_DIR`; s3/cloudinary stubs until Phase 11); multer memory storage, magic-byte check (`file-type`), SHA-256, sanitised names, 30 uploads/h/user; downloads stream through the API (audited, safe headers); upload/read categories per role; soft delete by admins or the uploader within 24 h, generated documents never.
- **Sockets, TAT, notifications (D131–D132):** `lab.worklist.updated` (lab room), `lab.order.changed`, `lab.critical` – ids only, after the commit; hourly `runLabTatJob` sets `tatBreachedAt` once; sample rejected → patient + reception, released/revised → patient + doctor, without test names or values.
- **Seed (D133):** 80 lab orders through the lab services (55 released with PDFs, 3 criticals, a revision, cancelled tests, acknowledgements; patient1 always has a report), 3 demo documents; `--reset` also clears the upload directory.
- **Client (D134):** lab worklist + order page + sample label print page; consult Lab orders tab; doctor Lab results with a persistent critical banner; patient Lab reports ("Corrected") and Documents; reception Documents and Lab orders tabs; FileUpload / DocumentList / FilePreview.
- **Smoke:** Phase 6 checks run inside the Phase 5 sessions (only `lab1` logs in again): logins are limited to 10 per 15 min per email + IP, and separate logins made two back-to-back runs fail with 429. Now 61 checks, two runs in a row green.
- New packages: `multer`, `file-type`, `pdfkit` (server).
- **You must set in `server/.env`** (optional – the defaults work for local dev): `STORAGE_DRIVER=local`, `UPLOAD_DIR` (default `./uploads` under `server/`, gitignored; must be outside `client/`; back it up – it holds patient files) and `MAX_UPLOAD_MB` (default 10, 1–50). Restart the API after changing `.env`.
- **Watch in Phase 7:** invoice/receipt PDFs must use `pdf.service` and be stored as generated Documents (category `invoice`, which reception already reads); the draft invoice on signing should include placed lab orders at `testSnapshot.pricePaise` and drop cancelled tests; a narrow race remains in `verify` (the self-verification check runs before the conditional update – harmless in practice because it needs the verifier to re-enter results in between).
- Tests: 1785 server (was 1544) + 206 client (was 179). Phase 6 complete 2026-10-06.

<details>
<summary>Phase 6 manual test script (seeded DB, password <code>Password@123</code>)</summary>

Seed data used: today's queue has patients checked in with `dr.mehta`; patient logins `patient1…8` (find which one is in today's queue on reception's Queue screen). Re-seed with `--reset` if today's queue looks different.

Doctor (`dr.mehta@medassist.dev`):
1. My queue → finish the patient "With you now" (Review & sign) → Call next (or start a checked-in patient with a portal login).
2. In the consultation: Lab orders tab → search "CBC" → add; search "HbA1c" → add; priority Urgent; clinical notes "Fatigue". The order shows as a draft (no number). Review & sign → the dialog lists the 2 lab tests → Sign note. The Lab orders tab now shows `LAB-2026-…` "Ordered".

Lab technician 1 (`lab1@medassist.dev`, second browser/private window):
3. Worklist → the new urgent order is at the top of "Ordered" (it appeared without reloading). Open it → Collect sample → the label page opens (large sample ID `S26-…`, patient name, MRN, tests) → Print → close.
4. Start processing → enter CBC: Haemoglobin **6.1** (the flag preview shows Critical low), the other values in range, a remark → Save. Enter HbA1c 7.2 → Save. The order moves to "Results entered".

Doctor:
5. Without reloading, a red critical-result banner appears; Lab results lists the order first with a critical count; the results show "Unverified". (The remark is visible to the doctor.)

Lab technician 1:
6. Verify → blocked: "Results must be verified by a different lab technician…" (the button explains it).

Lab technician 2 (`lab2@medassist.dev`):
7. Open the order → Verify → Release (confirm). "Download PDF" works; the PDF has no remark.

Patient (the order's patient):
8. Lab reports → the order with High/Low/critical shown as text + icon and calm wording → Download PDF. Before step 7 the order was not listed at all.

Lab technician 1:
9. On the released order → HbA1c → Revise → value 6.8, reason "Transcription error" → Save: "Waiting for verification". Verify revision as lab1 → blocked.

Lab technician 2:
10. Verify revision → the item shows Version 2 with before/after.

Patient:
11. Lab reports → the order has a "Corrected" badge; the report shows 6.8 and only the new PDF (version 2); 7.2 is nowhere.

Uploads:
12. As the patient: Documents → Upload → rename any text file to `fake.png` and choose it → the client accepts the extension, the server answers "Only PDF, JPG and PNG files can be uploaded". A real PNG/PDF uploads and appears in the list; a file over 10 MB is refused.
13. As `admin@medassist.dev`: no Lab menu; opening `/lab/worklist` shows the 403 page. As `reception1`: the patient's Lab orders tab shows status and prices only.

At 360 px: worklist rows become cards, the results grid stacks, nothing scrolls sideways.
</details>

---

## Phase 7 – Billing
**Goal:** correct invoices, partial payments and refunds.
**Spec:** §4.9, §5.5, §6.21–6.22, §7.15, §8.9

- [x] Draft invoice created automatically on signing (consultation + lab tests)
- [x] Edit draft, discount limits, issue (number assigned, locked)
- [x] Payments (cannot exceed balance), refunds, void rules
- [x] Server-side totals and tax in paise
- [x] Invoice and receipt PDFs
- [x] Reception invoice list/editor + payment modal; patient invoice pages
- [x] Tests: totals and rounding, overpayment, refund, void

**Done when:** a completed visit produces an invoice that can be paid in parts and printed.
Verified 2026-10-07: `npm run lint`, `npm run format:check`, `npm run typecheck` clean; `npm test` (server + client, incl. the 10-parallel-payments and 20-parallel-issues races) run 3 times in a row – __TESTRUNS__. `npm run seed -- --reset` then `npm run seed` (second run creates nothing: 215 invoices unchanged). Every seeded invoice checked through the HTTP API (215: lines, Σ line totals, amount paid = Σ payments with refunds negative, balance = total − paid, status matches the amounts, list totals) – no mismatch. `npm run smoke` (70 checks, twice) now has Phase 7 checks. The manual test script below was run end-to-end over the HTTP API against a separate API instance on the seeded DB (26 checks, all passed): sign with 2 lab tests → draft with consultation + 2 tests → dressing added → 20 % discount refused for reception → issue → partial UPI → cash for the rest → part of the cash refunded → invoice + 3 receipt PDFs (₹, amount in words, masked reference, REFUND label; a void invoice shows VOID) → day close totals → admin approves a 30 % discount on another draft → the lab cancels a test on the issued invoice → flagged under "Needs attention" with the invoice unchanged → patient1 lists and downloads own invoices (no drafts), 404 on someone else's, doctors and lab techs 403. **Not checked in a real browser by Claude** – please run the script below in the UI.

Final check: no float maths on money (billing maths only in `invoices/calc.ts` and the client preview `billing/calc.ts`, both integer/BigInt; display formatting in the money utils; the seed's demo amounts switched to integer maths); totals recomputed on every write and client totals stripped; issued invoices and payments locked at the model level (`invoice.model.test.ts`, `payments.test.ts` append-only); parallel payments and refunds can never overpay/over-refund (conditional update on the invoice version inside the transaction); sign, post-sign lab orders, lab item/order cancel and appointment cancel change invoices inside their own transactions (`billing.sync.test.ts`, incl. a forced failure that leaves no invoice and an unsigned note); patients see only their own non-draft invoices, doctors and lab techs get 403; PDFs print ₹ (Noto Sans) or "Rs." without the font, the amount in words and VOID; invoice/payment emails carry the number only – no amounts, lines or clinical details; every Phase 7 endpoint has an RBAC matrix row (`routeInventory.test.ts`). **Found and fixed:** the seeded admin-approved discount only covered the consultation, so with lab tests it could fall under the limit and no approval was recorded (date-dependent test failure) – the concession now covers every line. **Found and fixed (intermittent):** after a save the draft editor briefly showed the previous saved totals (it cleared "unsaved" before the cache held the server's answer) – the editor now shows the totals from the save response itself; the test waits for them instead of reading once.

**Notes / decisions:** (recorded as D135–D152 in spec §20 "Decisions made")
- **Automatic drafts (D135–D138):** signing creates/updates the visit's one draft (consultation from the appointment's service snapshot + placed lab tests) inside the sign transaction; tests ordered later go on the draft, or a `supplementary` draft once the invoice is issued; a cancelled test leaves a draft or is listed in `cancelledItemsBilled` on an issued invoice; a cancelled appointment voids its draft. All idempotent and inside the originating transaction.
- **Maths (D139):** `invoices/calc.ts` only – integer paise, tax half-up per line in BigInt; the client preview is display-only, the saved invoice shows the server's totals.
- **Discounts (D140):** above `maxDiscountPercentWithoutAdmin` only an admin can save (`DISCOUNT_REQUIRES_ADMIN`); an approval survives edits that do not raise a discount.
- **Editing and issue (D141, D143):** full line list + `expectedVersion`; visit lines keep price/quantity (discount only); desk lines from services, catalogue lab tests or "other"; number on issue with the settings prefix; `INVOICE_EMPTY`; locked after issue by model hooks.
- **States, payments, refunds (D144–D146):** status follows the amounts; void only with nothing paid (`VOID_REQUIRES_REFUND`); payments race-safe on the invoice version; references required for card/UPI/insurance; refunds capped per payment (`REFUND_EXCEEDS_PAYMENT`).
- **Roles (D142):** reception and admin manage invoices; payments by reception only; refunds by both; patients their own issued invoices; doctors/lab techs none. Billing rules travel in staff invoice views, not the public settings.
- **PDFs (D148–D149):** on demand (not stored, unlike §12.2), embedded Noto Sans for ₹ (SIL OFL, `server/src/assets/fonts`, copied by `npm run build`), "Rs." fallback, amount in words, VOID watermark, masked references.
- **Day close (D150), audit (D147), seed (D151), client (D152).**
- New error codes: `INVOICE_EMPTY`, `VOID_REQUIRES_REFUND`, `REFUND_EXCEEDS_PAYMENT` (422).
- **Not built:** a "settle cancelled tests as a credit" action – reception refunds them from a payment, which reopens the balance. Revisit if the clinic needs it.
- No new npm packages; two font files (Noto Sans, OFL) added.
- Tests: 1981 server (was 1785) + 219 client (was 206). Phase 7 complete 2026-10-07.

<details>
<summary>Phase 7 manual test script (seeded DB, password <code>Password@123</code>)</summary>

Doctor (a doctor with a patient "in consultation" today, e.g. from Reception → Queue):
1. Open the consultation → write a chief complaint and a diagnosis → Lab orders tab → order 2 tests → Review & sign → Sign note.

Reception (`reception1@medassist.dev`):
2. Queue → Done column → **Bill** on that patient (or Invoices → the newest draft). The draft shows the consultation and the 2 tests ("From the visit").
3. Add line → Service → a dressing procedure → Add line. Lines save by themselves ("Saving…" → "Saved"); the totals switch from "Preview" to the saved figures.
4. On the consultation line: discount → % → 20. The page warns "an admin must approve"; Save now → the red "Discount needs an admin" message. Set it back to 0.
5. Issue invoice → confirm ("After issuing, the invoice can't be edited") → the number appears, the page is locked, Balance due in large text.
6. Record payment → the amount is the balance; change it to about 40 % → UPI → Record payment without a reference → "Enter the UPI transaction ID" → add one → saved; status "Partly paid".
7. Record payment again → Cash → the rest → "Paid".
8. On the cash payment → Refund → the refundable amount is shown; try more than it (refused) → refund ₹100 with a reason → the refund appears under the payment; status "Partly paid", balance ₹100. Void invoice is disabled while money is held.
9. Download invoice → check ₹, the amount in words, the masked UPI reference; Receipt on each payment and the refund receipt ("REFUND").
10. Day close (sidebar) → today: the UPI and cash rows, the refund and the net; Print → the A4 sheet.

Admin (`admin@medassist.dev`):
11. Invoices → status chip Draft → open another draft → give a 30 % discount → it saves (the "Discount approved" field shows the admin).

Lab (`lab1@medassist.dev`):
12. Worklist → the order from step 1 → cancel one test with a reason.

Reception:
13. Invoices → "Needs attention" → the invoice from step 5 → the amber "Cancelled tests were billed" panel lists the test; the invoice itself is unchanged; refund it from a payment.

Patient (`patient1@medassist.dev`):
14. Invoices (sidebar) → the outstanding balance card and "Please pay at the clinic reception" → open an invoice → Download invoice and a Receipt; no drafts are listed; the dashboard shows the outstanding balance card.

At 360 px: the invoice lines become stacked cards, the list becomes cards, the day close tables scroll inside their box.
</details>


---

## Phase 8 – Patient timeline, portal and follow-ups
**Goal:** one chronological view of a patient's care, and a complete patient portal.
**Spec:** §4.10, §5.6, §6.18, §7.13, §8.8

- [x] Timeline aggregation service (permission-filtered, paginated)
- [x] Timeline UI for doctors, reception (non-clinical) and patients
- [x] Patient portal: appointments, prescriptions, lab reports, invoices, documents
- [x] Follow-up requests: create, threaded messages, schedule, close/reject
- [x] Follow-up reminders job
- [x] Tests: timeline filtering per role, follow-up flows

**Done when:** a patient can see their whole history and request a follow-up that reception schedules.
Verified 2026-10-08: `npm run lint`, `npm run format:check` clean; `npm test` (server + client) run 3 times in a row – __TESTRESULT__. `npm run seed -- --reset` then `npm run seed` (second run creates nothing: 15 follow-up requests unchanged, 311 appointments incl. the 2 booked through requests). `npm run smoke` passes against the dev API (no Phase 8 checks yet). The manual test script below was run end-to-end over the HTTP API against a separate API instance on the seeded DB – 22 checks, all passing: the follow-up due card and booking from it, the visit summary without and then (after the doctor's amendment) with the diagnosis, a request with an attachment, a reception reply plus an internal note that reaches no patient endpoint, the patient's answer reopening the request, the doctor booking from it, and the timelines per role (doctor: no billing; reception: no clinical items; admin: 403; no message text anywhere). **Not checked in a real browser by Claude** – please run the script in the UI.

Final check: the timeline is filtered per role before merging (reception: appointments, invoices, payments, non-clinical documents, follow-ups; doctors: no invoices or payments; patients: no drafts, unreleased lab orders, draft invoices, invisible documents or follow-up text; admins and lab technicians 403; a doctor without a relationship 404); cursor pages over mixed sources with equal times return every item once (tested over 3+ pages); staff-only messages never reach patients (detail, list counts, timeline, socket events, emails – which carry no message text at all); patient-safe note views never include history, examination, assessment or plan, diagnoses only when shared; scheduling goes through `bookAppointment` (conflict checks, booking lock, same transaction; a 409 leaves the request open); the reminder job claims each reminder once, skips booked ones and its email has no clinical content; the care relationship covers appointments, placed lab orders and assigned follow-up requests (checks and list filters); every Phase 8 endpoint has an RBAC matrix row (`routeInventory.test.ts`). **Found and fixed:** the "new request / new reply" email sent the assigned doctor a reception link – doctors now get `/doctor/follow-ups/:id`.

**Notes / decisions:** (recorded as D153–D165 in spec §20 "Decisions made")
- **Timeline (D153):** source registry with roles per source, filtered before merging; cursor `?before=&limit` (base64url `at|type|id`, `meta.nextCursor`), not page numbers; type and date filters; audited `patient.timeline_view`.
- **Patient-safe notes (D154–D155):** `shareDiagnosisWithPatient` (draft, or amendment after signing); the patient's `GET /encounters/:id` and `/patients/me/visits` never show history/examination/assessment/plan.
- **Follow-up requests (D156–D158, D161):** `FUR-<year>-…`; limits 3 open / 5 a day (`FOLLOWUP_LIMIT_REACHED`); messages `all`/`staff` (internal notes never to patients, no text in notifications or events); optional in review; reassign; scheduling through the booking service in one transaction; doctors book with themselves; admins read only (they see internal notes).
- **Reminders (D159–D160):** `followup_reminders` written in the sign transaction (the Phase 5 TODO is gone) and moved by amendments; daily 09:00, exactly two days before, never twice; booking link `?doctor=&followUpOf=`; `GET /patients/me/follow-ups-due` for the portal card.
- **Care relationship (D162):** + a follow-up request assigned to the doctor. "My patients" still lists appointment relationships only.
- **Sockets (D163), seed (D164), client (D165).**
- New error code: `FOLLOWUP_LIMIT_REACHED` (422).
- **Seed note:** patient1 is seeded at the clinic's limit of 3 upcoming visits (`maxActiveBookingsPerPatient`), so "Book follow-up" first asks them to cancel one – the wizard explains it.
- No new npm packages.
- Tests: __TESTCOUNTS__. Phase 8 complete 2026-10-08.

<details>
<summary>Phase 8 manual test script (seeded DB, password <code>Password@123</code>)</summary>

Patient (`patient1@medassist.dev`):
1. Home → the **Follow-up due** card (due in two days) → Book follow-up → the wizard starts at the date step with the doctor chosen and "Booking a follow-up visit". If it says "at most 3 upcoming appointments", cancel the latest one under Appointments and try again → pick a date and time → Confirm. The card disappears from Home.
2. Visits → a visit whose diagnosis column says "Not shared" → open it: vitals, advice and the follow-up plan, links to the prescription and lab reports, **no Diagnosis card**.

Doctor (the visit's doctor – see the visit page):
3. My patients → the patient → Timeline tab → that visit's note → Amend → tick "Share diagnosis with patient" → reason → Save amendment.

Patient:
4. Reload the visit: the Diagnosis card appears with "Updated after the visit".
5. Follow-ups → New request (the red "not for emergencies" banner is always there) → "New or worse symptoms" → related visit → a message → attach a PDF or photo → Attach → Send request → the conversation page.

Reception (`reception1@medassist.dev`):
6. Follow-ups (sidebar badge) → Open tab → the request → write a reply → Send. Switch on **Internal note** → write a note → Add internal note: it shows with a dashed amber border "Internal – not visible to patient".

Patient:
7. Open the request: only the reception reply (no internal note) → answer → the status goes back to "Open".

Doctor (assigned to the request):
8. Follow-ups → the request → Schedule → date and time → Book appointment → "Appointment booked" with View appointment; the request is Scheduled. Try a time someone else just took (or a second tab): "That time was just taken" and the request stays open.

Timelines:
9. As the doctor (patient page → Timeline): visits, notes, prescriptions, lab, documents, follow-ups – no invoices or payments. As reception (patient → Timeline tab): appointments, invoices, payments, ID/insurance documents, follow-ups – no notes, prescriptions or lab. As the patient (Timeline): everything of their own, drafts never; Load more at the bottom; filter chips and dates.

At 360 px: the patient bottom bar (Home, Appointments, Visits, Prescriptions, More); the inbox shows the list, then the request on its own page with "All requests"; chat bubbles wrap; nothing scrolls sideways.
</details>

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