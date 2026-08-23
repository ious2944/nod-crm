## Context

<!-- What problem does this solve? Link the issue if there is one: Fixes #123 -->

## What changes

<!-- The change itself, in a couple of sentences. What a reviewer should look
     at first. -->

## How it was tested

<!-- Commands you ran, and anything you checked by hand. -->

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run test:integration` (if you touched auth, authorization, the
      database or a Server Action)

## Breaking changes

<!-- Database migration? Changed or removed environment variable? Anything a
     self-hoster must do when updating? Write "none" if there is none. -->

## Screenshots

<!-- Required for any visible UI change. Before/after if you changed something
     that existed. Use demo data only — no real names, no real email
     addresses. -->

## Checklist

- [ ] The change stays within [the project's scope](../CONTRIBUTING.md) — it
      solves a real problem without making NOD CRM harder to understand
- [ ] No secret, personal data or real name in the code, tests or fixtures
- [ ] Any migration is additive, or the destructive part is called out above
- [ ] Documentation updated if behaviour or configuration changed
