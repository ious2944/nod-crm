# Screenshots

This directory is intentionally empty of images.

Rather than ship mockups that do not match what the application actually looks
like, no screenshot is committed until a real one exists. If you run NOD CRM
and want to contribute one, this is what would be useful.

## What to capture

| File | Content |
| --- | --- |
| `board-light.png` | `/follow-ups` with a handful of items across the ageing scale — one overdue, one due today, one upcoming |
| `board-dark.png` | the same view in dark mode |
| `quick-actions.png` | a card with its quick actions open, snooze popover visible |
| `new-follow-up.png` | the creation dialog, with the inline contact creation visible |
| `login.png` | the login screen |

## Rules

- **Use the demo seed** (`npm run db:seed`), never real data. Alice Martin and
  Acme Corp are fictional; your customers are not.
- Check the whole frame before exporting: no real email address, no real
  organisation name, no browser tab or bookmark bar giving away a hostname.
- 1440 × 900 or wider for the board, so the sidebar and the cards both read.
- PNG. Keep each file under 500 KB — this is a repository, not an asset CDN.
- Retake them when the interface changes materially. A stale screenshot is a
  documentation bug.

## Adding one

Drop the file here and reference it from `README.md`:

```markdown
![The follow-up board](docs/screenshots/board-light.png)
```

Then update this table so the next person knows the file exists.
