# NOD CRM

[![CI](https://github.com/ious2944/nod-crm/actions/workflows/ci.yml/badge.svg)](https://github.com/ious2944/nod-crm/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/ious2944/nod-crm)](https://github.com/ious2944/nod-crm/releases)
[![License](https://img.shields.io/github/license/ious2944/nod-crm)](LICENSE)
![Self-hosted](https://img.shields.io/badge/self--hosted-Docker-informational)

**Open-source, self-hosted CRM focused on follow-ups and the next action.**

Most CRMs answer “who are my customers?”. NOD CRM starts with a smaller, more urgent question:

> **Who should I follow up with today?**

A follow-up moves back and forth like a table-tennis ball: it is either **on your side** or **on theirs**. Tasks cover work that simply needs doing. Contacts and Organisations provide the context around both. The `Aujourd'hui` cockpit brings the work that needs attention now into one place.

> **V0.8 — RGPD Essentials.** NOD CRM adds a lightweight privacy-operations workspace for startups and small teams: treatment register, processors, data-subject requests, incidents and an action-oriented privacy cockpit. It helps document and operate essential privacy processes; it does **not** provide legal certification or replace professional advice.

NOD CRM is a young project used in production. Read [Limitations](#limitations) before adopting it. The interface is currently French-only; the documentation is in English.

---

## What NOD CRM is

NOD CRM deliberately avoids the generalist-CRM model. There are no sales pipelines, deal scoring, forecasting or marketing automation.

Its product areas stay intentionally distinct:

- **Follow-ups** — something to move forward with someone.
- **Tasks** — something to do.
- **Contacts** — the people involved.
- **Organisations** — the structures those people belong to.
- **RGPD Essentials** — the privacy work that needs to be documented and followed.

The product is organised around the next useful action rather than around collecting more fields.

---

## Aujourd'hui

`/today` is the cockpit and the natural starting point for a session. It answers one question: **what needs attention now?**

It shows four follow-up attention indicators (late, today, upcoming, waiting), a priority follow-up feed, and unfinished tasks due today or earlier. Upcoming and waiting follow-ups remain visible alongside the priority feed.

Tasks and follow-ups keep independent state machines: completing or snoozing one never silently changes the other.

---

## Features

### Follow-ups

- Subject, optional context, due date, ball owner and optional linked contact.
- Five-level visual ageing: upcoming → tomorrow → today → overdue → 7+ days late.
- Status: open, completed or abandoned.
- Quick actions: Nudge, Received, Ball sent, Snooze (+1 d / +3 d / +1 w), Complete, Abandon and Reopen.
- Filters: All / To nudge / My court / Their court / Completed.
- Search by subject and description, preserved in the URL and compatible with filters.
- Editing after creation: subject, description, due date and linked contact. Ball ownership and status remain quick-action-only.

### Tasks

- Title, due date and two states: to do or done.
- Optional contact and optional linked follow-up for context only.
- `/tasks` orders unfinished work overdue → today → upcoming.
- Complete, Reopen and Snooze actions.
- No state synchronisation with follow-ups by design.

See [docs/tasks.md](docs/tasks.md).

### Contacts

- Dedicated directory at `/contacts` with creation, viewing and editing.
- First name, last name, organisation, job title, email, phone, notes and optional photo.
- PostgreSQL search across name, email, phone, job title and organisation.
- Filters by organisation and follow-up state, four sort orders and server-side pagination.
- Contact sheet with linked follow-ups and a shortcut to create a follow-up with that contact preselected.
- Archive and restore instead of destructive deletion. Existing follow-up history is preserved.

### Organisations

- First-class organisation records at `/organizations`.
- Name, website, email, phone and notes.
- Live search, archive filter and pagination.
- Organisation sheet at `/organizations/[id]` with linked contacts, open follow-ups and open tasks.
- Archive and restore.
- Contacts link to organisations through a nullable foreign key; backward compatibility with the historical organisation text field is preserved.
- Workspace isolation applies to organisation reads, writes and relationships.

See [docs/organizations.md](docs/organizations.md).

### Privacy / RGPD Essentials — V0.8

The `/rgpd` area is deliberately a **mini-DPO workspace**, not a legal automation suite.

It contains five building blocks:

1. **Treatment register** — purpose, people concerned, data categories, legal basis, retention rule, recipients, transfers, security measures and review dates.
2. **Processors** — service, location, EEA status, DPA status, subprocessors and review dates. Processors can be linked to treatments.
3. **Data-subject requests** — access, rectification, erasure, objection, restriction, portability or other requests, with due dates and status tracking.
4. **Incidents / breaches** — discovery date, affected data, approximate number of people, consequences, measures, risk assessment and notification decisions.
5. **Privacy cockpit** — action-oriented alerts for missing legal bases or retention rules, DPA issues, overdue reviews, rights requests and incidents that still need assessment.

NOD CRM never displays “your company is GDPR compliant”. It highlights what has been documented and what still needs attention. See [docs/rgpd-essentials.md](docs/rgpd-essentials.md).

### UI — V0.7

V0.7 is the visual system used by all modules, including RGPD Essentials:

- Lumina Enterprise design system with semantic tokens and Electric Indigo (`#6366F1`) as the primary colour.
- Geist typography and a consistent spacing, radius and elevation system.
- Refreshed desktop sidebar and responsive mobile navigation.
- Sticky translucent page headers on application pages.
- Consistent card surfaces, filter pills, form focus states and contact avatars.
- Dark-mode token parity through `prefers-color-scheme`.
- Dialogs rendered at the document level so they remain accessible and scrollable on short and mobile viewports.

### Platform

- **Authentication** — email/password, Argon2id, server-side sessions with absolute and idle expiry, rate limiting.
- **Workspace isolation** — the workspace is derived server-side from the authenticated session, not from client input.
- **Admin CLI** — create workspaces and users, reset passwords and disable accounts. Passwords are entered interactively.
- **Self-hosting** — Docker Compose, PostgreSQL 16 and automatic Prisma migrations.
- **Demo data** — fictional organisations, contacts, follow-ups and tasks for a dedicated demo workspace. Seeded business rows are identifiable as demo data where supported by the model.

Not built yet, and deliberately shown as disabled in the navigation: Dashboard.

---

## Principles

- **Simplicity.** A feature must solve a real problem without making the product harder to understand.
- **Next action first.** Follow-up workflows and work requiring attention take precedence over CRM ceremony.
- **Self-hosting.** One application, one PostgreSQL database, no queue and no cache required.
- **Ownership of your data.** Administrators decide where application data lives and who can reach it.
- **No hidden telemetry.** NOD CRM sends no analytics or phone-home telemetry.
- **Privacy tooling, not legal certification.** RGPD Essentials helps operate privacy work; it does not make legal conclusions for the user.

---

## Screenshots

### Aujourd'hui

![NOD CRM — cockpit Aujourd'hui](docs/screenshots/today-light.png)

The cockpit brings together what needs attention now: priority follow-ups, tasks due today or overdue, upcoming items and work currently waiting on someone else.

### Follow-ups

![NOD CRM — Follow-up board](docs/screenshots/board-light.png)

The Follow-up board keeps the next action visible, with attention indicators, search, ownership filters and quick actions in one view.

### Tasks

![NOD CRM — Tasks](docs/screenshots/tasks-light.png)

The task view keeps independent work simple: overdue, today and upcoming tasks, with completion and snooze actions immediately available.

All screenshots use fictional demo data only. See [docs/screenshots/README.md](docs/screenshots/README.md).

---

## Quick start

You need [Docker](https://docs.docker.com/get-docker/) with the Compose plugin and `openssl`.

```bash
git clone https://github.com/ious2944/nod-crm.git
cd nod-crm
./scripts/init-env.sh
docker compose up -d
```

That builds the image, starts PostgreSQL, applies migrations and starts the application on `http://localhost:3000`.

`init-env.sh` is a convenience, not a requirement. `cp .env.example .env` and editing the secrets by hand works too. Generate them with:

```bash
openssl rand -base64 48                              # AUTH_SECRET
openssl rand -base64 36 | tr -d '/+=' | cut -c1-40   # POSTGRES_PASSWORD
```

### Create your first account

No credentials are seeded. Accounts are created manually and interactively:

```bash
docker compose exec app node scripts/admin.mjs create-workspace
docker compose exec app node scripts/admin.mjs create-user
```

Then open `http://localhost:3000` and sign in.

### Optional: demo data

```bash
docker compose exec app npx tsx prisma/seed.ts
```

The current seed creates **4 fictional organisations, 4 contacts, 7 follow-ups and 6 tasks** in the selected demo workspace. Re-running it replaces the seeded demo business data for that workspace. It never creates login credentials.

The seed refuses to run when `NODE_ENV=production` unless `ALLOW_DEMO_SEED=1` is explicitly set. For a dedicated demo workspace, `SEED_WORKSPACE_SLUG` and `SEED_WORKSPACE_NAME` can override the defaults.

### Migrations

The `migrate` service runs `prisma migrate deploy` before the application starts on every `docker compose up`. There is nothing to run by hand.

---

## Requirements

| | Self-hosting with Docker | Local development |
| --- | --- | --- |
| Docker | Engine + Compose plugin | optional |
| Node.js | not needed on the host | 20.9+ (22 is what CI and the image use) |
| PostgreSQL | provided by the stack | 16, reachable |
| RAM | ~1.5 GB for the whole stack | — |
| Disk | ~3 GB for the image and its build cache | — |

HTTPS is required in production: session cookies are `Secure`, so an instance served over plain HTTP cannot be logged into. See [docs/self-hosting.md](docs/self-hosting.md).

---

## Environment variables

Every variable is documented in [`.env.example`](.env.example). Summary:

| Variable | Required | Role |
| --- | --- | --- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | yes | Database credentials. Compose builds `DATABASE_URL` from them. |
| `AUTH_SECRET` | yes | HMAC pepper for session tokens, 32 characters minimum. Production refuses missing/example values. |
| `DATABASE_URL` | dev only | Direct connection string when running outside Docker. |
| `APP_NAME` | no | Name shown in the UI. Default `NOD CRM`. |
| `APP_SOURCE_URL` | no | Target of the Source link. Point it at your fork when required by AGPL §13. |
| `APP_TIME_ZONE` | no | Time zone for day-level due dates. Default `Europe/Paris`. |
| `APP_HOST_PORT` / `APP_BIND_ADDRESS` | no | Published address. Default `127.0.0.1:3000`. |
| `POSTGRES_VOLUME_NAME` | no | Docker volume holding PostgreSQL data. |
| `TEST_DATABASE_URL` | tests only | Separate database for integration tests; the suite truncates it. |

Changing `AUTH_SECRET` invalidates every existing session.

---

## Development

```bash
cp .env.example .env         # adjust DATABASE_URL to your PostgreSQL
npm install
npm run db:migrate
npm run dev                  # http://localhost:3000
```

If you would rather not install PostgreSQL:

```bash
docker compose -f docker-compose.dev.yml up -d
docker compose -f docker-compose.dev.yml exec app npm run db:migrate
```

More in [docs/development.md](docs/development.md).

---

## Testing

```bash
npm run lint
npm run typecheck
npm test
npm run test:integration     # needs TEST_DATABASE_URL — truncates that database
npm run build
```

Browser and CLI suites need a running instance and an account:

```bash
BASE_URL=http://127.0.0.1:3000 E2E_EMAIL=you@example.com E2E_PASSWORD='…' npm run test:e2e
npm run test:cli
```

`npm test` requires the generated Prisma client — run `npm run db:generate` first on a fresh clone.

---

## Security

NOD CRM authenticates requests server-side and derives the workspace from the session rather than client input. RGPD Essentials follows the same rule: every privacy record is scoped by `workspace_id`, and client-supplied foreign identifiers are rechecked against that workspace before relationships are created.

The threat model, controls and residual risks are documented in [docs/security-model.md](docs/security-model.md).

To report a vulnerability, read [SECURITY.md](SECURITY.md). Please do not open a public issue for one.

---

## Limitations

Known and accepted in V0.8:

- No MFA. A stolen password is enough. The data model is ready; the feature is not built.
- No roles. An authenticated user can do anything inside their workspace.
- Password reset goes through the CLI, not self-service.
- Multi-workspace isolation is enforced, but there is no UI to create or switch workspaces beyond the CLI.
- “Nudge” records the nudge; it does not send an email. NOD CRM sends no application email today.
- The Follow-up board has no pagination and loads every open follow-up. It is intended for modest workspace sizes; Contacts are paginated.
- Follow-up search on open items is in memory; the completed tab uses PostgreSQL `ILIKE`. There is no full-text/trigram index yet.
- Contact search uses `ILIKE`; `pg_trgm` is not shipped yet.
- Contact photos live on a volume rather than in PostgreSQL. Backup includes them, but restore remains a manual step; see [docs/backup-restore.md](docs/backup-restore.md).
- Follow-ups can be edited, but ball ownership and status remain quick-action-only.
- Tasks cannot be generically edited or deleted; they can be completed, reopened or snoozed.
- `/tasks` and `/today` are not paginated; the completed task tab is capped at 100.
- A task always has a due date; “someday” tasks are not supported.
- Quick actions require JavaScript. The login screen does not.
- The interface is French-only.
- **RGPD Essentials is an operational aid, not legal advice, legal certification, a DPIA/AIPD tool, a consent-management platform or an automated transfer-law assessment.**
- Legal bases, retention rules, DPA status, international-transfer assessments and breach-notification decisions are documented by the user; NOD CRM does not choose them automatically.

---

## Roadmap

Directions, not commitments. The full roadmap lives in [ROADMAP.md](ROADMAP.md).

- **V0.1 — Follow-Up — shipped.** Core follow-up workflow, authentication and self-hosting.
- **V0.2 — Contacts — shipped.** Directory, search, filters, pagination, photos and archiving.
- **V0.3 — Aujourd'hui — shipped.** Action-oriented cockpit for what needs attention now.
- **V0.4 — Tasks — shipped.** A separate task object and task-aware Today cockpit.
- **V0.5 — Organisations — shipped.** First-class organisations and Contact → Organisation relationships.
- **V0.6 — Follow-up Search & Editing — shipped.** Search plus safe editing of follow-up content.
- **V0.7 — Lumina Enterprise UI Refresh — shipped.** Unified visual system, responsive refinements, dark-mode parity and viewport-safe dialogs; no new business logic.
- **V0.8 — RGPD Essentials — current.** Treatment register, processors, rights requests, incidents and privacy alerts.

**Next.** CSV import/export, search-index improvements, better empty/error states, English UI scaffolding and small ergonomics remain candidates rather than commitments.

Later candidates include contact history and duplicate merging, follow-up history, audit log, MFA, self-service password reset, multi-user invitations, pagination at larger scales, public API/webhooks and recurring work.

Deliberately out of scope for a long time: sales pipelines, deal scoring, forecasting, marketing automation, plugin systems and AI features that guess what you should do.

---

## Contributing

Contributions are welcome, especially bug reports, documentation and small focused fixes. Read [CONTRIBUTING.md](CONTRIBUTING.md) first: the central rule is to **keep NOD CRM simple**.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

---

## License

NOD CRM is licensed under the **GNU Affero General Public License v3.0 only** ([AGPL-3.0-only](LICENSE)).

You may run it, modify it and self-host it. If you modify NOD CRM and let other people use your instance over a network, AGPL section 13 requires you to offer them the corresponding source. Point `APP_SOURCE_URL` at your repository when appropriate.

Third-party dependencies keep their own licenses; none of them was modified.

---

**Build. Open. Explain. Improve.**