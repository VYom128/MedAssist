# MedAssist – Clinic Operations & Patient Care Portal

A MERN clinic management system for admins, doctors, receptionists, lab technicians and patients:
appointments and queues, clinical notes and prescriptions, lab orders, billing, a patient portal and
AI-assisted summaries.

- Requirements (source of truth): [`docs/PROJECT_SPEC.md`](docs/PROJECT_SPEC.md)
- Build plan and progress: [`docs/ROADMAP.md`](docs/ROADMAP.md)

**Status:** Phases 0–1 complete (setup; auth, RBAC and audit logging) · Phase 2 (admin setup data) in progress.

## Prerequisites

- **Node.js 20+** and **npm 10+** (`.nvmrc` pins 20)
- **MongoDB**: a MongoDB Atlas cluster, or a local MongoDB running as a **replica set**
  (transactions are used from Phase 4; a standalone `mongod` works for Phases 0–3)

<details>
<summary>Turning a local Homebrew MongoDB into a single-node replica set</summary>

Add to `/opt/homebrew/etc/mongod.conf`:

```yaml
replication:
  replSetName: rs0
```

Then run `brew services restart mongodb-community`, run `rs.initiate()` once in `mongosh`,
and use `MONGO_URI=mongodb://127.0.0.1:27017/med_assist?replicaSet=rs0`.

</details>

## Setup

```bash
git clone <repo-url> med_assist
cd med_assist
npm install
cp server/.env.example server/.env    # then set MONGO_URI, JWT_ACCESS_SECRET, AUDIT_HASH_SECRET
cp client/.env.example client/.env
npm run seed                          # demo accounts (see below)
npm run dev
```

Generate each secret with `openssl rand -hex 32` (at least 32 characters).

- Client: http://localhost:5173 (sign-in page; system status at `/status`)
- API: http://localhost:5001/api/v1/health

With `EMAIL_TRANSPORT=console` (the default outside production), emails are not sent: the server
log shows the recipient, subject and links. Use this to open password-reset and account-setup links
in development.

## Demo accounts

`npm run seed` upserts one login per role (password **`Password@123`**): missing accounts are
created and existing ones are reset to the demo password, active, unlocked and without a forced
password change. It prints the table below when it finishes. `npm run seed -- --reset` first wipes
users, sessions and audit logs (development only). The seed refuses to run when
`NODE_ENV=production`.

| Role         | Email                      | Lands on               |
| ------------ | -------------------------- | ---------------------- |
| Admin        | `admin@medassist.dev`      | `/admin/dashboard`     |
| Receptionist | `reception1@medassist.dev` | `/reception/dashboard` |
| Lab tech     | `lab1@medassist.dev`       | `/lab/dashboard`       |
| Doctor       | `dr.mehta@medassist.dev`   | `/doctor/dashboard`    |
| Doctor       | `dr.iyer@medassist.dev`    | `/doctor/dashboard`    |
| Patient      | `patient1@medassist.dev`   | `/patient/dashboard`   |
| Patient      | `patient2@medassist.dev`   | `/patient/dashboard`   |

Patients can also sign up at `/register`. Their Patient record and linking arrive in Phase 3.

## Authentication overview

MedAssist uses a short-lived **access token** plus a rotating **refresh token** (spec §10.1).

- **Access token:** a JWT (HS256, 15 min, claims `sub`, `role`, `sid`), returned in the body of
  login, register, refresh and change-password. The client keeps it **in memory only** and sends
  `Authorization: Bearer <token>`.
- **Refresh token:** 64 random bytes in the httpOnly cookie `ma_rt` (path `/api/v1/auth`). The
  database stores only its SHA-256 hash, in a `sessions` document.
  - `POST /api/v1/auth/refresh` needs the header `X-Requested-With: medassist` (CSRF
    protection). Every refresh rotates the token: the old session is revoked (`rotated`) and a new
    one continues the same family.
  - A rotated token used again within 10 s (two tabs refreshing at once) gets an access token for
    the replacement. Used again later, it counts as theft: every session of that login is revoked
    and the event is audited as `auth.refresh_reuse`.
- **Every request** checks the session and the user, so logout, "sign out everywhere", a password
  change and deactivation take effect at once, not when the access token expires.
- **The client** restores the session on page load by calling refresh. On a 401 it refreshes once
  (shared by parallel requests) and retries; if that fails, the user is logged out.
