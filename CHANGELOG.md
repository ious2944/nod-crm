# Changelog

All notable changes to NOD CRM are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

**NOD CRM v0.4 — Tasks.**

### Added

- **Tasks module** — a second business object next to the follow-up, and the
  distinction is the whole point: **a task is something to do, a follow-up is
  something to move forward with someone.** A task has a title, a due date,
  optional notes, and exactly two states (`completed_at IS NULL` or not). No
  priority, no status machine, no workflow to configure.
- **`/tasks`** — the list, ordered by urgency: overdue, then today, then
  upcoming, as compact rows rather than cards. Completed tasks leave the main
  list and sit behind a "Terminées" tab (capped at the last 100). Each row
  carries the title, the due date, the contact and the linked follow-up, with
  Complete as the primary action and Snooze (Demain / +3 j / +1 sem.) as the
  secondary one.
- **`/today` — the "Aujourd'hui" cockpit** — the V0.3 cockpit extended with
  tasks, not replaced. The greeting, date, four follow-up attention indicators
  (`En retard` / `Aujourd'hui` / `À venir` / `Chez eux`), priority follow-up
  feed (late + today + stagnant), upcoming and waiting sections are all
  unchanged. V0.4 adds a task section in the main column below the priority
  feed: tasks where `completed_at IS NULL AND due_at <= end of the current day`
  in `APP_TIME_ZONE`. Completing or snoozing either kind refreshes the cockpit
  immediately. The four attention indicators remain follow-up-only; a separate
  explicit task count link is shown below them when tasks are due.
- **Optional links** — a task may reference a contact, a follow-up, both, or
  neither. The contact is context and links to their sheet; it does not give
  the task a ball or a nudge count. **No state is ever synchronised**:
  completing a task never completes the follow-up it cites, and completing a
  follow-up never completes the task. Deleting either link target keeps the
  task and clears the link.
- **`docs/tasks.md`** — the module's design decisions: the two states, the
  actionable-today rule, why nothing synchronises, how the workspace boundary
  is enforced, and what was left out on purpose.

### Changed

- **Navigation** now reads Aujourd'hui / Suivis / Tâches / Contacts. The
  follow-up page keeps everything it had — the four counters, the five filters,
  the full list — but is now titled **Suivis**: the daily cockpit it used to
  double as has become a page of its own at `/today`, which is the only way a
  single feed can mix follow-ups and tasks without turning the list into a
  second dashboard. On mobile the top bar moved to two rows, because four
  modules no longer fit on one line under 400 px.
- **The four V0.3 attention indicators are untouched** — `En retard`,
  `Aujourd'hui`, `À venir`, `Chez eux` still count follow-ups and only
  follow-ups, and still appear on the cockpit `/today` page exactly as in V0.3.
  A separate, explicitly-named task count is shown below them; the two meanings
  are never mixed silently.
- Tasks reuse the follow-up due-date vocabulary and the existing ageing tokens
  (`J+4`, `Aujourd'hui`, `Demain`, `Dans 5 j`). **V0.4 adds no colour**, so
  dark mode follows without a line of new palette.
- Shared UI extracted rather than duplicated, with the behaviour unchanged:
  the due-date badge (`ui/due-badge`), the one-mutation-at-a-time row actions
  (`ui/row-actions`), and the search-then-pick field (`ui/search-picker`) that
  the contact picker now uses too.
- The demo seed adds six tasks covering every display case: overdue, today,
  tomorrow, later, completed, with and without a contact, with and without a
  linked follow-up, short and very long titles.

### Security

- Every task read and write is scoped to the workspace derived from the
  session. No function in `src/lib/tasks/queries.ts` even accepts a
  `workspaceId` argument, so no code path can cross the boundary by accident.
- `contact_id` and `follow_up_id` are re-checked against the session's
  workspace before any write: linking a task to another workspace's contact or
  follow-up fails closed, and an archived contact is refused like an unknown
  one. A composite `(id, workspace_id)` foreign key would have enforced this in
  PostgreSQL but would have ruled out the `ON DELETE SET NULL` that keeps a
  task alive when its contact or follow-up disappears — so the check lives in
  the action, and the tests cover both directions.
- Task transitions are validated server-side (complete, reopen, snooze only)
  and applied with a conditional `updateMany` whose `WHERE` repeats the state
  read a moment earlier, so two simultaneous clicks cannot both win.
- The create schema enumerates its fields: an enriched form cannot set
  `workspace_id`, `completed_at` or `is_demo`.


**NOD CRM v0.2 — Contacts.** Still unreleased too: v0.2 and v0.4 will ship
together, since no tag was cut in between.

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
