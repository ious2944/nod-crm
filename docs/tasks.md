# Tasks & projects (V1.0 — work management)

V0.4 defined a task as *something to do*. V1.0 turns tasks into a complete,
Asana-style work-management module **without creating a second task system**:
the cockpit, the historical task actions, projects, “Mes tâches” and the CRM
sheets all read and write the same rows of the `tasks` table.

A follow-up is still *something to move forward with someone*; tasks and
follow-ups keep independent states.

## Pages

| Path | Content |
| --- | --- |
| `/tasks` | **Mes tâches** — tasks assigned to me across all projects, grouped Overdue / Today / Upcoming / Later / No date |
| `/tasks/projects` | Projects (active, archived, templates) |
| `/tasks/projects/[id]?view=` | `overview`, `list`, `board`, `calendar`, `timeline`, `dashboard` |
| `/tasks/favorites` | Favourite projects (also in the side navigation) |
| `/tasks/notifications` | Inbox (unread/read, archive) and notification preferences |
| `/tasks/search` | Server-side search (title **and** full description) with combinable filters |
| `/tasks/portfolio` | Multi-project overview |
| `/tasks/workload?from=&weeks=` | Remaining estimate per assignee and week, against each person's capacity |
| `/tasks/trash` | Deleted projects and tasks: restore, permanent deletion |
| `/tasks/forms`, `/tasks/forms/[id]` | Internal request forms |
| `/tasks/settings` | Tags and custom-field library |
| `/tasks/t/[id]` | Direct link to a task (opens its first readable project with the panel) |

Any page can open the right-hand **task panel** with `?task=<id>` (cockpit,
CRM sheets, projects): the store, the panel and the toasts live in the
authenticated layout.

## Where the code lives

| Path | Holds |
| --- | --- |
| `prisma/migrations/20261013120000_work_management` | additive migration (status backfill) |
| `prisma/migrations/20261014090000_work_management_hardening` | trash, last active status, project fields, capacity, reminders, leases, legacy-task report |
| `prisma/migrations/20261014091000_work_management_legacy_reconcile` | corrective: undoes the inferred assignees/creators of the first migration |
| `prisma/migrations/20261014092000_project_trash` | project trash |
| `prisma/migrations/20261014093000_project_trash_constraints` | project-trash foreign keys the previous guard could skip |
| `prisma/migrations/20261015090000_legacy_reconcile_unestablished_restore` | corrective: puts back values migration 3 removed without an established origin |
| `prisma/migrations/20261015091000_task_activity_reference` | history lines reference the task they cite (`ref_task_id`) |
| `scripts/migration-check.mjs` | migration-history and structural schema check (isolated reference database), pre-checks of pending migrations, guarded checksum reconciliation |
| `src/lib/tasks/types.ts`, `constants.ts` | client-safe types, labels, palettes |
| `src/lib/tasks/access.ts` | **permissions** (workspace, project visibility, roles) |
| `src/lib/tasks/structure.ts` | workspace **structure lock** shared by every write that changes where a task lives |
| `src/lib/tasks/service.ts` | task mutations (create/update/move/delete/duplicate, tags, custom fields, dependencies, followers, time, comments) |
| `src/lib/tasks/project-service.ts` | projects, sections, members, favourites, status updates, templates |
| `src/lib/tasks/settings-service.ts` | tags, custom fields, rules, task templates, forms, saved views, notifications, CSV import, attachments |
| `src/lib/tasks/automations.ts`, `automation-model.ts` | rule engine / rule model |
| `src/lib/tasks/task-reminders.ts`, `jobs.ts`, `scheduler.ts` | scheduled due-date reminders, job lease, in-process timer |
| `src/lib/tasks/{workload,project-stats}.ts` | pure workload and progress computations |
| `src/lib/tasks/notify.ts`, `realtime.ts`, `realtime-filter.ts` | notifications, LISTEN/NOTIFY, per-subscriber filtering of real-time events |
| `src/lib/tasks/test-hooks.ts` | no-op checkpoints used by the interleaving tests |
| `src/lib/tasks/work-queries.ts`, `serialize.ts` | reads and DTO mapping |
| `src/lib/tasks/{recurrence,graph,query-engine,rich-text,csv,format}.ts` | pure, unit-tested modules |
| `src/app/(app)/tasks/work-actions.ts` | Server Actions (mutations) |
| `src/app/api/tasks/**` | GET route handlers (reads, SSE stream, export) and attachment upload/download |
| `src/components/work/` | the interface |

Reads go through GET route handlers rather than Server Actions because Next
dispatches actions one at a time per client: a background refresh must never
block the user's own edits.

## Data model

- `tasks` gains `status`, `priority`, `assignee_id`, `created_by_id`,
  `parent_id` (one level of subtasks), `start_at`, `due_time`, `is_milestone`,
  `is_approval` / `approval_status`, `recurrence`, `recurrence_origin_id`
  (unique), `estimated_minutes`, `organization_id`, `version`; `due_at` becomes
  optional.
