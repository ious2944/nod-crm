# Organizations

NOD CRM V0.5 promotes "organisation" from a free-text field on a contact
to a first-class business object you can navigate to, search, and see
follow-ups and tasks for.

---

## What an organisation is

Name (required), website, email, phone, notes. No industry, no "type",
no pipeline stage. An organisation answers one question: _who are these
people, and what do I need to do with them?_

The five optional fields exist because they are the fields you actually
look up when you are on a call or writing an email. Nothing else.

---

## The `organization_name` text field is kept

Contacts have had an `organization_name` (varchar) column since V0.2.
That column is **not removed in V0.5**, and it never will be — removing
it would silently lose data for any contact that was created before the
migration, or that was imported with a name that does not match any
organisation in the table.

The rule for displaying the organisation name on a contact is:

1. If `organization_id` is set, use `organizations.name` for that id.
2. Otherwise fall back to `contacts.organization_name`.

When a user selects an organisation through the picker, `organization_name`
is automatically synchronised to the organisation's current name so that
the fallback always shows the right thing.

---

## Why there is no composite foreign key

A composite `(contact.workspace_id, contact.organization_id)` →
`(organizations.workspace_id, organizations.id)` FK would guarantee that
a contact can only point to an organisation in the same workspace. The
problem is that PostgreSQL does not allow `ON DELETE SET NULL` on a
composite FK. Since we want deleting an organisation to clear the FK on
all its contacts rather than cascade-delete them, the composite FK is not
available.

The workspace check is therefore **applicative**: every server action that
sets `organization_id` on a contact first runs a `findFirst` that checks
both the id and the `workspaceId`. An archived organisation is treated
like a missing one — the action fails closed.

---

## The migration

`prisma/migrations/20260827000000_organizations_module/migration.sql` does
five things, all additive:

1. **Create `organizations`** — `id`, `workspace_id`, `name`, `website`,
   `phone`, `email`, `notes`, `archived_at`, `created_at`, `updated_at`.
   `workspace_id` has a FK to `workspaces(id) ON DELETE CASCADE`.

2. **Backfill from `organization_name`** — for every distinct
   `(workspace_id, organization_name)` pair found in `contacts` where the
   name is non-empty, an `INSERT … ON CONFLICT DO NOTHING` creates a row in
   `organizations` with a `gen_random_uuid()` id. This is idempotent if run
   twice.

3. **Add `organization_id`** — an `ALTER TABLE contacts ADD COLUMN
   organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL`.
   All existing rows get `NULL`; no data is lost.

4. **Backfill the FK** — for every contact that has a non-empty
   `organization_name`, a `UPDATE contacts SET organization_id = ...` sets
   the FK to the matching organisation (same `workspace_id`, exact name
   match). Non-matching names are left as `NULL`.

5. **Add indexes** — `organizations(workspace_id, archived_at, name)` for
   list queries; `contacts(organization_id)` for the reverse join.

**Nothing is dropped.** `organization_name` stays. The migration can be
applied to a live database without downtime if you are not running
multiple application processes that write contacts concurrently during the
window.

---

## Workspace isolation

All queries in `src/lib/organizations/queries.ts` call
`getWorkspaceIdForPage()` and pass the result as the first WHERE clause.
No function accepts a `workspaceId` argument — the session is the only
source of truth.

For the detail page, `getOrganizationDetail(id)` returns `null` for any
id that does not exist in the current workspace. The page calls
`notFound()` on `null`, so an attacker who guesses a UUID learns nothing
beyond "that id does not exist here".

For writes, `archiveOrganization` and `restoreOrganization` use
`updateMany({ where: { id, workspaceId } })`. If the id belongs to another
workspace, the update silently matches 0 rows — no error, no disclosure.

---

## Contact picker search

`findOrganizations(query)` is a Server Action that calls
`searchOrganizationOptions(query)`. It is used by the `OrganizationPicker`
component in the contact form. It:

- Is scoped to the current workspace's session.
- Excludes archived organisations.
- Returns at most 8 results (the `ORG_PICKER_LIMIT` constant).
- Searches name and website with `ILIKE` (case-insensitive).
- When the query is empty, returns the 8 most recently updated
  organisations so the picker is immediately useful.

---

## What was deliberately left out

- **Contact counts on the list** are computed with a single `GROUP BY`, so
  the list page always runs exactly two queries (count + rows) plus one
  aggregation, regardless of the number of organisations shown. No N+1.

- **Organisation filter on the contact list** still reads from
  `organization_name` (the `listOrganizationOptions` function). This is
  intentional: the filter predates the FK, contacts may still have names
  without FKs, and changing it would be a separate migration. It is not a
  regression.

- **No "mini Salesforce"**: no industry, no annual revenue, no contract
  value, no pipeline stage. If you need those, NOD CRM is not the right
  tool.

- **No tasks directly on an organisation** — tasks are linked to contacts,
  and contacts are linked to organisations. The organisation sheet shows
  open tasks from its contacts. Adding a direct `task.organization_id` would
  create a second data model with its own edge cases and UI surface; the
  indirect path is sufficient.
