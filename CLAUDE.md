# MedAssist – Clinic Operations & Patient Care Portal

MERN capstone: a clinic management system for admins, doctors, receptionists, lab technicians and patients.

- Full requirements: `docs/PROJECT_SPEC.md` (source of truth; cite sections like §8.2)
- Build plan and progress: `docs/ROADMAP.md`

Read the relevant spec sections for the current phase before planning. Do not read the whole spec every time.

## Current phase
**Phase 9 – AI features.** Spec: §9 (architecture, clinical summary, patient explanations, testing), §4.11–4.12, §5.7 (summary states), §6.15 (`clinical_summaries`), §6.17 (`patient_explanations`), §6.26 (`ai_interactions`), §7.11 (AI endpoints), §7.13 (`POST /encounters/:id/follow-up/explain`), §10.6 (privacy), §16 (`AI_DISABLED`, `AI_UNAVAILABLE`, `AI_OUTPUT_INVALID`). AI goes behind a new `server/src/ai/ai.service.ts` (see Stack; `AI_PROVIDER=mock` in dev and tests); approved summaries become a new timeline source; "Explain in simple words" goes where the Phase 8 pages left space (`MyPrescriptionPage`, the visit summary's follow-up plan). Only build what the current phase prompt asks for. Do not build features from later phases early. If something from a later phase seems needed, ask first.

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
- `npm run seed` – seed demo data (clinic set-up, staff, 8 doctors, lab tests, 60 patients with logins `patient1…8` and the pending sign-up `pending1`, ~310 appointments incl. today's live queue, notes, prescriptions, ~80 lab orders, ~215 invoices with payments, 15 follow-up requests and follow-up reminders (patient1 has one due in two days); password `Password@123`; prints the kiosk board URL); `npm run seed -- --reset` wipes first. Needs MongoDB as a replica set.
- `npm run smoke` – API smoke test against the seeded DB (auth, RBAC, audit chain, Phase 2 data, public field exposure, patients and field visibility, all demo logins, Phase 4: appointments, a live double-booking race, a Socket.IO event, the kiosk board, Phase 5–7 role views, lab reports and invoices; it books one appointment and cancels it again). Reuses a server already running on `PORT` (and leaves it running); otherwise starts a temporary one on a free port and stops only that.
- `npm run migrate:link-patients` – dev/test only: links patient users created before Phase 3 to new patient records (idempotent; lists users with missing data).

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

## Phase 3 building blocks (reuse, don't reinvent)
- **Patient views per role**: never return a Patient document; use `modules/patients/serializer.ts` – `viewForRole(role, patient, portal?)` (admin: no allergies/conditions; reception: + allergies; doctor: no insurance/admin notes; patient: no admin notes), `toListItem`, `toDuplicateMatch`. `viewFor(user, patient)` in the patients service adds the portal info for staff. §2.5 was updated (D60).
- **Patient access**: every service call on a patient starts with `await assertCanAccessPatient(user, patientId, scope, meta)` (scopes `demographics | clinical | billing | lab | allergies`) – 404 + `access.denied` audit on denial. Lists use `patientListFilter(user)`; actions without a patient yet use `roleHasPatientScope(user, scope)`. Doctors are denied until the care relationship – **Phase 5 changes `canAccessPatient` (and it will need DB lookups, D33)**. `req.user.patientId` is set only for linked patient users; pending self-signups have `patientLinkStatus: 'pending_verification'`.
- **Patients**: `loadPatient(id)`, `insertPatient(fields, { session })` (MRN from the counter inside the transaction), `findDuplicates()`, `portalInfo()` in `modules/patients/service.ts`; linking and invites in `portal.service.ts`. Test fixtures: `createPatient()`, `loginAsPatient()`, `uniquePhone()` in `tests/helpers/fixtures.ts`.
- **Phones**: stored in E.164. Validate with the `phone` Zod helper (`utils/zod.ts`); server `normalisePhone` / `tryNormalisePhone` / `formatPhone` (`utils/phone.ts`); client `normalisePhone` / `formatPhone` / `PHONE_PREFIX` (`client/src/utils/phone.ts`). Dates of birth: `dateOfBirth` Zod helper (calendar date); ages with `ageOn()`.
- **Search**: never build a regex from user input yourself. Patients: `buildPatientSearchQuery(q)` (`utils/search.ts` – exact MRN/phone, else anchored `^prefix` per word). Other lists: `escapeRegex` / `exactRegex` / `containsRegex` (`utils/regex.ts`). No leading-wildcard regex on large collections.
- **Read auditing**: reads of patient/clinical records use `audit.recordRead({ action, actor, resource: { type, id, number }, patient })` – debounced 5 min per user + action + record. Patient update audits record field names; use `patientChanges()` so identifying values are `[REDACTED]`.
- **Tests**: `api()` uses one shared test server per file on 127.0.0.1; for a small custom Express app use `const call = await serve(app)` – never `request(app)` (port collision on macOS, D78). RBAC rows may set `statusFor: { doctor: 404 }` for roles stopped by the patient policy. Client: fixtures in `client/tests/patients.fixtures.ts`; the default MSW handlers include `/patients/pending-links` (reception sidebar badge).
- **Client**: patient pages in `features/patients` (`PatientFormSections`, `DuplicatePanel` + `useDuplicateCheck`, `ReasonDialog` for audited reasons, `AllergyChips`, `PortalBadge`); `patientsBase(role)` for `/reception` vs `/admin` paths; `homeFor(user)` (`routes/home.ts`) is where a user lands after login/register.

## Phase 4 building blocks (reuse, don't reinvent)
- **Booking lock**: any write that must not overlap another booking runs in `withTransaction` and first calls `lock(session, doctorId, patientId?)` (`appointments/booking.service.ts`: `$inc bookingVersion` on the DoctorProfile and Patient), then re-checks inside the transaction (`assertSlotFree` / `assertPatientFree`); wrap it in `bookingTransaction()` so a duplicate key / lost write conflict becomes 409 `SLOT_UNAVAILABLE`. Leave and schedule writes bump `bookingVersion` too. The partial unique index `{ doctor, startAt }` (`isSlotActive`) is only the last guard.
- **State changes**: every status change goes through a transition table in `STATE_MACHINES` (constants) and `assertTransition(machine, from, to)` (`utils/stateMachine.ts`, 409 `INVALID_STATUS_TRANSITION`). Appointments: always `applyTransition()` (`appointments/status.service.ts`) – conditional update, `statusHistory`, `isSlotActive`; then audit, then announce. Phase 5+ machines (encounter, prescription, lab order, invoice) follow the same pattern.
- **Real-time**: after the commit, call `announceAppointment(appt, previous?)` (or `emitQueueUpdated(doctorId, date)` / `emitAppointmentChanged(id, userIds)` from `socket/emitter.ts`). Payloads are ids only – never patient data; clients refetch. Client: `useSocketInvalidation()` (AppLayout) maps events to RTK tags; `useQueueRooms([{ doctorId, date }])` follows queue rooms; new events → add tags in `app/socketInvalidation.ts`.
- **Notifications**: `notify({ recipients, type, title, body, link, email })` (`services/notification.service.ts`) – never blocks or throws; email only until Phase 10 adds in-app storage. No clinical details in title/body (§10.3). Appointment emails: `notifyAppointment(type, appt)`.
- **Time on calendars**: react-big-calendar only sees "wall dates" – convert with `toClinicWallDate` / `fromClinicWallDate` (`client/src/utils/clinicTime.ts`) at the boundary; lists and emails use the clinic-time formatters (`formatDateTime`, server `formatClinicDateTime`).
- **Jobs**: `server/src/jobs/*.job.ts` export `runXJob(now)` (tests call them with a fixed `now`); register them in `jobs/index.ts` (node-cron, clinic timezone, only when `JOBS_ENABLED=true`, never throw, one-line count summary). Claim work with a conditional update so a job never acts twice.
- **Appointments API**: `appointmentListFilter` / `assertCanViewAppointment` (`policies/appointmentAccess.ts`: others → 404); serializers `viewForRole` (doctor: minimal patient view). Client: `actionsFor(role, appt)` and `patientChangeRules()` (`features/appointments/paths.ts`) decide which buttons show; `BookingModal`, `SlotPicker`, `DateAvailabilityPicker`, `PatientPicker`, `DoctorPicker`, `PriorityPill`, `CalendarToolbar`.
- **Tests**: fixtures `createSchedule`, `createService`, `createBookingSetup`, `insertAppointment` (any status/time, bypasses the rules), `nextWeekday`, `at(date, time)`, `setSettings`, `useMiddayClinicZone()` (clinic zone where it is ~midday now, for "today"/"session running" tests); call `await Appointment.init()` so the unique index exists. Client: `tests/appointments.fixtures.ts`; sockets are off in tests (`VITE_REALTIME=off`) – use `attachInvalidation` with a fake socket.

## Phase 5 building blocks (reuse, don't reinvent)
- **Care relationship**: `CARE_RELATIONSHIP_CHECKS` in `policies/patientAccess.ts` is a list of pluggable checks (a non-cancelled appointment; a placed lab order by the doctor – Phase 6). Add new checks there AND in `relatedPatientIds()` (lists); lab techs reach patients only through placed lab orders (`hasPlacedLabOrder`). `canAccessPatient` is async and cached per request (keyed by the `req.user` object – pass it, never a copy). Doctors get demographics/clinical/lab/allergies with a relationship, else 404 + `access.denied`.
- **Clinical access**: notes → `policies/encounterAccess.ts` (author always; others signed only + relationship); prescriptions → `policies/prescriptionAccess.ts` (per role). Admins/receptionists never read notes (403 by role).
- **Editable clinical records use `expectedVersion`** (= `__v`, exposed as `revision`): conditional update `{ _id, __v, status: 'draft' }` + `$inc: { __v: 1 }`; a mismatch → 409 CONFLICT with `currentRevision`. Mongoose `optimisticConcurrency` covers `save()` only.
- **Immutability**: signed/amended encounters change only through the amendment service (`amendmentWriteOptions(session)` / `allowAmendmentSave`, an internal token in `encounters/model.ts`); issued prescriptions allow status fields only; notes/prescriptions are never deleted; `note_amendments` is append-only. New append-only or lock-after-X models follow the same hook pattern and get model-level tests.
- **Audit of clinical data: field names (and counts) only, never values or text**; autosave writes use `audit.recordDebounced` (5 min per user + record); 4xx error messages must not name drugs, allergies or diagnoses (put them in `details`, which is not logged).
- **State changes**: encounter and prescription machines are in `STATE_MACHINES`; every status change calls `assertTransition` (jobs too) and a conditional update. Sign = one transaction (note, prescription, appointment, draft lab orders placed via `submitDraftOrdersInSession`) with audit/events after the commit.
- **Allergy check**: `services/allergyCheck.ts` (`checkAllergies`, `drugComponents`) + `data/allergyClasses.ts`; always labelled a convenience check. Formulary: `data/formulary.ts`, `GET /formulary`.
- **Errors**: `DOCUMENTATION_WINDOW_CLOSED`, `ALLERGY_ACK_REQUIRED`, `SIGN_VALIDATION_FAILED` (422, `details` = `[{ field, message }]`, fields like `prescription.items.0.dose` – the client maps them to tabs with `fieldTarget()`).
- **Tests**: fixtures `startedConsultation`, `checkedInToday`, `writeNote`, `readyToSign`, `putPrescription`, `rxItem`, `signNote` (`tests/helpers/fixtures.ts`); call `Encounter.init()` / `Prescription.init()` for the unique indexes. `phase5.security.test.ts` lists every patient-specific route a stranger doctor must get 404 on – add new ones there. Client: `tests/encounters.fixtures.ts`.
- **Client**: **no clinical data in browser storage** – unsaved clinical edits live in memory-only slices (`consultDraft`, `rxDraft`, cleared on logout); autosave hooks `useAutosave` / `usePrescriptionDraft` (2 s debounce, blur, Ctrl/⌘+S, one request in flight, offline back-off, conflict banner). **Print pages use `layouts/PrintLayout`** under `/print/...` (no app chrome, A4, `print:hidden` controls). Status pills: `encounter`, `prescription` domains in `statusStyles.ts`.

## Phase 6 building blocks (reuse, don't reinvent)
- **Files**: every stored file goes through the storage adapter (`services/storage`, `getStorage()`; `STORAGE_DRIVER`, `UPLOAD_DIR`, `MAX_UPLOAD_MB`) and the **documents module** (`modules/documents`): uploads via `singleFile` + `detectUploadType` (magic bytes) + `safeFileName`; generated files via `storeGeneratedFile()` before the transaction and `createGeneratedDocument(file, session)` inside it (`logOrphanedFile` on failure). Downloads only through `sendFile()` (attachment, nosniff, no-store) and audited `document.download`. Never serve `UPLOAD_DIR` statically; `storageKey` is `select: false` and never in a view. Who may read/upload: `policies/documentAccess.ts` (`DOCUMENT_UPLOAD_CATEGORIES` per role).
- **PDFs**: every server PDF uses `services/pdf.service.ts` (`createPdf()` → handle with `finish()`; `clinicHeader`, `detailsGrid`, `table`, `heading`, `paragraph`, `rule`, `pdfSafe`) and lab reports are stored as generated Documents (pattern: `labOrders/report.ts` `prepareReleaseReport`); invoices and receipts are made on demand instead (Phase 7, D148). Tests read PDFs with `pdfText()` / `isPdf()` (`tests/helpers/pdf.ts`).
- **Lab orders**: status changes only via `applyOrderTransition` / `recomputeOrderStatus` (`labOrders/status.service.ts`); "placed" = `orderedAt` set (`PLACED_LAB_ORDER`); released items change only through `revision.service.ts` (`revisionWriteOptions`). Views per role in `labOrders/serializer.ts` (`toLabView`, `toDoctorView`, `toReceptionView` – status and prices only, `toPatientView` – current released results only); access in `policies/labOrderAccess.ts` (admins: none). Flags only from `ranges.ts` / `results.ts` on the server. Item remarks are internal (never patient view or PDF). Lab notifications in `labOrders/notify.ts` (no test names/values/flags); critical alerts claimed once per result version.
- **Sockets**: ids-only events after the commit now include lab orders – `emitLabWorklistUpdated` (room `lab`, lab techs), `emitLabOrderChanged(orderId, userIds)`, `emitLabCritical`; client tags in `app/socketInvalidation.ts` (`labTags`).
- **Tests**: lab setups in `labWorkflow.test.ts` / `labReport.test.ts` (two lab techs for dual verification); `phase5.security.test.ts` includes the lab/document routes; uploads in `documents.test.ts` (spoofed types, size, per-role). Client: `tests/labs.fixtures.ts`.

## Phase 7 building blocks (reuse, don't reinvent)
- **Billing maths lives only in `modules/invoices/calc.ts`** (`calcLine`, `calcInvoice`, `discountPercent`, `exceedsDiscountLimit`, `statusForAmounts`): integer paise, tax half-up per line in BigInt. Never compute money with floats or outside it; the client mirrors it in `features/billing/calc.ts` for the preview only – the server's totals are the truth after every save. Lines go through `invoices/lines.ts` (`priceLine`, `totalsOf`, `consultationLine`, `labTestLines`).
- **Invoice side effects live inside the originating transaction**: `invoices/sync.service.ts` – `createOrUpdateDraftForAppointment` (sign), `addLabOrderToInvoice` (post-sign orders), `removeOrFlagCancelledLabItems` (lab item/order cancel), `voidDraftInvoicesForAppointment` (appointment cancel) take the caller's `session`; audit with `afterInvoiceSync(user, results, meta, via)` after the commit. Idempotent (matched by lab order item, one consultation per visit). Never change an issued invoice automatically.
- **Locked after issue**: `invoices/model.ts` hooks allow only status bookkeeping (`status`, `statusHistory`, `void`, `cancelledItemsBilled`); the paid amounts change only with `paymentWriteOptions(session)` (payment service). Payments are append-only (`applyAppendOnly`).
- **Payments use the optimistic-lock transaction pattern**: inside `withTransaction`, a conditional `findOneAndUpdate({ _id, __v, status, balancePaise: { $gte: amount } })` + `$inc: { __v: 1 }` on the invoice, then the append-only payment; a miss → 409 CONFLICT or 422 `PAYMENT_EXCEEDS_BALANCE` (refunds: `REFUND_EXCEEDS_PAYMENT`). Status always from `statusForAmounts`. Draft edits and issue use `expectedVersion` (API `revision`).
- **Views and access**: `invoices/serializer.ts` `toView(inv, role)` / `toListItem`; `viewFor(user, inv)` adds the staff-only billing `rules`. `policies/invoiceAccess.ts` (`assertCanReadInvoice` → 404 + `access.denied`, `invoiceListFilter`): reception/admin all, patients own non-draft, doctors/lab techs none.
- **PDFs with money**: `createPdf({ unicode: true, watermark? })` embeds Noto Sans (`server/src/assets/fonts`, OFL; `npm run build` copies the folder); print amounts with `pdf.money()` / `formatMoneyForPdf(paise)` (₹, "Rs." fallback) and words with `amountInWords(paise)` (`utils/amountInWords.ts`, Indian numbering); stream with `sendPdf(res, bytes, name, { download })` (`utils/sendFile.ts`). Tests read embedded-font PDFs with `pdfText()` (ToUnicode decoding).
- **Notifications**: invoice issued / payment received emails carry the invoice number only – no amounts, lines or clinical details.
- **Tests**: `invoices.test.ts`, `payments.test.ts` (races), `billing.sync.test.ts`, `invoice.model.test.ts`; RBAC context has `draftInvoiceId`, `issuedInvoiceId`, `paidInvoiceId`, `paymentId`. Client: `tests/billing.fixtures.ts`; the default MSW handlers answer `GET /invoices` (patient dashboard card).
- **Client**: `features/billing` – `invoicesBase(role)`, `invoiceActions(role, inv)`, `groupPayments`; `useInvoiceDraft` (autosave with the version, conflict/discount states); `PdfButton` (authorised blob download); `InvoiceSummaryStrip`, `InvoiceTotals`, `LinesTable`, `PaymentsList`, `RecordPaymentModal`, `RefundModal`, `VoidInvoiceButton`, `CancelledItemsPanel`, `PatientBillingPanel`, `BillButton`, `AppointmentInvoices`. Status pills: `invoice`, `payment` domains. Money always via `formatINR` / `MoneyInput`.

## Phase 8 building blocks (reuse, don't reinvent)
- **Timeline sources are a registry**: `modules/timeline/sources/index.ts` lists `defineSource({ type, rolesAllowed, query(patientId, q), toItem(doc, viewer) })` per record type (time field + index on patient + that field). The service asks only the sources the viewer's role may see (filtered **before** merging), each for `limit + 1` items after the cursor, merges by `(at, type, id)` desc and cuts. **Phase 9 adds approved AI summaries as one more source** (doctor + patient roles, approved only) – add the type to `TIMELINE_TYPES` (constants, sorted string order matters for ties) and the client `TYPE_LOOK`. Items never carry clinical free text for non-clinical roles, nor follow-up message text for anyone.
- **Cursor pagination**: `modules/timeline/cursor.ts` (`encodeCursor`, `decodeCursor` – opaque base64url `at|type|id`, `compareDesc`, `afterCursor(field, type, cursor)`) and `windowFilter` / `newestFirst` in `timeline/types.ts`; the response is `data` + `meta: { limit, nextCursor }`. Client: `build.infiniteQuery` (`features/timeline/api.ts`, `flattenPages` de-duplicates). Use the same pattern for any merged or append-style feed instead of page numbers.
- **Patient-safe serializers**: patients never get the doctor's shapes. Encounters: `toPatientSafeView` / `toPatientVisitItem` / `sharedPrimaryDiagnosis` (`encounters/serializer.ts`) – no chief complaint, history, examination, assessment or plan; diagnoses only with `shareDiagnosisWithPatient`. Follow-ups: `followups/serializer.ts` `toView(r, role)` drops `staff` messages and the `by`/`note` of status history for patients. Phase 9 explanations must start from these patient-safe fields, never the full note.
- **Follow-up requests** (`modules/followups`): every status change via `transitionFollowup()` (assertTransition + conditional update on the status read; pass `session` to run inside another transaction); access in `policies/followupAccess.ts` (`assertCanReadFollowup`, `assertCanHandleFollowup` – reception or the assigned doctor; 404 + `access.denied`; `followupListFilter`). Scheduling uses `bookAppointment(user, input, meta, { inTransaction })` – reuse that hook whenever something must commit together with a booking.
- **Message visibility**: messages are `all | staff`; `staff` = internal note. **Notifications and socket events never carry message text** (or the request type): emails say "please log in" and link to each role's own page; `emitFollowupUpdated(requestId, userIds)` (+ room `role:receptionist`) sends ids only.
- **Follow-up plans**: `encounters/followUp.ts` (`followUpDueDate`, `isFollowUpBooked`, `NOT_BOOKED_STATUSES`); reminders in `followupReminders` (`syncFollowUpReminder(e, { session, timezone })` – call it wherever a note's follow-up plan is written: sign, amendment, seed); job `runFollowUpReminderJob(now)`.
- **Care relationship**: three checks now – appointment, placed lab order, assigned follow-up request (`hasFollowUpAssignmentRelationship`, mirrored in `relatedPatientIds`).
- **Tests**: `timeline.test.ts` (per role, cursor pages with equal times), `encounters.patientView.test.ts`, `followups.test.ts`, `followUpReminders.job.test.ts`, `seed.followups.test.ts`; RBAC context has `followupId`; `phase5.security.test.ts` includes the timeline and follow-up routes. Client: `tests/timeline.fixtures.ts`, `tests/followups.fixtures.ts`; default MSW handlers answer `/patients/:id/timeline`, `/patients/me/follow-ups-due` and `/follow-up-requests`.
- **Client**: `features/timeline` (`Timeline` – `types` chips per role from `TIMELINE_FILTERS`, `compact` for side panels), `features/visits` (patient visits, follow-up due card, `followUpBookingLink`), `features/followups` (`FollowupDetail`, `MessageThread` – patient right / clinic left for patients, internal notes dashed amber for staff; `ReplyBox` with the internal-note switch; `ScheduleFollowupModal`, `AssignDoctorModal`, `EmergencyBanner`), `features/prescriptions/format.ts` `plainItem()`; the booking wizard reads `?doctor=&followUpOf=`; patients get `layouts/BottomNav` below 768 px. Status pills: `followup` domain.

## Frontend conventions
- Feature folders in `client/src/features/<feature>/` (`api.js`, `components/`, `pages/`, `schemas.js`).
- Server data via RTK Query only; access token kept in memory, never localStorage.
- Role pages go in `client/src/routes/routeConfig.ts` (builds routes and the sidebar). Use the `components/ui` kit; tables use `Table` (cards below 768 px). Client tests mock the API with MSW (`client/tests/msw/server.ts`).
- Every list/page has loading, empty and error states. Mobile-friendly from 360 px.
- Show dates in the clinic timezone and money as ₹ formatted from paise.

## UI conventions (design system – every new screen follows it)
- Full reference: `docs/DESIGN_SYSTEM.md`. Tokens live in `client/src/index.css` (`@theme`, Tailwind v4 – no `tailwind.config.js`); use them (`bg-canvas`, `text-ink`, `text-muted`, `border-line`, `primary-*`, `rounded-card`, `rounded-control`, `shadow-card`, `text-page`/`text-section`/`text-card`/`text-stat`, `tabular`), never raw `slate-*`/hex colours, new radii or heavy shadows. `brand-*` is a legacy alias – don't use it in new code.
- Every page starts with `PageHeader` (`components/ui/PageHeader`) and groups content in `SectionCard`/`Card`; forms wrap the `SectionCard` so the submit button sits in its `footer`.
- Build from `components/ui` (Button, inputs, Table, Modal/ConfirmDialog, Tabs, Switch, FilterBar/FilterChip, StatCard, ChartCard, QuickLinkCard, Avatar, IconChip, DescriptionList, Skeleton/ListSkeleton, EmptyState, ErrorState); extend the kit instead of hand-rolling controls. Headless UI (`@headlessui/react`) for dialogs, menus and switches; icons from `lucide-react`.
- Statuses: add each new status to `STATUS_STYLES` in `components/ui/statusStyles.ts` (tone + label + icon) and render with `StatusPill` – never inline colours, never colour alone. Appointment statuses are already defined there (spec §13.3 colours; in consultation = violet).
- Motion: 150–250 ms with `ease-standard`, always behind `motion-safe:`; no loops except loading.
- Layout: shell is `layouts/` (Sidebar from routeConfig, TopBar, icon rail from 768 px, MobileNav bottom sheet below that); content from 360 px with no horizontal scroll; grids 1 → 2 (`sm`) → 3 (`lg`) → 4 (`2xl`).
- No fake data: dashboards and cards show real API values only; charts (Phase 10) use `ChartCard` + `chartTheme.ts` with a text `summary`.

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