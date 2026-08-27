# Roadmap

Directions, not commitments. Nothing here is a promise, a date, or a contractual obligation.

The filter every item goes through:

> Does it help someone understand what needs attention next without making NOD CRM harder to use?

---

## V0.1 — Follow-Up

Shipped:

- Follow-ups, due dates, ball ownership and status.
- Quick actions: nudge, received, ball sent, snooze, complete, abandon, reopen.
- Authentication, workspace isolation and self-hosting.

## V0.2 — Contacts

Shipped:

- Dedicated Contacts module.
- Search, filters, sorting, pagination, photos and archiving.
- Optional contact on a follow-up.

## V0.3 — Aujourd'hui

Shipped:

- Action-oriented cockpit for the work that needs attention now.
- Priority follow-ups, upcoming items and waiting items.

## V0.4 — Tasks

Shipped:

- Separate task object: something to do, distinct from a follow-up.
- `/tasks` and task-aware Today cockpit.
- Optional contact and follow-up context without state synchronisation.

See [docs/tasks.md](docs/tasks.md).

## V0.5 — Organisations

Shipped:

- First-class organisations.
- Organisation list and detail pages.
- Contact → Organisation relationship.
- Workspace isolation extended to organisations.

See [docs/organizations.md](docs/organizations.md).

## V0.6 — Follow-up Search & Editing

Shipped:

- Follow-up search compatible with existing filters.
- Safe editing of subject, description, due date and linked contact.

## V0.7 — Lumina Enterprise UI Refresh

Shipped:

- Electric Indigo design system and semantic tokens.
- Refreshed navigation, sticky page headers, cards, forms, responsive layouts and dark mode.
- Viewport-safe dialogs.
- Visual-only release: no new business logic.

---

## V0.8 — RGPD Essentials *(current)*

A lightweight privacy operations workspace for startups, TPEs and small teams.

Shipped in the V0.8 scope:

- **RGPD cockpit** at `/rgpd` with counts and action-oriented alerts.
- **Treatment register** — purpose, people, data categories, legal basis, retention, recipients, transfers, security measures and review dates.
- **Processors** — service, location, EEA status, DPA status, subprocessors and review dates.
- **Treatment ↔ Processor relationships** with workspace checks.
- **Data-subject requests** — access, rectification, erasure, objection, restriction, portability and other requests with deadlines and statuses.
- **Incidents / breaches** — facts, affected data, approximate population, consequences, measures, risk level and notification decisions.
- **Privacy alerts** — missing legal basis/retention, DPA and transfer checks, overdue reviews, request deadlines and open incidents.
- **Workspace isolation** on every privacy entity and relationship.

Deliberate V0.8 boundaries:

- No legal certification.
- No automated legal conclusion.
- No DPIA/AIPD builder.
- No cookie CMP.
- No automated SCC or transfer-law assessment.
- No legal AI.

The product helps document and operate privacy work; it does not decide the law for the user.

---

## Next

Candidates after V0.8, ordered by observed product need rather than by commitment:

- CSV import/export for contacts.
- Better search indexes (`pg_trgm`) when workspace size justifies them.
- Better empty/error states and small keyboard ergonomics.
- English UI scaffolding.
- Contact history and duplicate merging.
- Follow-up history and business audit log.
- MFA and self-service password reset.
- Multi-user invitations.
- Public API/webhooks if a concrete integration needs them.
- Recurring work.

---

## Explicitly out of scope for a long time

- Sales pipelines, stages, deal scoring and forecasting.
- Marketing automation and campaigns.
- Plugin ecosystems.
- Native mobile application.
- Enterprise SSO/SCIM/RBAC.
- AI features that guess what the user should do.

NOD CRM is valuable because its surface stays small.