- **Lockout:** 5 failed logins within 15 minutes lock the account for 15 minutes. Admins can
  unlock it (`POST /api/v1/users/:id/unlock`).
- **New staff** (`POST /api/v1/users`) get a random temporary password nobody sees and an email
  with a "set your password" link (valid 72 h).
- **Access control:** routes use `authenticate` → `authorize(...roles)`. Patient data goes
  through `canAccessPatient()`. Denials and every sensitive action land in the hash-chained audit
  log (`GET /api/v1/audit-logs`, `GET /api/v1/audit-logs/verify`, admin only).

## Environment variables (server)

All are validated at startup (`server/src/config/env.ts`); see `server/.env.example`.

| Variable                                                    | Default                 | Notes                                                                            |
| ----------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------- |
| `NODE_ENV`                                                  | `development`           | `development` / `test` / `production`                                            |
| `PORT`                                                      | `5000`                  | `.env.example` uses 5001 (macOS AirPlay holds 5000)                              |
| `MONGO_URI`                                                 | –                       | Required outside test                                                            |
| `CLIENT_URL`                                                | `http://localhost:5173` | CORS origin and base of email links                                              |
| `LOG_LEVEL`                                                 | `info`                  |                                                                                  |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX`                   | 15 min / 300            | Global API limit per IP                                                          |
| `JWT_ACCESS_SECRET`                                         | –                       | **Required**, at least 32 characters (`openssl rand -hex 32`)                    |
| `JWT_ACCESS_EXPIRES_IN`                                     | `15m`                   | Number + `s`/`m`/`h`/`d`                                                         |
| `REFRESH_TOKEN_TTL_DAYS`                                    | `7`                     | Sliding: each refresh extends it                                                 |
| `COOKIE_SECURE`                                             | `false`                 | Must be `true` in production                                                     |
| `COOKIE_SAMESITE`                                           | `lax`                   | `lax` / `strict` / `none` (`none` needs `COOKIE_SECURE=true`; use it cross-site) |
| `BCRYPT_ROUNDS`                                             | `12` (`4` in test)      | 4–15                                                                             |
| `AUDIT_HASH_SECRET`                                         | –                       | **Required**, at least 32 characters                                             |
| `EMAIL_TRANSPORT`                                           | `console`               | `console` logs recipient, subject and links; must be `smtp` in production        |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `MAIL_FROM` | –                       | Host, port and `MAIL_FROM` are required when `EMAIL_TRANSPORT=smtp`              |

In `NODE_ENV=test` the secrets get placeholder values, so tests need no `.env`.

The example env uses port **5001** because macOS reserves 5000 for AirPlay Receiver. If you change
`PORT`, update `VITE_API_URL` in `client/.env` too. If a required variable such as `MONGO_URI` is
missing or invalid, the server names it and exits with code 1.

## Scripts

Run from the repo root.

| Command                                     | What it does                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                               | Server (nodemon + tsx) and client (Vite) together                                                             |
| `npm run dev:server` / `npm run dev:client` | One side only                                                                                                 |
| `npm test`                                  | Server tests (Vitest + Supertest + in-memory replica set), then client tests (Vitest + React Testing Library) |
| `npm run test:client`                       | Client tests only                                                                                             |
| `npm run seed` / `npm run seed -- --reset`  | Demo accounts (see above)                                                                                     |
| `npm run smoke`                             | API smoke test (login, refresh, RBAC, audit verify). Reuses a running dev API and never stops it              |
| `npm run test:coverage -w server`           | Server tests with v8 coverage (`server/coverage/`)                                                            |
| `npm run lint` / `npm run lint:fix`         | ESLint (flat config) over the whole repo                                                                      |
| `npm run format` / `npm run format:check`   | Prettier                                                                                                      |
| `npm run typecheck`                         | `tsc --noEmit` for server and client                                                                          |
| `npm run build`                             | Compile server to `server/dist`, build client to `client/dist`                                                |
| `npm start`                                 | Run the compiled server                                                                                       |

The first test run downloads a MongoDB binary (about 100 MB) for mongodb-memory-server.

## Folder structure

```
server/
  src/
    app.ts              createApp(): middleware, /api/v1 routes, 404, error handler
    server.ts           connect DB, listen, graceful shutdown
    config/             env.ts (Zod-validated `config`), db.ts, constants.ts (error codes, enums)
    middlewares/        requestId, authenticate, authorize, requireCsrfHeader, validate,
                        rateLimiters, notFound, errorHandler
    modules/<feature>/  routes, controller, service, validation, model, serializer
                        (auth, users, sessions, audit, health)
    policies/           patientAccess.ts – canAccessPatient(user, patientId, scope)
    services/           audit.service.ts (hash-chained audit log), email.service.ts
    seed/               npm run seed
    routes/index.ts     mounts every module under /api/v1
    utils/              logger, ApiError, ApiResponse (sendSuccess), asyncHandler, pagination,
                        tokens, password, passwordPolicy, zod helpers, requestContext
  tests/                setup.ts, helpers/, *.test.ts
