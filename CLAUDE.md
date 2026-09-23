# MedAssist – Clinic Operations & Patient Care Portal

MERN capstone: a clinic management system for admins, doctors, receptionists, lab technicians and patients.

- Full requirements: `docs/PROJECT_SPEC.md` (source of truth; cite sections like §8.2)
- Build plan and progress: `docs/ROADMAP.md`

Read the relevant spec sections for the current phase before planning. Do not read the whole spec every time.

## Current phase
**Phase 3 – Patients.** Spec: §4.3–4.4, §6.11, §7.7, §12.1 (and §2.3/§2.5 for access and field visibility). Only build what the current phase prompt asks for. Do not build features from later phases early. If something from a later phase seems needed, ask first.

## Stack
- Monorepo with npm workspaces: `server/` and `client/`
- Server: Node 20+, Express 4, Mongoose 8, Zod, Pino, JWT + bcryptjs, Socket.IO, Multer, PDFKit, Nodemailer
- Client: React 18, Vite, React Router v6, Redux Toolkit + RTK Query, Tailwind CSS, react-hook-form + Zod
- TypeScript with ES modules (strict). File names in the spec and below (`model.js`, `api.js`, `AppRoutes.jsx`) mean `.ts` / `.tsx`. Server imports use `.js` extensions (NodeNext).
- Tests: Vitest + Supertest + mongodb-memory-server (replica set, for transactions); React Testing Library
- AI: Anthropic Claude API via `@anthropic-ai/sdk`, behind `server/src/ai/ai.service.js`; `AI_PROVIDER=mock` for dev and tests

## Commands
- `npm run dev` – run server + client (`dev:server` / `dev:client` for one side). Dev API port is 5001 (macOS AirPlay holds 5000).
- `npm test` – server then client tests (`npm run test:client` for client only); `npm run test:coverage -w server` for coverage
- `npm run lint` / `npm run lint:fix` / `npm run format` / `npm run format:check` / `npm run typecheck`
- `npm run seed` – seed demo data (clinic set-up, staff, 8 doctors, lab tests; password `Password@123`); `npm run seed -- --reset` wipes first. Needs MongoDB as a replica set.
- `npm run smoke` – API smoke test against the seeded DB (auth, RBAC, audit chain, Phase 2 data, public field exposure, all demo logins). Reuses a server already running on `PORT` (and leaves it running); otherwise starts a temporary one on a free port and stops only that.

## Backend conventions (always follow)
- Features live in `server/src/modules/<feature>/` with `model.js`, `service.js`, `controller.js`, `routes.js`, `validation.js`, `serializer.js`.
- Controllers are thin; business logic goes in services; access rules go in `server/src/policies/`.
- Every route: `authenticate` → `authorize(...roles)` → `validate()` (Zod) → controller wrapped in `asyncHandler`.
- Respond with `sendSuccess()`; throw `ApiError` for failures. Never send raw Mongoose documents – use role serializers.
- Response format: `{ success, message, data, meta }` or `{ success: false, message, error: { code, details }, requestId }`. Error codes: spec §16.
- API routes under `/api/v1`. Status changes use action endpoints (`POST /appointments/:id/cancel`), not a generic status PATCH.
- Enums and state machine transitions live in `server/src/config/constants.js`.
- Money is integer paise. Dates stored in UTC; business days computed in the clinic timezone.
- Human-readable numbers (MRN, APT, INV…) come from the `counters` collection.
- Multi-document writes (booking, signing, payments) use MongoDB transactions.
- Config comes from the frozen `config` object in `server/src/config/env.ts` – never read `process.env` elsewhere. Add each new env var to the Zod schema and `server/.env.example` (with a comment) in the phase that needs it.
- Error codes: use `ERROR_CODES` from `constants.ts` (never string literals); add new codes to both `ERROR_CODES` and `ERROR_HTTP_STATUS`. Prefer `ApiError` helpers (`notFound`, `conflict`, `unprocessable`, …) or `new ApiError(status, message, ERROR_CODES.X, details)`.
- Validation errors are `details: [{ field: 'body.email', message }]`. Let Zod/Mongoose errors bubble to `errorHandler`; never format error responses in controllers.
- Mount new modules in `server/src/routes/index.ts`. Use `parsePagination()` / `buildMeta()` from `utils/pagination.ts` for lists.
- Logging: use `logger` (never `console`). Log errors via `serializeError(err)`, never raw error objects (they can carry request bodies or duplicate-key values).
- Tests: each file gets its own in-memory replica set (`tests/setup.ts`); use `api(router)` from `tests/helpers/testApp.ts` to mount test-only routes; assert errors with `expectErrorShape()`; log in with `loginAs(role)` and reset with `resetDb()` from `tests/helpers/auth.ts`; capture emails with `captureEmails()`.