- `projects`, `project_members` (OWNER / EDITOR / COMMENTER),
  `project_sections`, `task_projects` (a task belongs to several projects with
  its own section and position in each), `project_favorites`,
  `project_status_updates`.
- `tags`, `task_tags`, `custom_fields`, `project_custom_fields`,
  `task_custom_field_values`, `task_followers`, `task_dependencies`,
  `task_attachments`, `comments`, `comment_reactions`, `task_activities`,
  `task_time_entries`, `notifications`, `notification_preferences`,
  `saved_views`, `automation_rules`, `automation_runs`, `task_templates`,
  `task_forms`; V1.0 hardening adds `task_reminders`, `job_leases`,
  `task_migration_notes`, `custom_fields.project_id`,
  `task_activities.project_id`, `users.weekly_capacity_minutes`;
  `task_activities.ref_task_id` (task cited by a history line).

`status = DONE` ⇔ `completed_at IS NOT NULL` is maintained by the service.
`last_active_status` keeps the status before completion: reopening returns to
it. Deleted tasks keep their row (`deleted_at`, `deleted_by_id`).

### Migration

`npm run db:deploy` applies, in order:

1. `20261013120000_work_management` — additive DDL (no table or column dropped
   or renamed; only `tasks.due_at NOT NULL` is relaxed). It is kept **exactly as
   first published** (commit `81c4b0c`, SHA-256 `7a410c8d…`), because databases
   may have applied it: it backfills `status` from `completed_at`, and also
   *inferred* creator and assignee from the `Task / CREATE` audit author or the
   single user of a workspace. That inference is undone by migration 3.
2. `20261014090000_work_management_hardening` — additive (trash, last active
   status, project-owned fields, capacity, reminders, leases, legacy-task
   report). Creator from the audit `CREATE` author only when it still belongs
   to the workspace; notes for unknown creators/assignees.
3. `20261014091000_work_management_legacy_reconcile` — corrective, idempotent,
   one atomic block. On **legacy tasks** (created before migration 1 was applied,
   per `_prisma_migrations.finished_at`, and without a V1.0 creation row):
   - an assignee without any `Responsable` history line can only come from the
     old backfill (V0.x had no assignees; V1.0 logs every assignment):
     - task never used since (no history, no comment) → **removed**, noted
       `ASSIGNEE_INFERRED_REVERTED` (previous user in `detail`) and
       `ASSIGNEE_UNKNOWN`;
     - task used since → **kept** and noted `ASSIGNEE_INFERRED_KEPT`: ambiguous,
       for a human to check;
   - an assignment made or changed in V1.0 is **never** touched;
   - a creator not backed by the audit `CREATE` author (single-user rule) gets
     the same treatment (`CREATOR_INFERRED_REVERTED` / `CREATOR_INFERRED_KEPT`);
   - wrong `*_UNKNOWN` notes on V1.0 tasks (subtasks copied without history)
     are removed.
4. `20261014092000_project_trash` — additive (project trash, see below).
5. `20261014093000_project_trash_constraints` — creates the two project-trash
   foreign keys where the previous migration's schema-blind guard skipped them.
   It fails if rows point to a project or user that no longer exists: run
   `migration-check.mjs` first, it lists them (see *Orphan rows* below).
6. `20261015090000_legacy_reconcile_unestablished_restore` — corrective,
   idempotent. Without a `_prisma_migrations` row for migration 1 (manual
   application), migration 3 cannot date V1.0 and treated every task without
   history as legacy — including V1.0 subtasks copied by a duplication or a
   recurrence — and removed their assignee/creator. When the origin of a value
   cannot be established it must not be removed: this migration puts back the
   values migration 3 removed **without an established origin** (all of them
   without Prisma history; with it, only those on tasks created after migration
   1), from the previous value kept in `task_migration_notes.detail`, only if
   the field is still empty and the user still belongs to the workspace. The
   note becomes `ASSIGNEE_ORIGIN_UNKNOWN` / `CREATOR_ORIGIN_UNKNOWN` (value
   kept, to check) and the now-wrong `*_UNKNOWN` note is removed. Migration 3
   itself is unchanged (databases have applied it).
7. `20261015091000_task_activity_reference` — additive: `task_activities.ref_task_id`
   (see *Permissions*, history). Old lines get a reference only when it is
   certain (the blocked task's current dependencies, then a unique exact title
   in the workspace); otherwise it stays empty and the cited title is masked.
   No line is deleted.

No step deletes business data. The only values rewritten are the inferred
assignee/creator values of migration 3 (each recorded with its previous value
and, without an established origin, put back by migration 6) and, on
explicit human action, the orphan references of *Orphan rows*.

#### Upgrade path by initial state

