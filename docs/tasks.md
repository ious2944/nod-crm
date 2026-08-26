# Tasks (V0.4)

**A task is something to do. A follow-up is something to move forward with
someone.**

That one sentence is the whole design. A follow-up has a counterpart, a ball
and a nudge count; a task has none of that. It has a title, a due date, and two
states. Keeping them apart is what stops NOD CRM from turning into a project
management tool.

```
/today        cockpit — everything that needs action now, follow-ups and tasks
/tasks        the task list: overdue, today, upcoming (+ a "Terminées" tab)
```

## Where the code lives

| Path | Holds |
| --- | --- |
| `src/lib/tasks/domain.ts` | timing, buckets, sorting — pure, tested |
| `src/lib/tasks/filters.ts` | the `?f=` parameter (`todo` \| `done`) |
| `src/lib/tasks/schemas.ts` | Zod validation and field limits |
| `src/lib/tasks/queries.ts` | reads: list, actionable tasks, follow-up picker |
| `src/lib/tasks/view.ts` | display shape handed to components, pure |
| `src/lib/today/feed.ts` | merges follow-ups and tasks into one feed, pure |
| `src/lib/today/queries.ts` | the cockpit read |
| `src/app/(app)/tasks/actions.ts` | mutations: create, complete, reopen, snooze |
| `src/components/tasks/` | row, actions, create dialog, follow-up picker |

As everywhere else in NOD CRM there is no REST layer: reads are Server
Components calling `src/lib/`, writes are Server Actions.

| Conventional | Here |
| --- | --- |
| `GET /tasks?state=` | `/tasks?f=todo\|done` → `getTaskList` |
| `POST /tasks` | `createTask` action |
| `POST /tasks/:id/complete` | `applyTaskAction` with `intent=complete` |
| `POST /tasks/:id/snooze` | `applyTaskAction` with `intent=snooze&days=N` |

There is no delete. A task is completed or reopened; nothing is destroyed.

## Two states, and no more

```
completed_at IS NULL      → à faire
completed_at IS NOT NULL  → terminée
```

No `IN_PROGRESS`, no `BLOCKED`, no `CANCELLED`, no P1/P2/P3, no custom
workflow. Three transitions exist — complete, reopen, snooze — and the server
refuses any other, including the ones the interface never offers.

## Due dates

Tasks reuse the follow-up vocabulary rather than inventing one: `J+4`,
`Aujourd'hui`, `Demain`, `Dans 5 j`, coloured by the same six-level ageing
scale and the same design tokens. `dueLabel` and `urgencyLevel` are imported
from `src/lib/follow-ups/domain.ts` — an overdue task and an overdue follow-up
must never drift apart visually. V0.4 adds no colour of its own, so dark mode
follows for free.

Due dates are stored as an instant at local midnight in `APP_TIME_ZONE`, and
all comparisons are calendar-day comparisons — the same convention as
follow-ups.

## What "actionable today" means

A task appears in the `/today` feed when:

```
completed_at IS NULL  AND  due_at <= end of the current day (APP_TIME_ZONE)
```

So: overdue → in the feed; due today → in the feed; due tomorrow → not;
completed → not. The bound is `endOfDay(today)` (`src/lib/date.ts`), not
`new Date()`: a task due today at local midnight must stay actionable all day,
including on a server running in UTC.

Follow-ups use the identical rule (`getActionableFollowUps`), which is the V0.3
`needsAttention` definition moved into the `WHERE` clause.

## Links, and what they do not do

A task may reference a contact, a follow-up, both, or neither.

- **Contact** — context only. It shows the person and links to their sheet. It
  does **not** turn the task into a follow-up: there is no ball, no nudge.
- **Follow-up** — rendered as `Lié à <titre> — <prénom>`.

**No state is ever synchronised.** Completing "Préparer le devis" does not
complete "Envoyer le devis à Camille", and completing the follow-up does not
complete the task. Snoozing one does not move the other. This is enforced by
the actions themselves: `applyTaskAction` never writes to `follow_ups`, and
`applyQuickAction` never writes to `tasks`. Integration tests assert both
directions.

Deleting a follow-up or a contact sets the link to `NULL` and keeps the task.

## Counters

The four V0.3 counters — Ouverts, Chez moi, Chez eux, À relancer — still mean
**follow-ups**, still live on `/follow-ups`, and were not extended to tasks.
Mixing two populations into one number silently would make every one of them
unreadable.

The cockpit shows one count of its own, `cockpitHeadline`, and it is explicitly
the count of *actionable items today, follow-ups and tasks together* — exactly
what the page lists underneath. The task page shows the number of tasks left to
do. Three counters, three stated meanings, no overlap.

## Multi-tenant boundary

Same rules as the rest of the application, no exception:

- the workspace comes from the session (`getWorkspaceIdFor{Page,Action}`), never
  from a form field, a URL parameter or a header — no function in
  `src/lib/tasks/queries.ts` even accepts a `workspaceId` argument;
- every client-supplied id (`contactId`, `followUpId`, the task's own `id`) is
  re-checked against that workspace before use, so a cross-workspace link
  cannot be created and another workspace's task cannot be read or mutated —
  it simply is not found;
- writes go through `updateMany` with the workspace in the `WHERE`, and the
  clause repeats the state read a moment earlier, which makes each transition
  atomic without an explicit transaction;
- the create schema enumerates its fields, so an enriched form cannot set
  `workspace_id`, `completed_at` or `is_demo`.

PostgreSQL cannot enforce the workspace coherence of `contact_id` and
`follow_up_id` on its own here: a composite `(id, workspace_id)` foreign key
would rule out the `ON DELETE SET NULL` that keeps a task alive when its
contact or follow-up disappears. The check therefore lives in the action, and
`tests/integration/workspace-isolation.test.ts` covers it in both directions.

## Deliberately out of scope

Projects, kanban, sub-tasks, dependencies, priorities, tags, multi-user
assignment, comments, attachments, recurrence, notifications, reminders, time
tracking, estimates, a full calendar, drag and drop, and any automatic
Task ↔ Follow-up synchronisation.

Ideas kept for later, not implemented: showing a contact's tasks on their
sheet, and a task count per contact in the directory.
