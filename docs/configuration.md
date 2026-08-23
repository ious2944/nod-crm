# Configuration

All configuration is environment variables. There is no config file to edit and
no settings screen — an instance is fully described by its `.env`.

Every value is read **server-side at runtime**. Nothing is baked into the
client bundle, so renaming an instance or changing its time zone is a restart,
not a rebuild.

## Required

### `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`

Database credentials. `docker-compose.yml` builds `DATABASE_URL` from them, so
they are the single source of truth for the Docker stack.

```bash
openssl rand -base64 36 | tr -d '/+=' | cut -c1-40
```

Alphanumeric on purpose: the value ends up inside a connection URL, where `/`,
`+` and `@` would need escaping.

The database publishes no port, so this password only guards access from inside
the private Docker network. Make it strong anyway — it is also what protects
your backups if one leaks.

### `AUTH_SECRET`

HMAC pepper for session tokens. The database stores only
`HMAC-SHA256(token, AUTH_SECRET)`, so a database leak on its own cannot be
turned into a valid cookie: an attacker also needs this value.

```bash
openssl rand -base64 48
```

- Minimum 32 characters; the application refuses anything shorter.
- In production it refuses placeholder values (`change-me…`, the development
  fallback) outright. They are long enough to pass the length check, which made
  them silently acceptable before.
- Without it, the application refuses to start in production. In development it
  falls back to a known constant so you can run `npm run dev` with no setup.
- **Changing it logs everyone out.** That is the intended way to revoke every
  session at once.

Store it in a password manager. Losing it does not lose your data, but it does
invalidate every session and cannot be recovered.

## Optional

### `APP_NAME` — default `NOD CRM`

The name shown in the sidebar, the login screen and the page title. Set it to
your own organisation's name if you prefer.

### `APP_SOURCE_URL` — default: the upstream repository

Target of the "Source" link in the sidebar.

NOD CRM is AGPL-3.0. If you **modify** it and let other people use your instance
over a network, section 13 requires you to offer them the corresponding source.
Point this at your fork and that obligation is met. If you run it unmodified,
the default is already correct.

### `APP_TIME_ZONE` — default `Europe/Paris`

Any IANA time zone (`America/New_York`, `Asia/Tokyo`, `UTC`…).

Due dates in NOD CRM are day-level: "due today", "3 days late", "+1 week". The
server may run in UTC, and "today" must not depend on that. This is the time
zone in which a day starts and ends.

Changing it shifts how existing due dates are *interpreted*, not the values
stored. A follow-up due "today" in Paris may read as due "yesterday" after a
switch to `Asia/Tokyo`. Pick one and leave it alone.

### `APP_HOST_PORT` — default `3000`

Host port the application is published on. Change it if 3000 is taken.

### `APP_BIND_ADDRESS` — default `127.0.0.1`

Address the port is bound to. The default keeps NOD CRM off the network, with a
reverse proxy as the only entry point.

Setting it to `0.0.0.0` publishes an HTTP-only application. Because session
cookies are `Secure` in production, browsers will not send them over plain HTTP
— such an instance is reachable but cannot be logged into. Terminate TLS in a
proxy instead.

### `POSTGRES_VOLUME_NAME` — default `nod-crm-postgres-data`

Name of the Docker volume holding the database. Change it **only** to adopt an
existing volume. Pointing it at a name that does not exist creates an empty
volume: PostgreSQL initialises a blank database and the application starts with
no data. It does not migrate anything.

### `DATABASE_URL` — development only

Direct connection string, used when you run the application outside Docker
(`npm run dev`, `npm run db:migrate`, `npm run db:seed`). The Docker stack
builds its own and ignores this.

```
postgresql://user:password@127.0.0.1:5432/nod_crm?schema=public
```

### `TEST_DATABASE_URL` — tests only

Database used by `npm run test:integration`. **The suite truncates its tables
between test files.** Point it at a dedicated database; the setup file refuses
to run if it is identical to `DATABASE_URL`.

### `SEED_WORKSPACE_SLUG` / `SEED_WORKSPACE_NAME`

Workspace the demo seed writes into. Defaults: `demo` / `Demo Workspace`.

### `ALLOW_DEMO_SEED`

Set to `1` to allow the demo seed to run with `NODE_ENV=production`. It refuses
by default, because demo rows have no business being in a production database.
Only useful on a dedicated staging instance.

## Startup checks

In production, the server validates its configuration **before it accepts a
single request** (`src/instrumentation.ts`). If `DATABASE_URL` is missing, or
`AUTH_SECRET` is missing, too short, or a placeholder, the process logs one
line and exits:

```
[config] démarrage refusé : AUTH_SECRET utilise une valeur d'exemple : refusé en production.
```

This is deliberate. These values are only read lazily — the secret when a
session token is hashed, the database URL on the first query — so a
misconfigured instance used to serve the login page perfectly and fail with a
500 at the first login attempt. A configuration error should be visible at
startup, in the logs, before anyone can use the instance.

Under Docker the container exits and restarts in a loop, which says plainly
that something is wrong. `docker compose logs app` shows the line.

## What is deliberately not configurable

- **`NODE_ENV`** is fixed to `production` in the Compose file. Leaving it
  settable from an environment file means one typo away from running a
  development build in production, with verbose errors and non-`Secure`
  cookies.
- **Session lifetimes** (7 days absolute, 12 hours idle) are constants in
  `src/lib/auth/session.ts`. Making them configurable invites someone to set a
  90-day session because it is convenient.
- **Password policy** (12 characters minimum, three character classes) lives in
  `scripts/admin.mjs`, the only place that ever creates a password.
- **Rate limits** (5 failures per account, 30 per IP, 15-minute window) are
  constants in `src/lib/auth/rate-limit.ts`. Tune the proxy layer instead — it
  is designed for that and it sits in front.

All of these are a few lines to change in a fork. They are simply not knobs on
the outside of the box, because every knob is a way to weaken the defaults by
accident.
