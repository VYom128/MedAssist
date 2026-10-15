# Deploying MedAssist

The demo runs on free tiers: **MongoDB Atlas (M0)**, the **API on Render** (web service, free),
the **client on Vercel**, files on **Cloudinary**, email through **Brevo SMTP** and AI through
**Groq**. Decisions behind this setup: spec §18 and §20 (D193–D202).

```
Browser ──► Vercel (medassist.vercel.app)
             ├─ static client (SPA fallback: every non-file route → /index.html)
             └─ /api/*  ──rewrite──►  Render API (medassist-api-hl2o.onrender.com) ──► Atlas, Cloudinary,
                                                                                   Brevo, Groq
Browser ──► Socket.IO directly to the Render URL (access token in the handshake, no cookie)
```

## Why the `/api` rewrite

The refresh token lives in an httpOnly cookie. If the browser called `onrender.com` from a
`vercel.app` page, that cookie would be a **third-party cookie**, and Safari (and other browsers
that block third-party cookies) would drop it, logging users out on every reload. Through the
Vercel rewrite the API is **same-origin**: the cookie is first-party (`SameSite=Lax; Secure`),
API calls need no CORS, and only the Socket.IO connection goes to Render directly – it
authenticates with the access token, not the cookie, and CORS allows only `CLIENT_URL`.

The cross-site alternative stays possible through configuration (not recommended): on Render
`COOKIE_SAMESITE=none`, `COOKIE_SECURE=true`, `TRUST_PROXY=3`; on Vercel
`VITE_API_URL=https://<render-host>/api/v1`, and remove the `/api` rewrite from `client/vercel.json`.

## Build and start commands

| Where  | Install                | Build                         | Start                  |
| ------ | ---------------------- | ----------------------------- | ---------------------- |
| Render | `npm ci --include=dev` | `npm run build:server`        | `npm run start:server` |
| Vercel | `cd .. && npm ci`      | `npm run build` (in `client`) | static (`client/dist`) |

Node 24 LTS (`.nvmrc`, `engines`, `NODE_VERSION=24` on Render). `render.yaml` and
`client/vercel.json` already contain these.

## First deployment, step by step