`node scripts/migration-check.mjs` (read-only; also runs in the production
image: `docker compose run --rm app node scripts/migration-check.mjs`) reports
which state a database is in by comparing `_prisma_migrations` with the files:

| State | Recorded checksum of `20261013120000` | Procedure |
| --- | --- | --- |
| **A** — module never applied (e.g. `main`) | none | `npm run db:deploy` |
| **B** — first version applied (`81c4b0c`), or state C already reconciled | `7a410c8d…` (= file) | `npm run db:deploy` |
| **C** — revised version applied (`c199fdd` … `cc1240c`) | `b7fae256…` | reconcile, then `npm run db:deploy` |

Why state C needs a reconciliation: `migrate deploy` silently accepts a modified
migration, but `migrate dev` then demands a **reset** (verified). The revised
file differed from the first one only by comments and two data-backfill
statements — the DDL is byte-for-byte identical (asserted by the test below) —
and migration 3 aligns the data — with one difference: on a legacy task used
since V1.0, an inferred assignee/creator is **kept** in B (`*_INFERRED_KEPT`,
listed for review) while in C it was never set. Procedure, never a reset:

```sh
pg_dump -Fc "$DATABASE_URL" -f before-v1-reconcile.dump   # 1. backup
node scripts/migration-check.mjs                           # 2. must say « État C » (exit code 3)
node scripts/migration-check.mjs --reconcile               # 3. guarded rewrite of the checksum
npm run db:deploy                                          # 4. applies every pending migration (from 3 on)
node scripts/migration-check.mjs                           # 5. no « ≠ » line left, exit code 0
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
                                                           # 6. must print an empty migration
```

**Schema check** (both modes). A correct name does not prove a correct
definition, so the expected schema is **rebuilt**: the files of every migration
recorded as applied — including those after `20261013120000` — are replayed, in
order, into an **isolated reference database**, then the two PostgreSQL
catalogues are compared item by item. A separate database is required: a
migration that looks the catalogue up without filtering by schema (the guard of
`20261014092000`) would, inside the same database, see the real schema's
objects and rebuild a different schema — false divergences that blocked the
procedure on databases with `20261014092000` applied and `20261014093000`
pending.

| Compared | Source | Covers |
| --- | --- | --- |
| enums | `pg_enum` (ordered by `enumsortorder`) | names and values, in order |
| columns | `format_type`, `attnotnull`, `pg_get_expr(adbin)`, `attidentity`, `attgenerated` | exact type, nullability, default, identity/generated — including changes a migration makes to existing columns (`due_at DROP NOT NULL`) |
| constraints | `pg_get_constraintdef` | primary keys, unique, foreign keys (tables, columns, `ON DELETE` / `ON UPDATE`), checks |
| indexes | `pg_get_indexdef` | columns and order, uniqueness, method, predicate |

Not compared: collations, views, triggers, functions, sequence properties,
extensions, comments, grants and owners.

Each object missing, extra or different is reported with the expected and the
found value (e.g. `colonne projects.color : type attendu « text », trouvé
« character varying(64) »`). Nothing is written to the checked database. The
two foreign keys that the guard of `20261014092000` may have skipped are
reported as « créée par 20261014093000 (en attente) » and do not block while
that migration is pending.

Reference database — configuration and permissions:

| Mode | Configuration | Permissions | Clean-up |
| --- | --- | --- | --- |
| automatic (default) | none: `nod_check_<random>` is created on the same server (`TEMPLATE template0`, same encoding and locale as the checked database) | **`CREATEDB`** for the role of `DATABASE_URL` | dropped at the end, also on error; a database left by a killed run (marked by a comment naming the checked database and schema) is dropped by the next check of the same database |
| dedicated | `SHADOW_DATABASE_URL=postgresql://…/nod_shadow` — an **empty** database (no table, no type), refused otherwise | `CONNECT`, and `CREATE`/`USAGE` on its `public` schema | the replay runs in a transaction that is rolled back: it stays empty |

Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | compliant: nothing blocks `npm run db:deploy` (pending migrations are listed), or reconciliation done |
| 1 | do not deploy: inconsistent history, schema divergence, unrecognised checksum, or reconciliation refused |
| 2 | check impossible: no `DATABASE_URL`, database unreachable, Prisma lock held longer than `MIGRATION_CHECK_LOCK_TIMEOUT` (60 s by default), reference database impossible to create or not empty |
| 3 | action required before `db:deploy`: state C to reconcile (`--reconcile`), or orphan rows blocking `20261014093000` |

**Orphan rows.** Where the guard of `20261014092000` skipped its foreign keys,
a hard delete could leave `tasks.deleted_with_project_id` or
`projects.deleted_by_id` pointing to nothing; `20261014093000` then fails.
Before deploying, the check lists them (ids and dangling values, exit code 3)
and prints the recovery; it never changes them itself. Recovery, without reset
or deletion:

