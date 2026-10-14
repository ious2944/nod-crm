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
| `/tasks/trash` | Deleted tasks: restore, permanent deletion |
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
| `src/lib/tasks/types.ts`, `constants.ts` | client-safe types, labels, palettes |
| `src/lib/tasks/access.ts` | **permissions** (workspace, project visibility, roles) |
| `src/lib/tasks/service.ts` | task mutations (create/update/move/delete/duplicate, tags, custom fields, dependencies, followers, time, comments) |
| `src/lib/tasks/project-service.ts` | projects, sections, members, favourites, status updates, templates |
| `src/lib/tasks/settings-service.ts` | tags, custom fields, rules, task templates, forms, saved views, notifications, CSV import, attachments |
| `src/lib/tasks/automations.ts`, `automation-model.ts` | rule engine / rule model |
| `src/lib/tasks/task-reminders.ts`, `jobs.ts`, `scheduler.ts` | scheduled due-date reminders, job lease, in-process timer |
| `src/lib/tasks/{workload,project-stats}.ts` | pure workload and progress computations |
| `src/lib/tasks/notify.ts`, `realtime.ts` | notifications, LISTEN/NOTIFY |
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
  `task_activities.project_id`, `users.weekly_capacity_minutes`.

`status = DONE` ⇔ `completed_at IS NOT NULL` is maintained by the service.
`last_active_status` keeps the status before completion: reopening returns to
it. Deleted tasks keep their row (`deleted_at`, `deleted_by_id`).

### Migration

`npm run db:deploy` applies, in order:

1. `20261013120000_work_management` — additive: no table or column is dropped
   or renamed; only `tasks.due_at NOT NULL` is relaxed. Backfill: completed
   tasks become `DONE` (`completed_at` is explicit data). Nothing else is
   inferred.
2. `20261014090000_work_management_hardening` — additive. For **legacy tasks**
   (rows with no `task_activities`, i.e. created before V1.0):
   - `created_by_id` comes from the earliest `audit_logs` row
     `Task / CREATE` for that task, **only** if its author still exists in the
     same workspace (a deactivated user is kept: it is a historical fact).
     An `UPDATE` author is never taken as creator.
   - **No assignee is ever inferred** — not from the creator, not from an
     editor, not from a single-user workspace. Legacy tasks stay unassigned and
     visible to the workspace, as before.
   - Every legacy task whose assignee or creator is unknown gets a row in
     `task_migration_notes` (`ASSIGNEE_UNKNOWN`, `CREATOR_UNKNOWN`).

Report after deployment (read-only):

```sql
-- Volumes by reason
SELECT reason, count(*) FROM task_migration_notes GROUP BY reason;
-- Tasks to assign by hand, per workspace
SELECT w.slug, t.id, t.title, t.due_at, t.status
  FROM task_migration_notes n
  JOIN tasks t ON t.id = n.task_id
  JOIN workspaces w ON w.id = t.workspace_id
 WHERE n.reason = 'ASSIGNEE_UNKNOWN' AND t.deleted_at IS NULL
 ORDER BY w.slug, t.due_at NULLS LAST;
```

`tests/integration/migration-work-management.test.ts` replays both migrations
on a disposable PostgreSQL schema (never the development or production
database) seeded with several users, a deactivated user, a deleted user,
tasks with and without audit rows, a forged cross-workspace audit row,
completed tasks, a single-user workspace and a task without due date, and
compares rows before/after (volumes, CRM links, dates).

If a database was migrated with an earlier revision of this branch, reset that
development database: the first migration was revised before merge.

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
| delete permanently | owner of **all** its projects; for a task without project, its creator or the person who deleted it |

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
- **Deleting a project** (owner only, explicit confirmation) deletes the tasks
  that belong to no other project permanently: moving them to the trash would
  turn them into project-less tasks visible to the whole workspace.

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
- **Completion**: `DONE` sets `completed_at`; any other status clears it.
  Reopening (cockpit, list checkbox) goes back to `last_active_status`.
- **Approval**: an approval request cannot be completed before it is approved.
  Only its assignee (or, without assignee, a project editor) approves or
  requests changes. Approving completes it; requesting changes on a completed
  request reopens it; setting it back to “pending” resubmits it and notifies the
  approver.
- **Recurrence**: completing a recurring task creates the next occurrence once
  (`recurrence_origin_id` is unique — double clicks or reopen/complete cycles
  never duplicate it), dated by the rule on calendar day keys in
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
- **Real time**: mutations `pg_notify('nod_work', ids)`; each Node process keeps
  one LISTEN connection and fans out to SSE streams (`/api/tasks/stream`),
  filtered by workspace. The message carries ids only; clients re-read through
  the permission-checked routes. Views also refresh when the tab regains focus.
- **Dependencies**: cycles and self-dependencies are refused. The timeline
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
  by a rule appear in the task history with the rule id.
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
  A lease left by a killed process expires after 10 minutes.
- **Resumption**: reserved rows still `PENDING` are processed by the next run;
  a failure is retried up to 5 times, then marked `FAILED` with the error.
- **Stale reminders**: no catch-up. Nothing is planned for past due dates; a
  pending row whose due date has passed, whose due date changed, or whose task
  was completed, deleted or unassigned is marked `SKIPPED` with the reason.
- **Delivery**: in-app notifications only — NOD CRM has no e-mail transport.

Deployment configuration (`.env` / `docker-compose.yml`):

| Variable | Default | Effect |
| --- | --- | --- |
| `NOD_SCHEDULER` | `on` | `off` disables the timer on this instance (e.g. extra instances). Keep it `on` on at least one. |
| `TASK_REMINDER_INTERVAL_MINUTES` | `5` | Period, 1–60. A reminder is late by at most one period. |
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
- The trash has no automatic purge.