## Auth, audit and access control (built in Phase 1 – reuse, don't reinvent)
- **Protect a route**: `authenticate` then `authorize(...roles)` (from `middlewares/`). A router where every route is admin-only can use `router.use(authenticate, authorize(ROLES.ADMIN))`. Only the routes listed in `PUBLIC` in `server/tests/routeInventory.test.ts` may skip `authenticate`.
  ```ts
  router.post('/', authenticate, authorize(ROLES.ADMIN, ROLES.RECEPTIONIST), validate(createSchema), asyncHandler(controller.create));
  ```
  `req.user` is `AuthUser` (`types/express.d.ts`): `{ id, role, sessionId, sessionFamily, firstName, lastName, email, mustChangePassword, patientId }`.
- **Audit** every sensitive read and write with `services/audit.service.ts`. It never throws; `await` it after the write succeeds (after a transaction commits, never inside it). Add each new action to `AUDIT_ACTIONS` in `constants.ts` and a step that triggers it in `server/tests/audit.coverage.test.ts`.
  ```ts
  await audit.record({
    action: AUDIT_ACTIONS.PATIENT_UPDATE,
    actor: { user: user.id, role: user.role, name: `${user.firstName} ${user.lastName}` }, // or pass `req` instead
    request: meta,                        // buildRequestMeta(req) from the controller
    resource: { type: 'patient', id: patient._id, number: patient.mrn },
    patient: patient._id,                 // whenever the action concerns a patient
    changes: audit.diffChanges(before, after, Object.keys(input)),
  });
  await audit.recordRead({ ... });        // reads of clinical data: debounced 5 min per user + record
  ```
  Keys matching password/token/secret/hash are redacted automatically; `diffChanges` masks email/phone.
- **Patient data**: every service touching a patient calls `assertCanAccessPatient(user, patientId, scope, meta)` from `policies/patientAccess.ts` (scopes: `demographics | clinical | billing | lab`). It returns 404 (not 403) and audits `access.denied`. Put new access rules (e.g. the doctor care relationship, Phase 5) in that policy, never in controllers.
- **RBAC matrix**: every new protected endpoint needs a row in `server/tests/helpers/rbacMatrix.ts`: `{ method, path: (c) => url, body?: (c) => validBody, roles, status }`. `rbac.test.ts` runs it for every role; `routeInventory.test.ts` fails if a mounted route has no row or answers without a token.
- Append-only collections use `applyAppendOnly(schema, 'Label')` from `utils/appendOnly.ts`.
- Tests: `loginAs(role)`, `createUser()`, `resetDb()`, `refreshWith()` in `tests/helpers/auth.ts`; `captureEmails()` in `tests/helpers/email.ts`.

