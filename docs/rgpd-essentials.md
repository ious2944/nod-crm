# RGPD Essentials — V0.8

RGPD Essentials is a lightweight privacy-operations module for small teams.

It is deliberately **not** a legal certification product. NOD CRM does not decide whether a processing activity is lawful, whether a transfer is permitted, or whether a breach must be notified. It helps users document those decisions, keep review dates visible and act before deadlines are missed.

## Five building blocks

1. **Treatment register** — purpose, people concerned, data categories, legal basis, retention, recipients, transfers, security measures and review dates.
2. **Processors** — service, location, EEA status, DPA status, subprocessors and review dates.
3. **Data-subject requests** — type, person/contact, received date, due date, status, owner and notes.
4. **Incidents / breaches** — facts, affected data, approximate population, consequences, measures, risk assessment and notification decisions.
5. **Privacy cockpit** — alerts for missing information, overdue reviews, request deadlines and incidents still requiring assessment.

## Product language

The interface uses short explanations rather than legal essays. Examples:

- **Legal basis** — the legal ground documented by the organisation for the treatment.
- **DPA** — the contract framing processing carried out by a provider on the organisation's behalf.
- **Outside EEA** — a flag that prompts the user to document the situation; it is not an automatic legal conclusion.

## Security model

Every privacy record has a mandatory `workspace_id`.

The authorised workspace is derived exclusively from the authenticated server-side session. Client input cannot select a workspace.

Cross-workspace references are checked before writes:

- Treatment → Processor
- Privacy request → Contact

Updates use workspace-scoped predicates so a foreign UUID updates zero rows. Queries always filter by the session workspace.

## Alert model

Alerts are derived from stored data; they are not persisted as a second source of truth.

Examples:

- treatment has no documented legal basis;
- treatment has no retention rule;
- treatment or processor review is overdue;
- processor DPA is missing or needs review;
- processor location / EEA status needs verification;
- data-subject request is due soon or overdue;
- incident is open and still needs risk / notification assessment.

The empty state says **“No attention point detected”**, never “You are GDPR compliant”.

## Deliberate V0.8 exclusions

- DPIA/AIPD builder;
- legal scoring or certification;
- automated SCC analysis;
- cookie consent management;
- legal AI;
- automated breach-notification decision;
- regulatory-watch service.

Keeping those out is intentional: RGPD Essentials should remain understandable to a founder or small-team operator in under a minute.
