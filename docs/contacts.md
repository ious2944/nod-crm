# Contacts (V0.2)

Contacts are the CRM's people directory. A contact exists on its own — it does
not need a follow-up, and archiving one never touches the follow-ups attached
to it.

```
/contacts            list, search, three filters, one sort, server pagination
/contacts/[id]       detail sheet + the contact's follow-ups
```

## Where the code lives

| Path | Holds |
| --- | --- |
| `src/lib/contacts/filters.ts` | URL parameters (`q`, `org`, `fu`, `sort`, `page`), parsed and bounded |
| `src/lib/contacts/schemas.ts` | Zod validation, field limits, the identity rule |
| `src/lib/contacts/queries.ts` | reads: list page, detail, organisations, picker |
| `src/lib/contacts/view.ts` | display helpers (name, initials, labels), pure |
| `src/lib/contacts/photo.ts` | image sniffing and limits, pure |
| `src/lib/contacts/photo-store.ts` | upload → object store |
| `src/app/(app)/contacts/actions.ts` | mutations (create, update, archive, restore, search) |
| `src/app/api/contacts/[id]/photo/route.ts` | serves a photo, behind auth |
| `src/lib/storage/` | the object store itself |

## The API, such as it is

NOD CRM has no REST layer: reads are Server Components calling `src/lib/`, and
writes are Server Actions. The Contacts module follows that, so the usual CRUD
endpoints map like this:

| Conventional | Here |
| --- | --- |
| `GET /contacts?search=&organization=&followUpStatus=&sort=&page=` | `/contacts?q=&org=&fu=&sort=&page=` → `listContactsPage` |
| `GET /contacts/:id` | `/contacts/[id]` → `getContactDetail` |
| `POST /contacts` | `createContact` action |
| `PATCH /contacts/:id` | `updateContact` action |
| `DELETE /contacts/:id` | `archiveContact` action (soft) — plus `restoreContact` |

`GET /api/contacts/[id]/photo` is the one real route handler, because a
browser needs a URL to put in `<img src>`.

Page size is 20. Every list read is paginated server-side; nothing loads the
whole directory.

## What makes a contact valid

At least one of **first name, last name, email or organisation**. Phone, job
title and notes identify nobody on their own, so they do not count. One rule,
one sentence, and it keeps the directory free of blank rows without making any
single field mandatory.

Limits: 80 / 80 / 254 / 40 / 120 / 120 / 2000 characters for first name, last
name, email, phone, job title, organisation, notes.

Phone validation is deliberately loose: digits, spaces, `+`, `-`, `.`, `()`
and `/`, with at least four digits. Rejecting a real number for the sake of a
format would be worse than accepting an odd-looking one.

## Archiving, not deleting

`DELETE` archives. `contacts.archived_at` is set, and:

- the contact leaves the list, the search and the follow-up picker;
- its detail sheet stays reachable, so it can be restored;
- **its follow-ups are untouched** — not deleted, not unlinked. The historical
  relation stays readable.

There is no destructive delete in the interface. Removing a contact for good is
a database operation, and the `ON DELETE SET NULL` on `follow_ups.contact_id`
means even that keeps the follow-ups.

## Photos

The rules, in order of application:

1. the announced size must be under 2 MB — a bigger file is refused without
   being read into memory;
2. the **first bytes** decide the format (PNG, JPEG, GIF, WebP). The MIME type
   in the `FormData` and the file name are client-controlled and are ignored.
   SVG is refused: it is an executable document wearing an image's clothes;
3. the storage key is generated server-side — `contacts/<uuid v4>.<ext>`, the
   extension coming from the sniffed format. The original file name is never
   reused, stored, or logged;
4. the bytes go to the object store, then the row is written. If the row fails,
   the orphaned object is removed.

Replacing or removing a photo deletes the previous object, but only **after**
the row is updated — the other order would leave a contact pointing at a file
that no longer exists.

Reading goes through `/api/contacts/[id]/photo`, which re-checks the session
and the workspace exactly like a page does. Photos are not static assets: they
live outside `public/`, and knowing an id is not enough to fetch one. An
unknown id and someone else's id both return the same `404`. The storage key
doubles as the `ETag`, so a browser revalidates cheaply and never shows a stale
image after a change.

### Storage

`src/lib/storage` exposes one interface — `put` / `read` / `remove` — with a
local filesystem implementation. `NOD_UPLOAD_DIR` says where (default
`<project>/var/uploads`; `/app/var/uploads` in Docker, on a named volume).

Keys are validated against `^[a-z][a-z0-9-]{0,31}/[0-9a-f-]{36}\.[a-z0-9]{2,5}$`
before touching the filesystem, and the resolved path is checked to stay under
the root. Path traversal has two independent locks, not one.

Swapping in object storage means writing a second implementation of
`ObjectStore` and changing the last line of `src/lib/storage/index.ts`. No
caller changes.

**Back up `NOD_UPLOAD_DIR` with the database.** A `pg_dump` restored without it
leaves contacts pointing at photos that are gone.

## Follow-up counts, without N+1

The list needs "1 suivi actif" per row. It does **not** query per contact:
`listContactsPage` runs three queries whatever the page size — the page, its
total, and one `GROUP BY (contact_id, status)` restricted to the ids on the
page. `tests/integration/contacts.test.ts` locks this down by asserting that
`followUp.groupBy` is called exactly once and `followUp.findMany` not at all.

## Organisations: a text field, on purpose

`contacts.organization_name` is a string, not a foreign key. A real
`organizations` table implies a module — creation, renaming, merging,
duplicate handling — and V0.2 does not ship one. A half-built table would be
worse than a plain field: it would look authoritative while nothing kept it
consistent.

The upgrade path is short and is not blocked by this choice:

1. create `organizations (id, workspace_id, name, …)`;
2. `INSERT … SELECT DISTINCT organization_name` per workspace;
3. add `contacts.organization_id` (nullable) and backfill it by name;
4. move reads over — `listOrganizationOptions` and the `organization` branch of
   `buildWhere` in `src/lib/contacts/queries.ts` are the only two places that
   know how organisations are stored;
5. drop `organization_name` in a **later** release, once nothing reads it.

Steps 1–4 are additive and reversible. That is the whole point of stopping at
step 0 today.

## What V0.2 deliberately does not do

No CSV import or export, no tags, no activity history, no Gmail or Google
Contacts sync, no deduplication, no bulk actions, no opportunities. The
architecture leaves room for `Organizations` and `Activities` to slot in
between `Contacts` and `Follow-Ups`; nothing here has to be undone first.
