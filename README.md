# MedAssist – Clinic Operations & Patient Care Portal

A MERN clinic management system for admins, doctors, receptionists, lab technicians and patients.

- Requirements: [`docs/PROJECT_SPEC.md`](docs/PROJECT_SPEC.md)
- Build plan and progress: [`docs/ROADMAP.md`](docs/ROADMAP.md)

**Status:** Phase 0 (project setup) complete.

## Stack

| Part   | Tech                                                                                            |
| ------ | ----------------------------------------------------------------------------------------------- |
| Server | Node 20+, TypeScript (ES modules), Express 4, Mongoose 8, Zod, Pino                             |
| Client | React 18, Vite, TypeScript, React Router v6, Tailwind CSS v4, axios                             |
| Tests  | Vitest, Supertest, mongodb-memory-server (`MongoMemoryReplSet`)                                 |
| Tools  | npm workspaces, ESLint (flat config) + typescript-eslint, Prettier, nodemon + tsx, concurrently |

## Prerequisites

- Node.js 20 or newer (`.nvmrc` pins 20)
- MongoDB 7+ running locally, or a MongoDB Atlas cluster

> **Replica set:** from Phase 4, bookings, signing and payments use transactions, which need a
> replica set. A standalone `mongod` is enough for Phases 0–3. To convert a local Homebrew MongoDB
> into a single-node replica set, add this to `/opt/homebrew/etc/mongod.conf`:
>
> ```yaml
> replication:
>   replSetName: rs0
> ```
>
> Then run `brew services restart mongodb-community`, run `rs.initiate()` once in `mongosh`,
> and use `MONGO_URI=mongodb://127.0.0.1:27017/med_assist?replicaSet=rs0`.
> Atlas clusters are already replica sets.

## Getting started

```bash
npm install
cp server/.env.example server/.env
cp client/.env.example client/.env
npm run dev
```

- Client: http://localhost:5173 (shows **API: ok, DB: connected**)
- API: http://localhost:5001/api/v1/health

The API runs on port **5001** because macOS uses port 5000 for the AirPlay Receiver.

## Scripts (run from the repo root)

| Command                                   | What it does                                  |
| ----------------------------------------- | --------------------------------------------- |
| `npm run dev`                             | Server (nodemon + tsx) and client (Vite)      |
| `npm test`                                | Server tests (in-memory MongoDB replica set)  |
| `npm run lint` / `npm run lint:fix`       | ESLint                                        |
| `npm run format` / `npm run format:check` | Prettier                                      |
| `npm run typecheck`                       | `tsc --noEmit` for server and client          |
| `npm run build`                           | Compile server to `server/dist`, build client |
| `npm start`                               | Run the compiled server                       |

The first `npm test` downloads a MongoDB binary (about 100 MB) for mongodb-memory-server.

## Project layout

```
server/
  src/
    app.ts  server.ts  routes.ts
    config/       env.ts (Zod-validated)  db.ts  constants.ts (error codes)
    middlewares/  requestId  validate  rateLimiters  notFound  errorHandler
    modules/      health/
    utils/        logger  ApiError  ApiResponse (sendSuccess)  asyncHandler
  tests/          health, 404, validation, error handler, malformed JSON, security
client/
  src/
    routes/  layouts/  features/health/  components/  utils/ (axios instance, env)
```

## API conventions

All routes are under `/api/v1`.

```jsonc
// success
{ "success": true, "message": "OK", "data": {}, "meta": {} }
// error
{ "success": false, "message": "Validation failed",
  "error": { "code": "VALIDATION_ERROR", "details": [{ "field": "body.email", "message": "Invalid email" }] },
  "requestId": "b9e965f5-…" }
```

Error codes are listed in spec §16 and `server/src/config/constants.ts`. Every response carries an
`X-Request-Id` header, which also appears in the logs and in error bodies.

`GET /api/v1/health` returns `data: { status, uptime, timestamp, db }` with status **200**; `db` is
`connected`, `disconnected`, `connecting` or `disconnecting`.

## Environment variables

See `server/.env.example` and `client/.env.example`. Only the Phase 0 server variables are validated
now (`NODE_ENV`, `PORT`, `MONGO_URI`, `CLIENT_URL`, `LOG_LEVEL`, `RATE_LIMIT_WINDOW_MS`,
`RATE_LIMIT_MAX`). The rest of spec §3.6 is listed but commented out, and each variable is added to
the schema in the phase that needs it.
