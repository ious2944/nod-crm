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

## V0.3 — Cockpit "Aujourd'hui" *(current)*

Shipped:

- A cockpit at `/today`, the landing page of an open session: four attention
  counters, one priority feed, next seven days, and what is waiting on them.
- Prioritisation that mixes late, today, stalled and upcoming into one list
  instead of several screens.
- A stagnation signal derived from `updated_at` — no new column. Its limits are
  written down in [docs/cockpit.md](docs/cockpit.md).
- Acting from the cockpit through the existing follow-up actions, not a second
  implementation of them.

---

## V0.4 — Organisations and follow-up editing

The gaps that show up fastest in daily use:

- **Organisations** promoted from a text field to a table, with the contacts
  hanging off it. The migration path is already written down in
  [docs/contacts.md](docs/contacts.md).
- **Search** across follow-ups (contacts already have it).
- **Editing an existing follow-up** — today only the quick actions can change
  one after creation.
- **CSV import and export** for contacts, so nobody is locked in.
- **Empty and error states** that say what to do next, not just that nothing
  is there.
- **English UI**, and the internationalisation scaffolding that makes other
  languages possible. The interface is French-only today.
- Small ergonomics: keyboard shortcuts, undo just after a quick action.

---

## Later

Worth building eventually, in no particular order:

- **Contact history and duplicate merging** — the page itself shipped in V0.2.
- **Follow-up history** — every nudge, snooze and hand-off, visible on the item.
  It would also make the cockpit's stagnation figure exact rather than a lower
  bound; see [docs/cockpit.md](docs/cockpit.md).
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
- **Recurring follow-ups** ("nudge every 15 days while the ball is theirs").
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
