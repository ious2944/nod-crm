# Development

## Setup

```bash
git clone https://github.com/ious2944/nod-crm.git
cd nod-crm
cp .env.example .env          # point DATABASE_URL at your PostgreSQL 16
npm install
npm run db:migrate
npm run dev                   # http://localhost:3000
```

No local PostgreSQL? The development stack gives you one, with hot reload:

```bash
docker compose -f docker-compose.dev.yml up -d
docker compose -f docker-compose.dev.yml exec app npm run db:migrate
```

It is a separate stack from the self-hosted one in `docker-compose.yml`:
different containers, network and volume. The two never share data.

Then create an account — no credentials are seeded:

```bash
npm run workspace:create
npm run user:create
npm run db:seed               # optional demo data
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | development server |
| `npm run build` | production build |
| `npm run start` | production server, after `build` |
| `npm run lint` | ESLint |
| `npm run typecheck` | route type generation + `tsc --noEmit` |
| `npm test` | unit tests (Vitest) |
| `npm run test:integration` | integration tests — needs `TEST_DATABASE_URL` |
| `npm run test:e2e` | full browser journey — needs a running instance |
| `npm run test:e2e:popover` | regression test for the snooze popover |
| `npm run test:cli` | admin CLI in a real pseudo-terminal — needs `python3` |
| `npm run db:generate` | generate the Prisma client |
| `npm run db:migrate` | create and apply a migration (development) |
| `npm run db:deploy` | apply migrations (production) |
| `npm run db:seed` | (re)install the demo data |
| `npm run db:studio` | Prisma Studio |
| `npm run workspace:create` / `workspace:list` | workspace administration |
| `npm run user:create` | create an account, password typed masked |

`npm run dev` and `npm run build` run `prisma generate` first. The client lands
in `src/generated/prisma`, which is not committed — run `npm run db:generate`
once on a fresh clone or `npm test` will fail to import it.

## Layout

```
deploy/                  reverse proxy, Fail2ban and backup samples
docs/                    this documentation
e2e/                     browser journeys (Playwright, no test runner)
prisma/
  schema.prisma          Workspace, User, Session, LoginAttempt, Contact, FollowUp
  migrations/            versioned SQL
  seed.ts                fictional demo data, flagged is_demo
scripts/
  admin.mjs              admin CLI (plain JS: it runs in the production image)
  init-env.sh            generates .env with fresh secrets
src/
  proxy.ts               optimistic session filter + security headers
  app/
    layout.tsx           HTML document, theme, metadata
    page.tsx             redirects to /follow-ups or /login
    login/               login screen, login and logout actions
    (app)/               authenticated group
      follow-ups/
        page.tsx         the board (Server Component)
        actions.ts       Server Actions: creation and quick actions
    api/health/          database-backed health probe
  components/
    app-shell.tsx        sidebar (desktop) / top bar (mobile)
    navigation.ts        CRM modules, including the disabled ones
    follow-ups/          cards, filters, creation dialog, quick actions
  lib/
    auth/                passwords, sessions, DAL, rate limiting, audit log
    config.ts            app name, source URL, time zone
    date.ts              day-level arithmetic, independent of the server clock
    prisma.ts            lazily created Prisma client
    workspace.ts         workspace derived from the session — never from the client
    follow-ups/          domain, filters, view model, queries, schemas
tests/
  unit/                  fast tests, no database
  integration/           auth, authorization, isolation, validation, adversarial
  pty/                   admin CLI in a pseudo-terminal
```

## Architecture rules

Three principles hold the code together. Breaking one is how a security bug
gets in.

**1. Authentication happens in the data access layer.**

`src/proxy.ts` only checks that a session cookie exists, without touching the
database — it runs on every request, including prefetches. The check that
matters is `src/lib/auth/dal.ts`, next to the data. A forged cookie sails past
the proxy and fails there.

A layout does not protect a route on its own: a child page can render without
its parent layout blocking the flow. Pages call `requireUser()`; Server Actions
call `requireActor()`.

**2. The workspace comes from the session, never from the client.**

There is no code path that lets the browser pick its workspace — no URL
parameter, no form field, no header. `src/lib/workspace.ts` is the only place
that resolves it, and the day a user can belong to several workspaces, it is
the only place that changes.

Any identifier that arrives from the client is re-checked against the session's
workspace before it is used. `findFirst({ where: { id, workspaceId } })`, never
`findUnique({ where: { id } })`.

**3. Every mutation authenticates before it reads its inputs.**

```ts
export async function createFollowUp(previous, formData) {
  const workspaceId = await getWorkspaceIdForAction();   // first
  const parsed = createFollowUpSchema.safeParse(…);      // then
```

An action POSTed directly, outside the interface, is rejected before it can
influence anything.

Two supporting conventions:

- **Validate with Zod at the boundary.** Schemas live in `*/schemas.ts`.
  `sanitizeText` strips control characters (including NUL, which PostgreSQL
  rejects and which would otherwise turn any text field into a 500 anyone can
  trigger) and invisible Unicode spaces.
- **Files marked `"use server"` may only export async functions.** Types,
  constants and error classes go in `src/lib/`. `tests/unit/use-server-contract.test.ts`
  enforces it, because the failure mode is a confusing build error much later.

## Where the tests are worth reading

If you are new to the codebase, these describe the intended behaviour better
than any prose:

- `tests/integration/authorization.test.ts` — what an authenticated user may
  not do.
- `tests/integration/workspace-isolation.test.ts` — what one workspace cannot
  see of another.
- `tests/integration/adversarial.test.ts` — rate-limit evasion, header
  spoofing, direct action calls.
- `src/lib/follow-ups/domain.test.ts` — ageing, urgency, allowed transitions.
- `src/lib/date.test.ts` — day-level arithmetic across time zones and DST.

## Conventions

- **Code and inline comments are in French.** Documentation, issues and pull
  requests are in English. Do not mix languages inside one file.
- Comments explain *why*, not *what*.
- No Prettier config: match the surrounding file, and let ESLint decide the
  rest.
- Keep the dependency list short. Ten runtime dependencies is a feature.

See [CONTRIBUTING.md](../CONTRIBUTING.md) before opening a pull request.