1. check the listed rows — the value points to a project/user that no longer
   exists;
2. set it to `NULL` with the printed `UPDATE` (what the `ON DELETE SET NULL`
   key would have done);
3. if `20261014093000` already failed: `npx prisma migrate resolve --rolled-back 20261014093000_project_trash_constraints`;
4. `npm run db:deploy`, then the check again (exit code 0).

**History check.** Refused: a migration started but neither finished nor
rolled back, a migration rolled back and not re-applied, a recorded migration
missing from the repository, a migration applied twice, a gap (a migration
applied while an earlier one is not), any checksum divergence other than the
known revised `20261013120000`.

`--reconcile` writes **only** if, within **one transaction** holding Prisma
Migrate's advisory lock (`pg_advisory_xact_lock(72707369)`, the key used by
`migrate deploy` in Prisma 7 — so neither can run during the other) and a
`SHARE ROW EXCLUSIVE` lock on `_prisma_migrations`: the history is consistent,
the state is exactly C, the file on disk is the original and the schema
matches the rebuilt one. It then updates that single
`_prisma_migrations.checksum` and nothing else (no business data); otherwise it
exits with code 1, the precise diagnostic, and writes nothing.

Report after deployment (read-only):

```sql
-- Volumes by reason
SELECT reason, count(*) FROM task_migration_notes GROUP BY reason;
-- Ambiguous inferred assignments kept: to confirm or change by hand
SELECT w.slug, t.id, t.title, n.reason, n.detail AS inferred_user
  FROM task_migration_notes n JOIN tasks t ON t.id = n.task_id JOIN workspaces w ON w.id = t.workspace_id
 WHERE n.reason LIKE '%_INFERRED_KEPT' ORDER BY w.slug, t.title;
-- Tasks still to assign
SELECT w.slug, t.id, t.title, t.due_at, t.status
  FROM task_migration_notes n JOIN tasks t ON t.id = n.task_id JOIN workspaces w ON w.id = t.workspace_id
 WHERE n.reason = 'ASSIGNEE_UNKNOWN' AND t.assignee_id IS NULL AND t.deleted_at IS NULL
 ORDER BY w.slug, t.due_at NULLS LAST;
```

Verification:

- `tests/integration/migration-work-management.test.ts` replays states A, B and
  C on disposable PostgreSQL schemas (never the development or production
  database), recording `_prisma_migrations` like Prisma: several users, a
  deactivated user, a deleted user, tasks with and without audit rows, a forged
  cross-workspace audit row, completed tasks, single-user workspaces, a task
  without due date, V1.0 usage (reassignment, edit, comment, new tasks and
  copied subtasks). It compares rows before/after (volumes, CRM links, dates,
  audit log), checks every assignee/creator decision and note, re-runs the
  corrective migrations (no change, no duplicate) and exercises
  `migration-check.mjs`: states, reconciliation, and refusals with an
  unchanged checksum and unchanged business data for definitions that keep the
  right name but are wrong — column type, nullability (including a column the
  migration altered), default, enum values, index columns/order, index
  predicate, index uniqueness, foreign-key `ON DELETE`, foreign-key definition,
  primary key — plus a renamed index, an unfinished migration, an unknown
  migration, a rolled-back one, and waiting on a concurrent Prisma lock. It
  also covers: no false divergence with `20261014092000` applied and
  `20261014093000` pending (the c580137 script reported two), keys skipped by
  the guard reported as pending, `SHADOW_DATABASE_URL` used and left empty (a
  non-empty one refused), the orphan-row diagnostic and the full recovery
  (failed deployment, printed fixes, `resolve --rolled-back`, deployment,
  rows kept), an application without Prisma history (migration 3 alone removes
  the values of a copied subtask; migration 6 puts them back and flags them),
  and the reference backfill of migration 7.
- The same three paths were also run with the real Prisma CLI on disposable
  databases (`main` → state → current tree): `migrate deploy`, `migrate status`
  “up to date”, `migrate diff` empty, `migrate dev --create-only` without reset.

## Permissions (checked on the server)

Every query starts from the **session's workspace**; no function accepts a
workspace from the client, and ids received from the client are re-checked.
The rules live in `src/lib/tasks/access.ts` and are applied in the database
query itself (`visibleTaskWhere`), so an unauthorised row is never read.

**Projects.** A `WORKSPACE` project is readable by the whole workspace, a
`PRIVATE` one by its members only — a non-member gets the same 404 as for a
missing id. Editing project content requires OWNER/EDITOR (or, on a workspace
project, not being restricted to COMMENTER). Archived projects are read-only.
Settings, members, archive and delete require ownership.

**Tasks.** A task outside the trash is *visible* if it has no project (shared
by the workspace, as in V0.4), belongs to at least one readable project, or the
user is its assignee, creator, collaborator or follower. A subtask is visible
if it is visible itself on those grounds or its parent is.

