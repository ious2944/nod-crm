# Cockpit "Aujourd'hui" (V0.3)

The cockpit is where a session lands. It answers one question:

> What do I have to do now, with whom, and what is about to slip away?

It is not a dashboard. There is no chart, no total, no conversion rate — only
work, ordered.

```
/today            the cockpit: attention counters, priority feed, two side lists
/today?f=late     the same page, feed narrowed to one counter
```

## Where the code lives

| Path | Holds |
| --- | --- |
| `src/lib/cockpit/domain.ts` | prioritisation rules, stagnation, sort orders — pure |
| `src/lib/cockpit/filters.ts` | the `f` URL parameter, and the predicate behind each counter |
| `src/lib/cockpit/view.ts` | the display model handed to components (`CockpitItem`, `ContactRef`) |
| `src/lib/cockpit/queries.ts` | the single read, workspace-scoped |
| `src/components/cockpit/` | one component per zone, none of them holding business logic |
| `src/app/(app)/today/page.tsx` | composition only |

Nothing in `src/lib/cockpit/` writes. Every action taken from the cockpit goes
through the existing Follow-up Server Action
(`src/app/(app)/follow-ups/actions.ts`), so there is exactly one state machine,
one transition guard and one workspace check in the codebase.

## The four counters

Each counter is the size of a filter, not a separate query:

| Counter | Open follow-ups where |
| --- | --- |
| En retard | due date is in the past |
| Aujourd'hui | due date is today |
| À venir | due within the next 7 days |
| Chez eux | the ball is with the other party |

The first three partition time; "chez eux" cuts across them, so a late
follow-up waiting on someone counts in both. That is deliberate — they answer
different questions. Because a counter and its filter share one predicate
(`matchesCockpitFilter`), a counter can never announce 3 and then show 4.

## The priority feed

The feed mixes what matters instead of making the reader walk through several
screens. The order of the buckets is the order of the rules, and a follow-up
lands in the first one that matches:

1. **late** — sorted by the largest overdue first;
2. **today** — the day's work;
3. **stagnant** — the ball is with them and nothing has moved (see below);
4. **upcoming** — due within 7 days, nearest first;
5. **later** — everything else.

**Only the first three appear in the default feed** (`isActionableNow`). The
last two exist so that a follow-up still sorts when an explicit filter calls it
back — the "À venir" counter, for instance.

`upcoming` was dropped from the default feed during the V0.3 UX review: the
"Prochainement" section shows exactly the same seven-day window, on the same
screen, in the same order. On a realistic data set a quarter of the feed was a
re-reading of the column next to it, sitting at the *bottom* of the feed — last
place the eye reaches — for follow-ups that need nothing today. The rule the
feed now follows is one sentence: **it lists what to do now, and nothing else.**

Ties are broken by id, so the order never depends on what PostgreSQL returned
first. The feed is capped at 12 rows and links to the full board past that.

## Stagnation, and what it actually measures

Pipedrive calls it rotting: an item that is not late but has been sitting for
too long. NOD CRM already has the natural signal for it — the ball is with them
and nothing has happened.

**No column was added.** The measure is `now - follow_ups.updated_at`, in
calendar days of `APP_TIME_ZONE`. PostgreSQL rewrites `updated_at` on every
`UPDATE` of the row, and every quick action is an `UPDATE`: nudge, ball
received, ball sent, snooze, complete. So the number dates the last recorded
move on the follow-up — no more, no less. Past 7 days
(`STAGNATION_DAYS`, aligned with `CRITICAL_OVERDUE_DAYS`) the row is flagged
`⚠ Sans mouvement depuis N j`.

### What is honestly missing

This is a **lower bound** on the wait, not the wait itself. A follow-up handed
over thirty days ago and snoozed yesterday reads "sans mouvement depuis 1 j".
The label is worded for exactly what is measured — *movement*, not *silence* —
so the display never claims more than the data supports. It understates; it
never overstates.

The other candidate columns were considered and rejected:

- `last_nudged_at` only dates nudges. A `handoff` after a nudge puts the ball
  back with them without touching it, so it would **overstate** the wait.
- `created_at` only works for a follow-up that has never moved.

Measuring the true "with them since" needs an event the schema does not record:
a `ball_moved_at` column written whenever `ball_owner` changes, or the
follow-up history already listed in the roadmap. Either would make this number
exact, and neither is worth a migration on its own — the history feature will
carry it.

## Time zone

Every day-level comparison goes through `src/lib/date.ts` with
`APP_TIME_ZONE` (`Europe/Paris` in production). "Today" is a Paris day, not a
UTC one: at 00:30 Paris time a follow-up due yesterday reads `J+1`, even though
UTC still says yesterday. The page takes **one** `new Date()` and passes it to
every zone, so two sections rendered across midnight cannot contradict each
other. Boundary cases are covered in `src/lib/cockpit/domain.test.ts`.

## One query

The counters, the feed and both side lists are three readings of the same set
of open follow-ups, so the page issues exactly **one** `SELECT`:

```sql
SELECT ... FROM follow_ups
 WHERE workspace_id = $1 AND status = 'OPEN'
 ORDER BY due_at, created_at
```

plus the contact join. The number of queries does not depend on the number of
rows displayed, nor on the active filter. The existing index
`follow_ups(workspace_id, status, due_at)` covers this exactly — **no index
migration was needed**.

The known limit is the same as the follow-up board's: the whole open set is
loaded into memory. Past roughly 2,000 open follow-ups in one workspace that
becomes the wrong shape, and the fix is the same for both screens — the
paginated board already on the roadmap.

## Workspace isolation

`getCockpit()` takes a filter, never a workspace: the workspace comes from the
session through `getWorkspaceIdForPage()`. There is no signature in
`src/lib/cockpit/` that could express a cross-workspace read.
`tests/integration/cockpit.test.ts` fills every cockpit zone for one workspace
and asserts that the other sees zeros in all of them, under every filter.

## Built to be extended, not to look extensible

No placeholder is rendered. The room is in the structure:

| Coming later | What is already in place |
| --- | --- |
| Global search | `CockpitHeader` takes optional `search` / `actions` nodes; nothing renders until one is passed |
| Contact history | the contact is a `ContactRef`, not a string, and already links to `/contacts/[id]` |
| Organisations | `ContactRef.organizationHref` exists and stays `null` until organisations are entities |
| Notes, GED links | `FollowUpRow` and `CompactFollowUpRow` have a trailing slot that takes a node |
| Automations | every mutation is a Server Action in `follow-ups/actions.ts`; the UI holds none |
| Mirai / AI | `getCockpit()` returns a plain, serialisable model that something else could summarise |
| A new zone | `CockpitSection` gives title, count, "voir tout" and the empty state for free |

## What the cockpit deliberately does not do

- No chart, no KPI, no big decorative number.
- No new business rule: it reuses the Follow-up state machine as it stands.
- No write path of its own.
- No document storage. The GED stays where it is, outside NOD CRM.