1. **Atlas** – create an M0 cluster (AWS Mumbai or Singapore, close to Render's Singapore region).
   Database Access: a user with a long random password. Network Access: `0.0.0.0/0` – Render's
   free tier has no fixed outbound IP. Connect → Drivers → copy the `mongodb+srv://` string and add
   the database name: `…mongodb.net/medassist?retryWrites=true&w=majority`. M0 is a replica set,
   so transactions work. (Optional, §10.5: a second user with insert-only rights on `audit_logs`.)
2. **Cloudinary** – sign up; Console → Settings → API Keys: cloud name, API key, API secret.
   Nothing else to configure: files are uploaded as private ("authenticated") raw assets.
3. **Brevo** – Senders & IP: add and verify the sender address (and SPF/DKIM if you use your own
   domain). SMTP & API → SMTP: your SMTP login and a new SMTP key.
4. **Groq** – console.groq.com → API Keys → create a key.
5. **Render** – New → Blueprint → pick the repository; Render reads `render.yaml`. Fill in every
   secret it asks for (table below). `CLIENT_URL` is not known yet: enter
   `https://medassist.vercel.app` (or the name you will give the Vercel project) and correct it in
   step 8. Deploy, then note the service URL. **If it is not `https://medassist-api-hl2o.onrender.com`** (Render adds a suffix when the name is taken),
   replace that host in `client/vercel.json` (rewrite and CSP `connect-src`) and push.
6. **Indexes** – production builds no indexes on boot. From your machine, with the production
   variables in a file **outside the repository** (`~/medassist-production.env`, same values as on
   Render):

   ```bash
   DOTENV_CONFIG_PATH=~/medassist-production.env npm run db:indexes              # dry run
   DOTENV_CONFIG_PATH=~/medassist-production.env npm run db:indexes -- --apply   # create them
   ```

7. **Seed the demo** (demo data only – never a real clinic's database). Same file, plus the
   explicit opt-in:

   ```bash
   DOTENV_CONFIG_PATH=~/medassist-production.env ALLOW_DEMO_SEED=true npm run seed -- --demo --reset
   ```

   It prints a loud warning, writes through the production settings (audit chain with the
   production `AUDIT_HASH_SECRET`, lab PDFs to Cloudinary, no emails) and ends with the demo
   logins. Against Atlas it takes a few minutes. (Render's Shell is not available on free
   instances; on a paid plan you can run the same commands there.)

8. **Vercel** – Add New → Project → import the repository. **Root Directory: `client`**. Add the
   environment variables below, deploy, and note the URL. If it differs from what you entered in
   step 5, set `CLIENT_URL` on Render to it exactly (no trailing slash) and redeploy Render.
9. **Check** (see "After every deploy").

## After every deploy

- `https://<vercel-url>/api/v1/health` → `db: "connected"`, `commit` = the deployed commit, and
  `client.ip` = **your** public IP (if it shows a Vercel or Render address, `TRUST_PROXY` is wrong).
- Log in as `reception1@medassist.dev` / `Password@123`, reload the page: you stay logged in
  (first-party cookie).
- Open a lab report PDF and upload/download a document (Cloudinary).
- "Forgot password" for a demo account with a real inbox → the email arrives (Brevo).
- As `patient1`, a prescription → "Explain in simple words" (Groq; it falls back to the template if
  Groq is unavailable).
- If indexes changed: `npm run db:indexes` (dry run) shows nothing to do.

## Environment variables

### Render (API) – `render.yaml` lists all of them

| Name | Example | Where to get it | Secret |
| --- | --- | --- | --- |
| `NODE_ENV` | `production` | fixed | no |
| `NODE_VERSION` | `24` | fixed | no |
| `CLIENT_URL` | `https://medassist.vercel.app` | your Vercel URL, exact, no trailing slash | no |
| `TRUST_PROXY` | `4` | 4 with the Vercel rewrite, 3 for Render alone (measured, D207) | no |
| `MONGO_URI` | `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/medassist?retryWrites=true&w=majority` | Atlas → Connect | **yes** |
| `JWT_ACCESS_SECRET` | `<generate-me>` | `openssl rand -hex 32` | **yes** |
| `AUDIT_HASH_SECRET` | `<generate-me>` | `openssl rand -hex 32` – never change it later (the audit chain depends on it) | **yes** |
| `JWT_ACCESS_EXPIRES_IN` | `15m` | default | no |
| `REFRESH_TOKEN_TTL_DAYS` | `7` | default | no |
| `BCRYPT_ROUNDS` | `12` | default | no |
| `COOKIE_SECURE` | `true` | required in production | no |
| `COOKIE_SAMESITE` | `lax` | `lax` with the rewrite (`none` cross-site) | no |
| `RATE_LIMIT_WINDOW_MS` | `900000` | default (15 min) | no |
| `RATE_LIMIT_MAX` | `300` | per user, or per IP when anonymous (D197) | no |
| `LOG_LEVEL` | `info` | default | no |
| `EMAIL_TRANSPORT` | `smtp` | required in production | no |
| `SMTP_HOST` | `smtp-relay.brevo.com` | Brevo → SMTP | no |
| `SMTP_PORT` | `587` | Brevo → SMTP (STARTTLS) | no |
| `SMTP_USER` | `<brevo-smtp-login>` | Brevo → SMTP & API → SMTP | **yes** |
| `SMTP_PASS` | `<brevo-smtp-key>` | Brevo → SMTP & API → SMTP → generate key | **yes** |
| `MAIL_FROM` | `MedAssist <no-reply@your-domain>` | a sender verified in Brevo | no |
| `STORAGE_DRIVER` | `cloudinary` | required in production (`local` is refused) | no |
| `CLOUDINARY_CLOUD_NAME` | `<your-cloud-name>` | Cloudinary → Settings → API Keys | no |
| `CLOUDINARY_API_KEY` | `<your-api-key>` | Cloudinary → Settings → API Keys | **yes** |
| `CLOUDINARY_API_SECRET` | `<your-api-secret>` | Cloudinary → Settings → API Keys | **yes** |
| `CLOUDINARY_FOLDER` | `medassist` | default | no |
| `MAX_UPLOAD_MB` | `10` | default | no |
| `AI_PROVIDER` | `openai_compatible` | Groq | no |
| `AI_BASE_URL` | `https://api.groq.com/openai/v1` | default | no |
| `AI_API_KEY` | `<groq-api-key>` | console.groq.com → API Keys | **yes** |
| `AI_MODEL` | `openai/gpt-oss-120b` | default | no |
| `AI_FALLBACK_MODELS` | `qwen/qwen3.8-27b,openai/gpt-oss-20b` | default | no |
| `AI_TIMEOUT_MS` / `AI_TEMPERATURE` / `AI_MAX_TOKENS` | `30000` / `0.2` / `4000` | defaults | no |
| `AI_DAILY_CALL_LIMIT` | `300` | default | no |
| `JOBS_ENABLED` | `true` | exactly one instance runs jobs | no |
| `KIOSK_KEY` | `<generate-me>` | optional: `openssl rand -hex 24` (queue board) | **yes** |
| `ALLOW_DEMO_SEED` | `false` | `true` only while seeding the demo | no |
| `PORT`, `RENDER_GIT_COMMIT` | – | set by Render | – |

### Vercel (client) – Project → Settings → Environment Variables

| Name | Example | Where to get it | Secret |
| --- | --- | --- | --- |
| `VITE_API_URL` | `/api/v1` | relative = through the rewrite (absolute only cross-site) | no |
| `VITE_SOCKET_URL` | `https://medassist-api-hl2o.onrender.com` | the Render service URL | no |
| `VITE_APP_NAME` | `MedAssist` | optional | no |

`VITE_*` values end up in the JavaScript bundle – never put a secret there. The production build
fails if `VITE_API_URL` or `VITE_SOCKET_URL` is missing.

## The free tiers

- **Render sleeps** after about 15 minutes without requests; the next request wakes it (30–60 s).
  While asleep, background jobs pause; on waking every job runs once and catches up from its own
  timestamps (a missed appointment reminder is still sent if the visit is in the future, otherwise
  skipped; nothing is ever sent twice – D202). Queued emails live in memory: a graceful shutdown
  (deploy) waits up to 10 s for them, but a crash or a longer retry loses them – the in-app
  notification is still there.
- **Atlas M0** has no continuous backup or point-in-time restore. Before risky work, take a
  `mongodump` (Atlas → Command Line Tools).
- **Cloudinary free** – 25 credits a month is plenty for the demo's PDFs.

## Rollback

- **API**: Render → service → Events / Deploys → pick the last good deploy → **Rollback**.
- **Client**: Vercel → Deployments → the last good one → **Instant Rollback** (or Promote).
- **Database**: deploys never migrate data automatically. If an index change caused trouble,
  redeploy the previous commit and run `npm run db:indexes -- --apply` with it. The demo data can
  always be rebuilt with the seed (step 7) – never on real data.
- Rotating a leaked secret: change it on Render and redeploy. `JWT_ACCESS_SECRET` logs everyone
  out; **never rotate `AUDIT_HASH_SECRET`** (the existing chain would no longer verify).

## Troubleshooting

**CORS errors (socket)** – `CLIENT_URL` must be exactly the browser's origin: `https`, no trailing
slash, the production domain (preview deployments have other URLs). API calls through the rewrite
are same-origin and never need CORS; if you see CORS errors on `/api`, `VITE_API_URL` is absolute
by mistake.

**Logged out on every reload** – the refresh cookie is not first-party: check that
`VITE_API_URL=/api/v1` (relative) and the `/api` rewrite exist, `COOKIE_SAMESITE=lax`,
`COOKIE_SECURE=true`. In DevTools → Application → Cookies, `ma_rt` belongs to the Vercel domain
with path `/api/v1/auth`.

**502 / 504 on the first request** – Render was asleep and Vercel gave up waiting. Wait a minute
and reload. To avoid it during a demo, open `/api/v1/health` a minute before.

**The API does not start** (Render logs: "Invalid environment configuration") – the log lists each
variable and the reason (values are never printed). Typical: `CLIENT_URL` not https,
`STORAGE_DRIVER=local`, a missing Cloudinary or SMTP variable, a secret that looks like a
placeholder.

**`MongoServerSelectionError` / timeouts** – Atlas Network Access must allow `0.0.0.0/0`; check
the user and password in `MONGO_URI` (URL-encode special characters) and that the cluster is not
paused.

**Cloudinary 401 on PDFs or documents** – wrong `CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET` (both
sign every request), or a key from another Cloudinary account. Files are private: a 401 when
opening a `res.cloudinary.com` link directly is expected – downloads always go through the API.
Files uploaded before switching drivers (`local`) are not in Cloudinary: reseed the demo.

**No emails** – the Render log line "Notification email failed" shows the SMTP error code (never
the address), and the notification document in Atlas records `channels.email` (sent, attempts,
error code): `EAUTH` = wrong SMTP login/key,
`EENVELOPE` = sender not verified in Brevo.

**`client.ip` in /health shows a proxy address** – set `TRUST_PROXY=4` with the rewrite (3 for
direct calls to Render: its edge proxy and load balancer each add a hop; D207). Direct requests to the `onrender.com` URL can still claim any first
address (D201); per-user limits and the login lockout cover that.