| Right on a visible task | Who |
| --- | --- |
| read, comment | anyone who sees it |
| edit fields (title, dates, status, description, tags, time, files…) | an editor of one of its projects; its assignee, creator or collaborator; anyone for a task without project |
| **manage**: reassign, add collaborators/followers other than oneself, add to / remove from a project, change parent, duplicate, delete | an editor of one of its projects; anyone for a task without project |
| restore from trash | same as manage |
| delete permanently | owner of **all** its projects, **including those in the trash** (their owner must find the task if they restore them); for a task without project, its creator or the person who deleted it |

A task whose projects are **all** in the trash is visible to nobody, not even
its assignee: it follows its projects and comes back with them. (No operation
produces this state any more — see *Task lifecycle* — but older data may.)

What this means for each role (covered by `tests/integration/work-permissions.test.ts`):

- **Non-member assignee** of a task in a private project: sees and edits *that
  task*, its subtasks, comments, files and its own time entries; does **not**
  see the project's name, sections, other tasks, project-owned custom fields
  and their values, nor history lines tied to the project (section moves,
  project added/removed, project-field values). They cannot reassign, share,
  move or delete it: being assigned never lets someone widen access.
- **Commenter**: reads every task of the project, comments; edits nothing
  (unless they are also the assignee/creator of a task).
- **Member of only one of a task's projects**: sees the task through that
  project; the other project's membership, name, fields, values and history
  are hidden.
- **No access**: nothing — detail, search, CRM sheets, attachments, exports,
  notifications and comments all answer “not found”.

Side doors are closed the same way:

- **Mentions** only notify and subscribe people who can already read the task.
- **Notifications** are created only for readers, and hidden from the inbox if
  access is later lost (task deleted, removed from a project…).
- **Search** filtered by project only accepts readable projects; the
  dependency ids, parent reference and subtasks shown in a detail are filtered
  by visibility.
- **Exports** reuse the permission-checked reads.
- **CRM records** (contacts, organisations, opportunities) have no per-user
  permissions in NOD CRM: every workspace user can open them. A task shows the
  label of its linked record; it grants nothing more. CRM sheets list only the
  linked tasks the reader may see.
- **Custom fields**: library fields are shared by the workspace and enabled per
  project — a task has **one value per field**, whatever the number of its
  projects. A field created from a project belongs to it: only that project can
  enable it, values can be set only on that project's tasks by someone who can
  read it, and its definition is edited with that project's edit rights.
- **Attachments**: extension allow-list **and** binary signature check, 10 MB,
  opaque server-generated keys, served only by `/api/tasks/attachments/[id]`
  after a read check, with `nosniff`, sandboxed CSP and `attachment`
  disposition (images/PDF inline). Upload checks `Origin`.
- **Project trash** (see *Task lifecycle*): a deleted project and the tasks
  deleted with it are readable by nobody; only the project owner sees it in the
  trash. A task never becomes “project-less” (workspace-visible) because its
  projects were deleted, removed or purged.
- **History lines citing another task** (dependency added/removed, source of a
  copy) reference it (`ref_task_id`): its title is shown only to people who can
  read it; others see « (tâche non accessible) ». Old lines without a certain
  reference keep their label without the title.
- **Status-update comments**: editing or deleting one requires reading the
  project *now*, even for its author.
- **Real-time stream** (`/api/tasks/stream`): each subscriber receives only the
  ids of tasks it can read (or that belong to a project it can see — a deleted
  or moved task must leave its views) and of projects open to the workspace or
  where it is a member; an event about invisible items only is not sent.
- **Quick actions** (`/today`, CRM sheets) answer « Tâche introuvable. » for a
  task that does not exist and for one the user cannot read, whatever its
  state.

**Rules.** A rule runs with the **current** rights of the person who saved it
last (created or modified, `automation_rules.created_by_id`), never more:

- it runs only on tasks that person can edit; every action is then checked as
  if that person did it by hand (reassigning needs the manage right, moving to
  a section needs edit rights on that project, etc.);
- a project rule acts only on that project's tasks, and only while that person
  can edit the project's content;
- if that person is deactivated or deleted, the rule does nothing;
- a task that person cannot edit is skipped **without a run row**; the run log
  of a project's settings is in addition filtered to tasks the viewer can read.

Managing rules (there is no administrator role in NOD CRM): a project rule is
created, modified or deleted by anyone who can edit the project's content —
saving it makes it run with their rights. Anyone in the workspace can create a
workspace rule (it acts only with their own rights), but only the person who
saved it can modify or delete it; when that person is deactivated or deleted,
the rule is inert and any member can take it over (saving it) or delete it.

**Templates.** Using a task template that belongs to a project requires
reading that project; modifying it requires editing it — checked on the
**stored** template first, then on the project it is moved to; an unknown or
unreadable template answers « Modèle introuvable » / not found. Workspace
templates stay editable by the workspace. Saving a task as a template skips
its deleted subtasks.

