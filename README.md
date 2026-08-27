# NOD CRM

[![CI](https://github.com/ious2944/nod-crm/actions/workflows/ci.yml/badge.svg)](https://github.com/ious2944/nod-crm/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/ious2944/nod-crm)](https://github.com/ious2944/nod-crm/releases)
[![License](https://img.shields.io/github/license/ious2944/nod-crm)](LICENSE)
![Self-hosted](https://img.shields.io/badge/self--hosted-Docker-informational)

**Open-source, self-hosted CRM focused on follow-ups and the next action.**

Most CRMs answer “who are my customers?”. NOD CRM starts with a smaller, more urgent question:

> **Who should I follow up with today?**

A follow-up moves back and forth like a table-tennis ball: it is either **on your side** or **on theirs**. Tasks cover work that simply needs doing. Contacts and Organisations provide the context around both. The `Aujourd'hui` cockpit brings the work that needs attention now into one place.

**V0.8 adds RGPD Essentials:** a lightweight privacy operations workspace for small teams — treatment register, processors, data-subject requests, incidents and action-oriented alerts. It helps document and operate essential privacy processes; it does **not** provide legal certification or replace professional advice.

NOD CRM is a young project used in production. Read [Limitations](#limitations) before adopting it. The interface is currently French-only; the documentation is in English.

---

## What NOD CRM is

NOD CRM deliberately avoids the generalist-CRM model. There are no sales pipelines, deal scoring, forecasting or marketing automation.

Its product areas stay intentionally simple:

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
- Contacts link to organisations through a nullable foreign key.
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

NOD CRM never displays “your company is GDPR compliant”. It highlights what has been documented and what still needs attention.

### UI — V0.7

- Lumina Enterprise design system with Electric Indigo (`#6366F1`) as the primary colour.
- Geist typography and consistent spacing, radius and elevation.
- Responsive desktop sidebar and mobile navigation.
- Sticky translucent page headers.
- Consistent card surfaces and form focus states.
- Dark-mode token parity through `prefers-color-scheme`.
- Viewport-safe dialogs.

### Platform

- **Authentication** — email/password, Argon2id, server-side sessions with absolute and idle expiry, rate limiting.
- **Workspace isolation** — the workspace is derived server-side from the authenticated session, not from client input.
- **Admin CLI** — create workspaces and users, reset passwords and disable accounts.
- **Self-hosting** — Docker Compose, PostgreSQL 16 and automatic Prisma migrations.
- **Demo data** — fictional organisations, contacts, follow-ups and tasks for a dedicated demo workspace.

Not built yet, and deliberately shown as disabled in the navigation: Dashboard.

---

## Principles

- **Simplicity.** A feature must solve a real problem without making the product harder to understand.
- **Next action first.** Work requiring attention takes precedence over CRM ceremony.
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

The current seed creates fictional organisations, contacts, follow-ups and tasks in the selected demo workspace. It never creates login credentials.

The seed refuses to run when `NODE_ENV=production` unless `ALLOW_DEMO_SEED=1` is explicitly set.

### Migrations

The `migrate` service runs `prisma migrate deploy` before the application starts on every `docker compose up`.

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

## Development

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

More in [docs/development.md](docs/development.md).

---

## Testing

```bash
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
```

Browser and CLI suites need a running instance and an account:

```bash
BASE_URL=http://127.0.0.1:3000 E2E_EMAIL=you@example.com E2E_PASSWORD='…' npm run test:e2e
npm run test:cli
```

---

## Security

NOD CRM authenticates requests server-side and derives the workspace from the session rather than client input. RGPD Essentials follows the same rule: every privacy record is scoped by `workspace_id`, foreign-workspace relationships are rejected, and privacy data is not intended for application logs.

The threat model, controls and residual risks are documented in [docs/security-model.md](docs/security-model.md).

To report a vulnerability, read [SECURITY.md](SECURITY.md). Please do not open a public issue for one.

---

## Limitations

Known and accepted in V0.8:

- No MFA and no roles yet.
- Password reset goes through the CLI, not self-service.
- Multi-workspace isolation is enforced, but there is no UI to create or switch workspaces beyond the CLI.
- “Nudge” records the nudge; it does not send an email.
- Follow-up search and list scaling remain designed for modest workspace sizes.
- Tasks cannot be generically edited or deleted; they can be completed, reopened or snoozed.
- The interface is French-only.
- **RGPD Essentials is an operational aid, not legal advice, legal certification, a DPIA tool, a consent-management platform or an automated transfer-law assessment.**
- Legal bases, retention periods, DPA status, transfers and breach notification decisions are documented by the user; NOD CRM does not choose them automatically.

---

## Roadmap

Directions, not commitments. The full roadmap lives in [ROADMAP.md](ROADMAP.md).

- **V0.1 — Follow-Up — shipped.** Core follow-up workflow, authentication and self-hosting.
- **V0.2 — Contacts — shipped.** Directory, search, filters, pagination, photos and archiving.
- **V0.3 — Aujourd'hui — shipped.** Action-oriented cockpit for what needs attention now.
- **V0.4 — Tasks — shipped.** Separate task object and task-aware Today cockpit.
- **V0.5 — Organisations — shipped.** First-class organisations and Contact → Organisation relationships.
- **V0.6 — Follow-up Search & Editing — shipped.** Search plus safe editing of follow-up content.
- **V0.7 — Lumina Enterprise UI Refresh — shipped.** Unified visual system, responsive refinements, dark-mode parity and viewport-safe dialogs.
- **V0.8 — RGPD Essentials — current.** Treatment register, processors, rights requests, incidents and privacy alerts.

Later candidates include CSV import/export, contact history and duplicate merging, follow-up history, audit log, MFA, self-service password reset, multi-user invitations, pagination at larger scales, public API/webhooks and recurring work.

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