## Phase 2 building blocks (reuse, don't reinvent)
- **Clinic settings**: server `getSettings()` from `modules/settings/service.ts` (cached; never query `ClinicSettings` directly). Client: `useGetPublicSettingsQuery()` (loaded at app start) and `getClinicTimezone()`.
- **Money** (integer paise, never floats): server `utils/money.ts` (`assertPaise`, `rupeesToPaise`, `paiseToRupees`) and the Zod `paise` helper in `utils/zod.ts`; client `utils/money.ts` (`formatINR`, `rupeesToPaise`, `paiseToRupees`, `percentToBps`) and `components/ui/MoneyInput` (type ₹, value paise). Tax rates are basis points.
- **Dates**: server `utils/dates.ts` (`zonedDateTimeToUtc`, `startOfClinicDay`/`endOfClinicDay`, `clinicToday`, `toClinicDate`, `calendarDate` for date-only fields, `timeToMinutes`); client `utils/dates.ts` (`formatDate`/`formatDateTime`/`formatTime`, `toUtcFromClinic`, `clinicDate`, `formatInClinic`). Store instants in UTC; clock times are `HH:mm` clinic time; never use `toLocale*` or `new Date(y, m, d)` for business days.
- **Numbers** (MRN, APT, INV…): `services/counter.service.ts` `nextSequence(key, { session })` + `formatNumber(prefix, seq, { year })` (§8.10). Pass the transaction `session`.
- **Transactions**: `withTransaction(async (session) => …)` from `utils/transaction.ts`; send emails and write audit entries after it resolves.
- **Doctors**: a doctor is identified by their **User id**. `findDoctor(id)` (doctors service) loads the profile; "own" rules live in `policies/doctorAccess.ts`. Availability: `getScheduleForDate(doctorId, 'YYYY-MM-DD')` (schedules service) and non-cancelled `DoctorLeave` in `[startAt, endAt)`. Serialise per-doctor writes by bumping `DoctorProfile.lockVersion` inside the transaction.
- **Public endpoints**: `optionalAuthenticate`, then add the route to `PUBLIC` in `routeInventory.test.ts` and a row to `PUBLIC_ENDPOINTS` in `rbacMatrix.ts` (anonymous responses are scanned for private keys).
- **Tests**: `createDepartment()`, `createDoctor()`, `loginAsDoctor()` in `tests/helpers/fixtures.ts`. The RBAC matrix fails if an allowed write writes no audit entry. Extend `npm run smoke` for new seeded data.
- **Seed**: one seeder per data type in `server/src/seed/`, upserting through the services and their Zod schemas (idempotent); fixed faker seed.
- **Client UI kit**: `MoneyInput`, `TimeInput`, `Switch`, `Tabs`, `TagInput`, `SearchableSelect`, `Textarea`, `FilterBar`, `StatusBadge`, `ListSkeleton`, `ErrorState`, `Modal` (`variant="drawer"`, `size="lg"`), `StatusToggleButton`; hooks `useListParams` (filters in the URL) and `useUnsavedChanges`; `applyServerFieldErrors` / `applyServerFieldErrorsByPath` for server field errors (incl. field arrays). Enums mirrored in `constants/catalog.ts`.

## Frontend conventions
- Feature folders in `client/src/features/<feature>/` (`api.js`, `components/`, `pages/`, `schemas.js`).
- Server data via RTK Query only; access token kept in memory, never localStorage.
- Role pages go in `client/src/routes/routeConfig.ts` (builds routes and the sidebar). Use the `components/ui` kit; tables use `Table` (cards below 768 px). Client tests mock the API with MSW (`client/tests/msw/server.ts`).
- Every list/page has loading, empty and error states. Mobile-friendly from 360 px.
- Show dates in the clinic timezone and money as ₹ formatted from paise.

## Security rules (this app handles medical data)
- Never log request bodies, passwords, tokens or patient data.
- Every patient-data route checks role AND ownership / care relationship (`canAccessPatient`, spec §2.3).
- Admins and receptionists have no access to clinical notes.
- Audit-log every sensitive read and write (spec §10.4).
- Signed notes, issued prescriptions, released lab results, payments and audit logs are append-only: never update or delete them.
- AI never diagnoses or changes treatment; doctors approve every clinical summary; patient explanations pass server guardrails (spec §9).

## Workflow
- Never stop or kill a process you did not start (e.g. `kill $(lsof -ti :5001)`): the user's `npm run dev` may be on that port. Check the port first; to exercise the API use `npm run smoke`; stop your own processes by the PID you started.
- Show a short plan and wait for approval before large changes.
- Write tests for every new endpoint, including access-denied cases.
- Run tests and lint before saying a task is done.
- At the end of a phase: update `docs/ROADMAP.md` (tick items, add notes), update "Current phase" above, and commit with a conventional commit message.
- If the code must differ from the spec, say so and record it in spec §20 ("Decisions made" table, next D-number) instead of diverging silently.