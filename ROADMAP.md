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

## V0.8 — RGPD Essentials

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

## V0.9 — Commerce *(current)*

A lightweight commercial opportunity module.

Shipped in the V0.9 scope:

- **Opportunity list** at `/commerce` with open/closed/all filters and pipeline statistics.
- **Five-stage pipeline** — À qualifier, En discussion, Proposition, Gagnée, Perdue — with server-side state transitions.
- **Opportunity sheet** at `/commerce/[id]` with pipeline controls, edit and delete.
- **Opportunity fields** — name, organisation (required), optional contact, estimated amount, expected close date and notes.
- **Task and follow-up integration** — create a task or follow-up directly from an opportunity with the opportunity preselected; linked items are preserved on deletion (`ON DELETE SET NULL`).
- **Organisation integration** — open opportunities listed on the organisation sheet.
- **Workspace isolation** on all opportunity reads, writes and relationships.

Deliberate V0.9 boundaries:

- No deal scoring or probability.
- No forecasting or pipeline revenue projection.
- No marketing automation.
- No invoicing, quoting or ERP integration.
- Commerce does not add a relance or next-action engine; this stays with Tasks and Follow-ups.

---

## Next

Candidates after V0.9, ordered by observed product need rather than by commitment:

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

- Deal scoring, revenue forecasting and pipeline analytics.
- Marketing automation and campaigns.
- Plugin ecosystems.
- Native mobile application.
- Enterprise SSO/SCIM/RBAC.
- AI features that guess what the user should do.

NOD CRM is valuable because its surface stays small.
