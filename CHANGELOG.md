# Changelog

All notable changes to NOD CRM are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

**NOD CRM v0.3 — Cockpit "Aujourd'hui".**

### Added

- **Cockpit `/today`** — the new landing page of an open session, and the first
  brick of a personal workspace. It answers one question: what has to be done
  now, with whom, and what is about to slip away. Login, `/` and the sidebar
  all lead here; the follow-up board stays at `/follow-ups` as the full list.
- **Four attention counters** — late, today, next 7 days, waiting on them. Each
  one is also a filter of the feed (`/today?f=late`), and shares its predicate
  with the counter, so a counter can never announce a number the click
  contradicts.
- **Priority feed** — one list of what needs doing now, in order: biggest
  overdue first, then the day's work, then follow-ups that have stopped moving.
  What is merely due this week is *not* repeated here — "Prochainement" owns
  that window. Nudge, received, ball sent and complete are available on every
  row, through the existing Follow-up Server Action — the cockpit adds no
  second business logic.
- **Stagnation signal** — `⚠ Sans mouvement depuis N j` on a follow-up whose
  ball is with the other party and which has not moved for a week. Computed
  from `updated_at`; **no migration, no new column**. What that number does and
  does not measure is written down in `docs/cockpit.md`.
- **"Prochainement"** — the next seven days, read-only: these need no action
  today.
- **"En attente chez eux"** — what is cooling off, longest wait first, with a
  single relance action.
- **Positive empty states** per zone ("Rien en retard.", "Aucune réponse en
  attente.") instead of a generic empty list.
- **`docs/cockpit.md`** — prioritisation rules, what stagnation measures, the
  single query, and how the structure makes room for search, contact history,
  organisations, notes, automations and Mirai without a rewrite.

### Changed

- Login and `/` now redirect to `/today` instead of `/follow-ups`.
- The sidebar entry for the board reads **"Suivis"**, not "Follow-up": next to
  "Aujourd'hui", what has to be understood at a glance is the relation between
  the two — the day on one side, the full list on the other. The module keeps
  its name under the brand at the top of the sidebar.
- The mobile top bar wraps instead of overflowing. With a third module in it,
  its contents no longer fit 390 px and "Déconnexion" was pushed off-screen.
- The follow-up board's heading is "Follow-up"; "Aujourd'hui" now names the
  cockpit.
- Urgency colours and the ball badge moved to
  `src/components/follow-ups/urgency-styles.ts` and `ball-badge.tsx`, shared by
  the board and the cockpit so `J+11` cannot look different on two pages.
- A follow-up mutation now revalidates both `/follow-ups` and `/today`.

---

**NOD CRM v0.2 — Contacts.**

### Added

- **Contacts module** — a real directory at `/contacts`, and the sidebar entry
  is no longer marked "bientôt". A contact exists on its own: it does not need
  a follow-up. First and last name, organisation, job title, email, phone,
  free-form notes and an optional photo.
- **Contact sheet** (`/contacts/[id]`) — the person's details, the follow-ups
  attached to them, and a `+ Nouveau Follow-Up` button that opens the follow-up
  form with the contact already selected.
- **Server-side search** across first name, last name, email, phone, job title
  and organisation. Case-insensitive, tolerant of empty fields, one `AND`
  clause per typed word (so "julien doussot" works), debounced in the browser
  and carried by the URL. The browser never receives the whole directory.
- **Filters and sorting** — organisation (including "without organisation"),
  follow-up state (any / active / none / all closed), and four sort orders
  (name A→Z, Z→A, recently added, recently modified). Pagination is
  server-side, 20 per page.
- **Follow-up counts per contact** — computed with one grouped aggregation for
  the whole page, never one query per row.
- **Contact photos** — optional upload, validated by the file's actual leading
  bytes (PNG, JPEG, GIF, WebP; 2 MB max), stored under a server-generated
  random key in a new object store (`src/lib/storage`) behind a swappable
  interface. Images are never stored in PostgreSQL. They are served by
  `/api/contacts/[id]/photo`, which re-checks session and workspace. Contacts
  without a photo get an initials avatar.
- **Archiving** — `DELETE` sets `archived_at`. Archived contacts leave the
  list, the search and the follow-up picker; their sheet stays reachable so
  they can be restored. Their follow-ups are never deleted or unlinked.
- **`docs/contacts.md`** — the module's design decisions, including why
  organisations are still a text field and the exact path to a table.

### Changed

- The follow-up form's contact field is a **search box** instead of a
  drop-down: it queries PostgreSQL as you type and returns at most eight
  suggestions. The page no longer loads every contact of the workspace. The
  submitted field contract is unchanged (`contactId` = empty, `new`, or a
  UUID), as is inline contact creation.
- `contacts` gains `phone`, `job_title`, `notes`, `photo_key`,
  `photo_mime_type` and `archived_at`; its indexes are realigned on the three
  list sorts. The migration is additive — no existing row or column is touched,
  and `follow_ups.contact_id` is untouched.
- The Docker stack mounts a named volume for contact photos
  (`nod-crm-uploads-data`), and `deploy/backup/nod-crm-backup.sh` now writes a
  second archive of it on every run, sharing the dump's timestamp. It refuses
  to produce a database-only backup unless asked explicitly
  (`NOD_CRM_SKIP_UPLOADS=1`): a backup that silently covers half the data is
  the one you discover is incomplete on the day you need it. Restoring the
  photos stays a manual step, documented in `docs/backup-restore.md`.
- Shared form styling and a confirmation dialog moved to `src/components/ui/`,
  so Contacts and Follow-Up render identical fields.

### Security

- Photo uploads: real MIME sniffing (the announced type and file name are
  ignored), a 2 MB ceiling checked before the file is read into memory, a
  server-generated random storage key, and two independent guards against path
  traversal. SVG is refused.
- Photos are not static assets. Serving one goes through the data access layer;
  an unknown id and another workspace's id return the same `404`.
- Every contact read and write is scoped to the workspace derived from the
  session, and validated by a schema that enumerates its fields — an
  enriched form cannot set `workspace_id`, `is_demo` or `archived_at`.


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
