# Roadmap

Directions, not commitments. Nothing here is a promise, a date, or a
contractual obligation. Items move, get postponed, or get dropped when they
turn out to make the product worse.

The filter every item goes through:

> Does it help someone answer *"who should I follow up with today?"* without
> making NOD CRM harder to understand?

---

## V0.1 — Follow-Up

Shipped and in use:

- Contacts, created inline from the follow-up form.
- Follow-ups: subject, context, due date, ball owner, status.
- The workflow: create → wait → nudge → ball sent → complete.
- Quick actions: nudge, received, ball sent, snooze, complete, abandon, reopen.
- Filters: all, to nudge, my court, their court, completed.
- Five-level visual ageing, driven by a time zone you configure.
- Email and password authentication, Argon2id, server-side sessions.
- Server-side authorization on every page and every action, workspace isolation.
- Rate limiting, security headers with a per-request CSP nonce.
- Admin CLI: workspaces, users, password resets, account deactivation.
- Self-hosting: Docker Compose, PostgreSQL 16, automatic migrations.
- Unit, integration, browser and CLI test suites.

---

## V0.2 — Contacts

Shipped:

- A Contacts module of its own: directory, contact sheet, creation and editing.
- Server-side search across name, email, phone, job title and organisation.
- Filters (organisation, follow-up state), four sort orders, server pagination.
- Optional contact photo, validated and stored outside the database.
- Archiving instead of deletion — follow-ups are always preserved.
- An optional contact on any follow-up, chosen through a server-side search.

---

## V0.4 — Tasks

Shipped:

- **Tasks**: a title, a due date, two states (to do / done). Nothing else — no
  priority, no status machine, no workflow to configure.
- A **task page** (`/tasks`) ordered by urgency — overdue, today, upcoming —
  with Complete and Snooze on each row, and completed tasks one tab away.
- An **optional contact** and an **optional linked follow-up**, both for
  context. Neither creates any synchronisation: completing a task never
  completes a follow-up, and the reverse is just as true.
- The **"Aujourd'hui" cockpit** (`/today`): one feed with the open follow-ups
  whose due date has arrived and the unfinished tasks due today or overdue.
- Workspace isolation extended to tasks and to both of their links, with
  integration tests for read, write, complete, snooze and cross-workspace
  linking.
- Design decisions and the exact boundary rules: [docs/tasks.md](docs/tasks.md).

---

## V0.5 — Organisations

Shipped:

- **Organisations** promoted from a text field to a first-class table. Name is
  required; website, email, phone, notes are optional.
- **`/organizations`** — live search, archive filter, pagination.
- **`/organizations/[id]`** — the organisation sheet: identity, contacts (with
  links), open follow-ups and open tasks. The central piece of the module.
- **`Contact → Organisation` FK** — nullable, additive migration, backward
  compatibility with pre-V0.5 contacts preserved via the `organization_name`
  text column.
- **Organisation picker** in the contact form, backed by a server-side search.
- **Clickable org link** on the contact sheet when the contact is linked via FK.
- Workspace isolation extended to organisations, with integration tests covering
  all cross-workspace access vectors.
- Design decisions: [docs/organizations.md](docs/organizations.md).

---

## V0.6 — Follow-up Search & Editing *(current)*

Shipped:

- **Follow-up search** — a search bar on `/follow-ups` filters by subject and
  description. Server-side (ILIKE for the "done" tab, in-memory for open items
  already loaded for stats), preserved in `?q=`, works alongside `?f=`.
- **Follow-up editing** — a "Modifier" button on each card opens an edit
  dialog. Editable fields: subject, description, due date, contact. Ball
  ownership and status remain the exclusive domain of the quick actions.

---

## Next — CSV import/export

The gaps that show up fastest in daily use:
- **CSV import and export** for contacts, so nobody is locked in.
- **Full-text search index** (`pg_trgm`) for contacts and follow-ups, once
  a workspace is large enough that the sequential scan shows.
- **Empty and error states** that say what to do next, not just that nothing
  is there.
- **English UI**, and the internationalisation scaffolding that makes other
  languages possible. The interface is French-only today.
- Small ergonomics: keyboard shortcuts, undo just after a quick action.

---

## Later

Worth building eventually, in no particular order:

- **Contact history and duplicate merging** — the page itself shipped in V0.2.
- **Tasks on the contact sheet** — a person's open tasks next to their
  follow-ups, and a task count in the directory. Deliberately left out of V0.4
  to keep the module small.
- **Follow-up history** — every nudge, snooze and hand-off, visible on the item.
- **Business audit log** — who completed what, and when.
- **MFA (TOTP), then passkeys.** The data model already accommodates it: a
  server-side session can represent a half-authenticated state.
- **Self-service password reset**, once there is a mail path worth securing.
- **Real multi-user workspaces** with invitations. Isolation is already
  enforced everywhere; what is missing is the UI and the invitation flow.
- **Pagination on the follow-up board**, needed past roughly 2,000 open items.
  The Contacts list is already paginated.
- **Trigram search index** (`pg_trgm`) for contacts, once a workspace is large
  enough that the sequential scan shows.
- **Public API and webhooks**, if and when something concrete needs them.
- **Recurring follow-ups** ("nudge every 15 days while the ball is theirs"),
  and recurring tasks, which raise exactly the same questions.
- **Notes** on a follow-up, timestamped.
- **Tags**.
- **Email reminders**. Note that this means NOD CRM starts sending mail, with
  everything that implies — deliverability, configuration, a new failure mode.

---

## Explicitly out of scope, and for a long time

Not "later". Not planned.

- Sales pipelines, stages, deal scoring, forecasting.
- Marketing automation and campaigns.
- A plugin or extension system.
- A mobile application. The interface is responsive; that is the answer.
- SSO, SCIM, enterprise RBAC.
- AI features that guess what you should do. NOD CRM shows you what you already
  decided to do.

Each of these would double the surface area of a product whose value is that it
has almost none.

---

## Deliberate non-features

Some things are missing on purpose, and will stay missing:

- **Telemetry.** NOD CRM sends nothing anywhere, ever.
- **A hosted version.** It is self-hosted software.
- **Mandatory third-party services.** One database, one application.