**Copies.** Duplicating a task requires managing it; the copy joins only the
active projects the person can edit (deleted, read-only and unreadable projects
are skipped, with the values of their own custom fields) and never becomes
project-less. Duplicating a project does not modify the source, so reading it
is enough — a **commenter may duplicate** a project they can read, and becomes
owner of the copy, which contains only what they can read: never a task or
subtask from the trash, nor values of fields owned by another project. Copied
rules run with the duplicator's rights.

### Cockpit `/today`

The cockpit reads through the same `visibleTaskWhere` (plus “not in the trash”,
“not a template”). Scope, in the URL (`?t=`), next to the attention filter:

- **Toutes les tâches accessibles** (default — historical behaviour: before
  V1.0 every task of the workspace was shown) — includes colleagues' tasks the
  user may read; rows show “Responsable : …” when it is someone else;
- **Mes tâches** (`?t=mine`) — tasks assigned to the user.

## Task lifecycle

- **Sections**: deleting a section moves all its tasks to a chosen section or
  to « Sans section », in their current order; no task is deleted.
- **Trash**: deleting a task (and the subtasks still active) sets `deleted_at`;
  comments, files and history stay. Restoring brings back the subtasks deleted
  with it (same timestamp), not those deleted earlier.
- **Project trash**: deleting a project (owner) sets `projects.deleted_at`; it
  disappears from every view, search, CRM sheet, notification and context.
  Sections, members, fields, rules, forms and `task_projects` rows are kept.
  - Its **exclusive** tasks (no other *active* project) and their active
    subtasks go to the trash with it (`tasks.deleted_with_project_id`), with
    comments, files, field values, history and CRM links untouched. They are
    not listed in the task trash (they come back with the project) and nobody
    can open them.
  - Tasks also in another active project stay available there; the deleted
    project's membership is hidden but kept.
  - Rules of a deleted project no longer run, and reminders ignore its
    inactive tasks.
  - **Restore** (owner): the project, its sections and memberships return; the
    tasks deleted with it come back (and tasks made inactive by the deletion of
    another project that also belong to it). Tasks or subtasks deleted
    individually before it stay in the task trash.
  - **Delete permanently** (owner, separate action from the trash): erases the
    project and the tasks belonging to no other kept project (active or in the
    trash), including those deleted individually before. A task still linked to
    another kept project is never erased; if that project is in the trash, the
    task follows it. An active task whose other projects are all in the trash
    follows them to the trash; an active task with no other project (older
    data) is erased with the project — it never becomes project-less.
  - **Removing a task from a project** is refused when it would leave the task
    only in projects of the trash (delete it instead, or restore the other
    project first), and when the project is its only one and is private
    (without a project it would be visible to the whole workspace).
  - **Changing parent**: a task becomes a subtask only if it does not belong
    to a project of the trash and if this does not open it to new people (a
    task of a private project, in no workspace project, can go only under a
    parent in the same projects). A subtask converted into a task joins its
    former parent's active projects, so its visibility is unchanged.
  - **Confirmation**: the dialog shows the scope computed by the server
    (`previewProjectPurgeAction`): project name; main tasks and subtasks to be
    erased, and how many of them had been deleted individually before; shared
    tasks kept; comments, attachments and history entries erased with them;
    and that the action is irreversible. The button stays disabled until an
    explicit checkbox is ticked. The preview carries a token (SHA-256 of the
    exact set of task ids erased, of the tasks kept **with their destination**
    — restored, following another trashed project, unchanged — and of the
    announced volumes). On confirmation the server takes the structure lock,
    locks the project row and the affected tasks (`FOR UPDATE`, ordered by id),
    **recomputes** the scope and compares tokens: if it changed (a task
    restored, linked to or unlinked from another project, another project
    purged…), nothing is erased and the new scope is returned; the dialog shows
    it with a warning and requires a new confirmation.
- **Completion**: `DONE` sets `completed_at`; any other status clears it.
  Reopening (cockpit, list checkbox) goes back to `last_active_status`.
- **Approval**: an approval request cannot be completed before it is approved.
  Only its assignee (or, without assignee, a project editor) approves or
  requests changes. Approving completes it; requesting changes on a completed
  request reopens it; setting it back to “pending” resubmits it and notifies the
  approver.
- **Recurrence**: completing a recurring task creates the next occurrence once,
  **in the same transaction** as the completion — a crash or an error never
  leaves a completed task without its next occurrence (`recurrence_origin_id`
  is unique — double clicks or reopen/complete cycles never duplicate it),
  dated by the rule on calendar day keys in
  `APP_TIME_ZONE`, with status `TODO`, no time spent and fresh history; the
  completed occurrence keeps its time entries and history (`recurrence_spawned`).
- **Progress** counts top-level tasks outside the trash (subtasks have no
  project membership and are never counted twice).
