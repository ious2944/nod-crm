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
| `/tasks/workload` | Estimated load per assignee and week |
| `/tasks/forms`, `/tasks/forms/[id]` | Internal request forms |
| `/tasks/settings` | Tags and custom-field library |
| `/tasks/t/[id]` | Direct link to a task (opens its first readable project with the panel) |

Any page can open the right-hand **task panel** with `?task=<id>` (cockpit,
CRM sheets, projects): the store, the panel and the toasts live in the
authenticated layout.

## Where the code lives

| Path | Holds |
| --- | --- |
| `prisma/migrations/20261013120000_work_management` | additive migration + data backfill |
| `src/lib/tasks/types.ts`, `constants.ts` | client-safe types, labels, palettes |
| `src/lib/tasks/access.ts` | **permissions** (workspace, project visibility, roles) |
| `src/lib/tasks/service.ts` | task mutations (create/update/move/delete/duplicate, tags, custom fields, dependencies, followers, time, comments) |
| `src/lib/tasks/project-service.ts` | projects, sections, members, favourites, status updates, templates |
| `src/lib/tasks/settings-service.ts` | tags, custom fields, rules, task templates, forms, saved views, notifications, CSV import, attachments |
| `src/lib/tasks/automations.ts`, `automation-model.ts` | rule engine / rule model |
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
  `task_forms`.

`status = DONE` ⇔ `completed_at IS NOT NULL` is maintained by the service.

### Migration

`npm run db:deploy` applies `20261013120000_work_management`. It is additive:
no table or column is dropped or renamed; only `tasks.due_at NOT NULL` is
relaxed. Backfill: completed tasks become `DONE`; creator and assignee come from
the `Task / CREATE` audit event, or from the only user of single-user
workspaces. Existing tasks keep no project and remain visible to the workspace,
exactly as before.

## Permissions (checked on the server)

- Every query starts from the **session's workspace**; no function accepts a
  workspace from the client. Ids received from the client are re-checked.
- A `WORKSPACE` project is readable by the whole workspace, a `PRIVATE` one by
  its members only — a non-member gets the same 404 as for a missing id.
- Editing project content requires OWNER/EDITOR (or, on a workspace project,
  not being restricted to COMMENTER). Archived projects are read-only.
  Settings, members, archive and delete require ownership.
- A task is visible if it has no project, belongs to a readable project, or the
  user is its assignee/creator/collaborator/follower. Subtasks follow their
  parent. Search, CRM sheets, notifications, attachments and the cockpit apply
  the same rule (`visibleTaskWhere`).
- Attachments: extension allow-list **and** binary signature check, 10 MB,
  opaque server-generated keys, served only by
  `/api/tasks/attachments/[id]` after a read check, with `nosniff`, sandboxed
  CSP and `attachment` disposition (images/PDF inline). Upload checks `Origin`.

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
- **Due reminders**: there is no scheduler in NOD CRM, so the sweep runs lazily
  on activity (at most every 5 minutes per process). Reminders are idempotent
  (`dedupe_key` per task and due date).

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
- The in-project toolbar search matches titles and the first 300 characters of
  descriptions; `/tasks/search` searches full descriptions on the server.
