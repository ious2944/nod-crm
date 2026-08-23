# Self-hosting NOD CRM

Everything below assumes a Linux host with Docker and the Compose plugin.

## 1. Install

```bash
git clone https://github.com/ious2944/nod-crm.git /opt/nod-crm
cd /opt/nod-crm
./scripts/init-env.sh        # writes .env (mode 600) with generated secrets
docker compose up -d
```

`docker compose up` does three things in order: builds the image, waits for
PostgreSQL to report healthy, runs `prisma migrate deploy` in a throwaway
container, and only then starts the application. If the migration fails, the
application never starts — which is the behaviour you want.

Check it came up:

```bash
docker compose ps
curl -s http://127.0.0.1:3000/api/health      # {"status":"ok"}
```

`degraded` means the application is running but cannot reach the database.

## 2. Create the first account

Nothing is seeded. Both commands are interactive; the password is typed masked
and never appears in your shell history or in `ps`.

```bash
docker compose exec app node scripts/admin.mjs create-workspace
docker compose exec app node scripts/admin.mjs create-user
```

Use `docker compose exec` **without** `-T`: masked input needs a real terminal.

Other commands: `list-workspaces`, `list-users`, `reset-password --email …`,
`disable-user --email …`.

## 3. Put HTTPS in front of it

**This step is not optional.** Session cookies are issued with the `Secure`
flag in production, so browsers will not send them over plain HTTP: an instance
without TLS cannot be logged into at all.

By default the application is published on `127.0.0.1:3000` and PostgreSQL
publishes nothing. A reverse proxy on the same host is the only intended entry
point. Ready-made samples:

- Nginx — [`deploy/nginx/`](../deploy/nginx/)
- Caddy — [`deploy/caddy/`](../deploy/caddy/)
- Traefik — [`deploy/traefik/`](../deploy/traefik/)

See [reverse-proxy.md](reverse-proxy.md) for what the proxy must and must not
do. Two rules matter:

1. **Set `X-Real-IP` from the real peer address.** It is the only header NOD CRM
   trusts for rate limiting. `X-Forwarded-For` is deliberately ignored, because
   its first element is attacker-controlled under the usual proxy configuration.
2. **Do not duplicate the application's security headers.** CSP, nosniff,
   Referrer-Policy and Permissions-Policy come from the app. Only HSTS belongs
   to the proxy — it is the only component that knows the request really
   arrived over TLS.

## 4. Harden the host

- **Firewall.** Open 80 and 443. Nothing else needs to be reachable — not 3000,
  not 5432.
- **Never publish the database port.** The provided Compose file does not. Do
  not add one "just for pgAdmin"; use `docker compose exec postgres psql`.
- **Keep `APP_BIND_ADDRESS=127.0.0.1`.** Changing it to `0.0.0.0` exposes an
  HTTP-only application that, as explained above, nobody can log into anyway.
- **`chmod 600 .env`**, owned by the user that runs Docker. It holds both
  secrets.
- **Fail2ban** (optional) — see [`deploy/fail2ban/`](../deploy/fail2ban/).
- **Back up, and verify the backups** — see
  [backup-restore.md](backup-restore.md).

## 5. Updating

```bash
cd /opt/nod-crm
git pull
docker compose up -d --build
```

Migrations run automatically before the new application container starts. Take
a backup first — always, but especially when the release notes mention a
migration.

Rolling back is `git checkout <previous tag> && docker compose up -d --build`.
Note that a rollback does **not** undo a database migration: if the release you
are leaving added a column, that column stays. Check the changelog before
rolling back across a migration.

## 6. Operating

```bash
docker compose logs -f app          # application logs
docker compose logs -f postgres
docker compose ps                   # health status
docker compose restart app
docker compose down                 # stop; the data volume survives
```

Logs are capped at 3 × 10 MB per service by the Compose file, so they cannot
fill the disk.

Authentication events look like this — masked email, IP fingerprint, no
secrets:

```
[auth] event=login.failed account=a***e@example.com src=12ca17b49af2
```

## 7. Revoking every session

Change `AUTH_SECRET` in `.env` and restart:

```bash
docker compose up -d
```

Every existing session token stops verifying instantly. This is the intended
emergency switch.

## 8. Resource footprint

| | Idle | Under load |
| --- | --- | --- |
| Application | ~200 MB | capped at 1 GB by the Compose file |
| PostgreSQL | ~50 MB | capped at 768 MB |
| Image on disk | ~2.8 GB | plus a comparable build cache |

The image is built on `node:22-bookworm` rather than a slim or Alpine base,
deliberately: `@node-rs/argon2` ships glibc binaries, and Prisma's migration
engine needs OpenSSL, which the slim variant does not carry. With slim, `prisma
migrate deploy` fails outright. The cost is image size.

## 9. Adopting an existing deployment

If you already ran NOD CRM with a different Compose file, point the new stack at
your existing data volume instead of starting from an empty database:

```bash
docker volume ls | grep nod-crm     # find the volume holding your data
```

Then set it in `.env`:

```
POSTGRES_VOLUME_NAME=<your-existing-volume>
```

Keep `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB` identical to what
that volume was initialised with — PostgreSQL will not re-create the role, and
a mismatched password means the application simply cannot connect.

**Take a backup before doing this.**