- **Workload**: open, assigned tasks; the remaining estimate (estimate − time
  spent) is spread over the working days between start and due date; only the
  part inside the chosen period counts; overdue work is shown apart; tasks
  without date or without estimate are listed separately and never summed.
  Capacity is per user (`users.weekly_capacity_minutes`, set by each user on the
  page), 35 h by default.
- **Project and « Mes tâches » search** filter locally on the title and the
  first 300 characters, and ask the server (`/api/tasks/search?idsOnly=1`) for
  matches anywhere in the full description.

## Reliability

- **Optimistic UI with rollback**: every edit is applied immediately, then
  replaced by the server version; on failure the previous state is restored and
  the error shown.
- **Concurrent edits**: writes are compare-and-set on `version`, and the client
  sends the value it saw for each changed field. If *that field* changed in the
  meantime the server answers `CONFLICT` with the current task instead of
  overwriting; edits to other fields go through.
- **Structure lock** (`src/lib/tasks/structure.ts`): every write that changes
  where a task lives — creation in a project or under a parent, adding to /
  removing from a project, moving, changing parent, dependencies, deleting,
  restoring and purging tasks or projects, duplicating, creating from a
  template, next occurrence — runs in a transaction that first takes a
  per-workspace advisory lock (`pg_advisory_xact_lock`), then **re-reads and
  re-checks** what it depends on, then writes. Lock order is the same
  everywhere: this lock, then rows (project, then tasks by id). Two such writes
  of a workspace never interleave and cannot deadlock each other (two
  simultaneous purges deadlocked in c580137). These transactions may last up
  to 20 s (lock wait included). Interleavings are tested with checkpoints
  (`tests/integration/interleave.ts`): one operation is paused between its
  check and its write while the other starts — concurrent deletion of two
  projects sharing a task, removal or creation during a project deletion,
  purge during a restore, reverse dependencies, parent change during a subtask
  creation.
- **Real time**: mutations `pg_notify('nod_work', ids)`; each Node process keeps
  one LISTEN connection and fans out to SSE streams (`/api/tasks/stream`),
  filtered by workspace **and by what each subscriber can see**
  (`realtime-filter.ts`, see *Permissions*). The message carries ids only;
  clients re-read through the permission-checked routes. Views also refresh
  when the tab regains focus.
- **Tags**: the client sends the tags it saw; the server applies only the
  difference to the current set, under a row lock — a late save never removes
  a tag added meanwhile (by someone else or a rule).
- **Dependencies**: cycles and self-dependencies are refused, the check and the
  write being atomic under the structure lock. The timeline
  flags blocked tasks and date conflicts; dependants are shifted only when
  “Décaler les tâches dépendantes” is ticked.
- **Recurrence**: computed on calendar day keys in `APP_TIME_ZONE` (DST-safe);
  completing a recurring task creates the next occurrence once —
  `recurrence_origin_id` is unique, so double clicks or reopen/complete cycles
  never duplicate it.
- **Rules**: `trigger → conditions → actions`, persisted; each execution is
  recorded in `automation_runs` (success / skipped / error); `(rule_id,
  event_key)` is unique so one event never runs a rule twice; chains carry the
  rules already applied and a depth limit (3), so rules cannot loop. Changes made
  by a rule appear in the task history with the rule id. Rules act with the
  rights of the person who saved them (see *Permissions*).
- **Volume**: copying a project and restoring one write in batches (a few
  queries whatever the number of tasks). Measured on the test database (1 000
  → 8 000 tasks, 30 % with a subtask): duplication 1.5 s at 2 500 tasks and
  4.4 s at 8 000; restoration 0.4 s / 1.7 s; purge 0.9 s / 8.0 s — c580137
  failed the duplication of 2 500 tasks on Prisma's default 5 s limit.
- **Due reminders**: see below.

## Scheduled due-date reminders

`src/lib/tasks/task-reminders.ts`, started by `src/instrumentation.ts` when the
Node server boots (`next start`, also `next dev`). It needs no request and no
logged-in user.

- **What**: a built-in reminder to the assignee (the day before the due date,
  or on the day if the day before was missed) and the
  `DUE_DATE_APPROACHING` rules (“N days before”).
- **Time zone**: “today” is computed in `APP_TIME_ZONE`, the zone the due dates
  are stored in — never the server's zone. There is no per-user time zone in
  NOD CRM.
- **One deduplication for both**: each due reminder first gets a row in
  `task_reminders` with a unique key — `builtin:<task>:<due>` or
  `rule:<rule>:<task>:<due>`. The same key is the notification's `dedupe_key`
  and the rule run's `event_key` (`automation_runs`), so a reminder is never sent
  twice, whatever the number of runs, instances or retries.
- **Simultaneous runs**: a lease row in `job_leases` (atomic conditional update)
  lets a single run through; others return immediately (`skipped: "locked"`).
