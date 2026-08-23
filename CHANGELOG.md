# Changelog

All notable changes to NOD CRM are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

Nothing yet.

## [0.1.0] — first open-source release

**NOD CRM v0.1 — Follow-Up.**

The first public release. NOD CRM existed before this as a private
application; this release is the point at which it became something anyone can
clone, run and contribute to.

### Added

- **Follow-Up module** — the first and only business module. Create a
  follow-up with a subject, optional context, a due date and a ball owner, then
  drive it with quick actions: nudge, received, ball sent, snooze (+1 d / +3 d /
  +1 week), complete, abandon, reopen.
- **Contacts** — first name, last name, optional email and organisation,
  created inline from the follow-up form.
- **Board** — every open follow-up sorted from most overdue to furthest away,
  with a five-level visual ageing scale and filters (all, to nudge, my court,
  their court, completed).
- **Authentication** — email and password, Argon2id (OWASP parameters),
  server-side sessions with absolute and idle expiry, `__Host-` cookie,
  HttpOnly / Secure / SameSite=Lax, session fixation prevention on login.
- **Authorization** — every page and every Server Action authenticates in the
  data access layer before reading its inputs, and re-checks any
  client-supplied identifier against the session's workspace.
- **Rate limiting** — per account and per IP, stored in PostgreSQL, plus sample
  Nginx and Fail2ban configuration for the network layer.
- **Security headers** — Content-Security-Policy with a per-request nonce,
  `frame-ancestors 'none'`, nosniff, Referrer-Policy, Permissions-Policy.
- **Admin CLI** (`scripts/admin.mjs`) — create workspaces and users, reset
  passwords, disable accounts. Passwords are always typed interactively, never
  accepted as arguments.
- **Self-hosting** — a Docker Compose stack that builds the image, applies
  migrations and starts the application; a non-root production image with a
  health check that probes the database rather than a page.
- **Documentation** — self-hosting, configuration, development, database,
  backup and restore, reverse proxy, and a full security model with an honest
  list of residual risks.
- **Tests** — unit, PostgreSQL integration (authentication, authorization,
  workspace isolation, validation, adversarial), browser end-to-end, and a
  pseudo-terminal suite for the admin CLI.
- **AGPL-3.0-only license**, with a "Source" link in the interface so operators
  of modified instances can satisfy section 13 by pointing `APP_SOURCE_URL` at
  their own repository.

### Security

- `AUTH_SECRET` now refuses placeholder values (`change-me`, the development
  fallback, the build-time values used by the Dockerfile and CI) in production.
  They are long enough to pass the length check, which made them silently
  acceptable — a real risk once `.env.example` is public.
- Configuration is validated at **startup** rather than on first use. A missing
  `DATABASE_URL` or an unusable `AUTH_SECRET` now logs one line and exits,
  instead of serving the login page and failing with a 500 at the first login
  attempt.

### Notes

- The interface is French only. Documentation is English.
- No telemetry, no analytics, no phone-home.

[Unreleased]: https://github.com/ious2944/nod-crm/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ious2944/nod-crm/releases/tag/v0.1.0
