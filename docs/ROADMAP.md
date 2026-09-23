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
| 4 | Appointments and queue | 🟡 In progress |
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