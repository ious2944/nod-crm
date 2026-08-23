# Contributing to NOD CRM

Thank you for being here. Bug reports, documentation fixes and small focused
changes are all genuinely welcome.

## The one rule

**Keep NOD CRM simple.**

A feature is not accepted because another CRM has it. It is accepted when it
solves a real problem *and* leaves the product as easy to understand as it was
before. NOD CRM answers one question — "who should I follow up with today?" —
and every addition has to earn its place against that question.

If you are unsure whether an idea fits, **open an issue before writing code**.
It is much easier to discuss a paragraph than to decline a pull request someone
spent a weekend on.

Things that are deliberately out of scope for a long time: pipelines, deal
scoring, marketing automation, plugin systems, and anything that turns NOD CRM
into a generalist CRM.

## Setup

```bash
# 1. Fork on GitHub, then:
git clone https://github.com/<you>/nod-crm.git
cd nod-crm

# 2. Configure
cp .env.example .env         # point DATABASE_URL at your PostgreSQL 16
npm install

# 3. Database
npm run db:migrate
npm run db:seed              # optional demo data

# 4. First account (interactive)
npm run workspace:create
npm run user:create

# 5. Run
npm run dev                  # http://localhost:3000
```

No PostgreSQL at hand? `docker compose -f docker-compose.dev.yml up -d` gives
you the whole thing with hot reload.

## Working on a change

```bash
git switch -c fix/short-description
```

Before you open a pull request, everything below must pass:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

And, if you touched anything near authentication, authorization, the database
or the Server Actions:

```bash
TEST_DATABASE_URL=postgresql://…/nod_crm_test npm run test:integration
```

That suite **truncates the tables of the database you point it at**. Give it a
dedicated one.

## What we look for in a pull request

- **One change per pull request.** A bug fix and a refactor in the same diff
  take three times as long to review.
- **A test when the change is testable.** Especially for authorization,
  workspace isolation, input validation and date arithmetic — those are where
  a regression is both likely and expensive.
- **No new dependency without a reason.** NOD CRM has ten runtime dependencies.
  That is a feature. If a change needs an eleventh, say why in the description.
- **No secrets, no personal data, no real names** — not in code, not in tests,
  not in fixtures. Use `example.com`, `Alice Martin`, `Acme Corp`.
- **Migrations that do not destroy data.** Adding a column is fine. Dropping or
  renaming one needs an explicit discussion in the issue first: people run this
  in production.

## Conventions

- **Code and inline comments are in French.** That is the existing convention
  and changing it repository-wide is not a good use of a first contribution.
  Do not mix languages inside one file.
- **Documentation, issues and pull requests are in English**, so the project
  stays readable to everyone.
- Comments explain *why*, not *what*. If a line needs a comment to say what it
  does, the line is usually the problem.
- Validate every input with Zod, at the boundary.
- Every mutation authenticates **before** it reads its inputs, and re-checks
  any identifier that came from the client against the session's workspace.
- Formatting follows ESLint and the surrounding file. There is no Prettier
  config — match what is already there.

Commit messages: a short imperative subject, optionally prefixed
(`fix:`, `feat:`, `docs:`, `security:`, `chore:`, `ci:`, `test:`). The body
explains why the change exists. There is no strict convention enforced by a
hook, and no squash policy imposed on you.

## Reporting a bug

Use the issue templates. What actually helps:

- what you expected, and what happened instead;
- the smallest set of steps that reproduces it;
- how you run NOD CRM (Docker Compose, bare Node, behind which proxy);
- relevant logs — **with secrets removed**.

**Found a security problem? Do not open an issue.** Read
[SECURITY.md](SECURITY.md) and report it privately.

## Code of Conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

NOD CRM is [AGPL-3.0-only](LICENSE). By contributing, you agree that your
contribution is licensed under the same terms. There is no CLA.