client/
  src/
    app/     store, apiSlice (RTK Query), axiosBaseQuery (Bearer token + refresh on 401)
    routes/  routeConfig.ts (role pages + sidebar, one list), routes.tsx, ProtectedRoute, RoleRoute
    components/ui/  Button, Input, Select, PasswordInput, Card, Badge, Modal, ConfirmDialog,
             Table (cards below 768 px), Pagination, EmptyState, Alert, Spinner
    layouts/ AuthLayout, AppLayout   features/<feature>/  components/ (ui/)  constants/  utils/
  tests/     Vitest + React Testing Library + MSW (tests/msw)
docs/                   PROJECT_SPEC.md, ROADMAP.md
```

## API response format

All endpoints live under `/api/v1` and return JSON (spec §7.1). Every response carries an
`X-Request-Id` header, and the same id appears in the logs and in error bodies.

**Success**

```json
{
  "success": true,
  "message": "OK",
  "data": { "id": "…" },
  "meta": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 }
}
```

`meta` is only present on paginated lists.

**Error**

```json
{
  "success": false,
  "message": "Validation failed",
  "error": {
    "code": "VALIDATION_ERROR",
    "details": [{ "field": "body.email", "message": "Invalid email address" }]
  },
  "requestId": "4697ac7a-0ebd-4938-a128-f7422dde6070"
}
```

Error codes and HTTP statuses are listed in spec §16 and in `server/src/config/constants.ts`. In
development, error responses also include `stack`.

## How to add a new backend module

Each feature lives in `server/src/modules/<feature>/`. Controllers stay thin and business logic goes
in the service. Every route follows the chain
`authenticate → authorize(...roles) → validate() → asyncHandler(controller)`. Patient data also goes
through `canAccessPatient()` in the service, and every sensitive read or write calls
`audit.record()` (see `modules/users/service.ts` for the pattern).

`modules/departments/validation.ts`

```ts
import { z } from 'zod';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const createDepartmentSchema = {
  body: z.object({ name: z.string().trim().min(2).max(100) }),
};

export const departmentIdSchema = {
  params: z.object({ id: objectId }),
};
```

`modules/departments/controller.ts`

```ts
import type { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import * as departmentService from './service.js';

export async function create(req: Request, res: Response) {
  const department = await departmentService.create(req.body);
  return sendSuccess(res, { statusCode: 201, message: 'Department created', data: department });
}

export async function getById(req: Request, res: Response) {
  const department = await departmentService.findById(req.params.id!);
  if (!department) throw ApiError.notFound('Department not found');
  return sendSuccess(res, { data: department });
}
```

`modules/departments/routes.ts`

```ts
import { Router } from 'express';
import { ROLES } from '../../config/constants.js';
import { authenticate } from '../../middlewares/authenticate.js';
import { authorize } from '../../middlewares/authorize.js';
import { validate } from '../../middlewares/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as controller from './controller.js';
import { createDepartmentSchema, departmentIdSchema } from './validation.js';

const router = Router();

router.post(
  '/',
  authenticate,
  authorize(ROLES.ADMIN),
  validate(createDepartmentSchema),
  asyncHandler(controller.create),
);
router.get('/:id', authenticate, validate(departmentIdSchema), asyncHandler(controller.getById));

export default router;
```

Then mount it in `server/src/routes/index.ts`:

```ts
router.use('/departments', departmentRoutes);
```

Checklist for a new module:

- Throw `ApiError` (or let Zod and Mongoose errors bubble up); never build error responses by hand.
- Respond with `sendSuccess()` and a role serializer, never a raw Mongoose document.
- Status changes are action endpoints (`POST /appointments/:id/cancel`), not a generic status PATCH.
- Add tests in `server/tests/` using `api(router)` from `tests/helpers/testApp.ts`, including
  access-denied cases.