- **Stale holder**: the lease is extended before **every** delivery; a process
  that lost it (suspended longer than the lease, taken over meanwhile) stops at
  once (`lostLease`) and never releases a lease that is no longer its own. A row
  is validated only if it is still `PENDING`. Prisma runs each write in its own
  transaction (BEGIN / statement / COMMIT): a process frozen between two would
  hold row locks, so every application connection sets
  `idle_in_transaction_session_timeout = 30 s` and PostgreSQL evicts it.
- **Resumption**: reserved rows still `PENDING` are processed by the next run;
  a failure is retried up to 5 times, then marked `FAILED` with the error. A
  crash between creating a notification and validating its row re-delivers
  the row, and the `dedupe_key` prevents a second notification. A rule run
  interrupted inside its actions is not replayed (rule actions are not all
  idempotent): it is marked `ERROR` (“interrompue”) and the reminder `SKIPPED`.
- **Recovery delay** after a crash *during* a run: at most the lease
  (`TASK_REMINDER_LEASE_SECONDS`, 600 s by default) plus one period. A crash
  between runs holds no lease: the next tick of another instance proceeds.
  Measured with two `next start` servers (lease 30 s, period 1 min): reminder
  sent by the survivor 52 s after `kill -9` of the holder.
- **Reminders that became old during an outage**: nothing is caught up. On
  restart, reminders are planned for tasks due today or tomorrow only: a missed
  “day before” reminder is replaced by the “due today” one; if the due date
  itself passed during the outage, no reminder is sent, and rows reserved before
  the outage are marked `SKIPPED` (“Échéance dépassée : rappel trop ancien.”).
- **Stale reminders**: no catch-up. Nothing is planned for past due dates; a
  pending row whose due date has passed, whose due date changed, or whose task
  was completed, deleted or unassigned is marked `SKIPPED` with the reason.
- **Delivery**: in-app notifications only — NOD CRM has no e-mail transport.

Deployment configuration (`.env` / `docker-compose.yml`):

| Variable | Default | Effect |
| --- | --- | --- |
| `NOD_SCHEDULER` | `on` | `off` disables the timer on this instance (e.g. extra instances). Keep it `on` on at least one. |
| `TASK_REMINDER_INTERVAL_MINUTES` | `5` | Period, 1–60. A reminder is late by at most one period. |
| `TASK_REMINDER_LEASE_SECONDS` | `600` | Lease duration, 30–3600: the takeover delay after a crash during a run. Must exceed the longest run. |
| `APP_TIME_ZONE` | `Europe/Paris` | Day boundaries for “today / tomorrow”. |

Monitoring: `SELECT * FROM job_leases;` shows the last run (status and
counters); `SELECT status, count(*) FROM task_reminders GROUP BY status;` shows
pending / sent / skipped / failed reminders. Logs: `[scheduler] …`.

## Notifications

Assignment, mentions, comments on followed tasks, completion, due-date and
status changes, approvals, project status updates, project membership, rule
messages and form submissions. Each type can be disabled per user. Recipients
must be active members of the workspace **and** able to read the task.

E-mail: NOD CRM has no mail infrastructure, so notifications are in-app only;
`notify()` is the single place where a transport would be plugged in.

## CRM integration

Tasks and projects can be linked to a contact, an organisation or an
opportunity. Their sheets embed `LinkedWork`: the same task rows (completing one
there completes it everywhere), the linked projects, quick creation pre-linked
to the sheet. An organisation also shows tasks of its contacts and
opportunities.

## Known limits

- Subtasks are one level deep.
- Lists render 150 rows per section with “show more” and
  `content-visibility: auto`, not full virtualisation.
- Column widths and view preferences are stored per device (`localStorage`);
  saved views are stored on the server.
- Search uses `ILIKE` (no full-text or trigram index); accents are folded on
  the client-side match only.
- Reminders run in the application process: with `NOD_SCHEDULER=off` on every
  instance, none is sent. Lease timestamps come from the application clock
  (keep instances NTP-synchronised).
- There is no per-user time zone: every day boundary uses `APP_TIME_ZONE`.
- Workload capacity is a weekly figure per user, set by the user; no holidays
  or part-time calendar.
- Notifications are in-app only (no e-mail transport).
- The trash (tasks and projects) has no automatic purge.
- A rule run interrupted by a crash is reported, not replayed.
- Structure writes of a workspace are serialised: a very large purge (8 000
  tasks: 8 s) delays other structural edits of the same workspace meanwhile; a
  transaction longer than 20 s fails without writing anything.
- A task made project-less by c580137 (removal then purge) cannot be detected
  afterwards: its memberships are gone. Tasks left active in projects of the
  trash only are protected (invisible) and handled by the purge.
- A history line written before `20261015091000` whose cited task cannot be
  identified with certainty keeps its label without the title.
