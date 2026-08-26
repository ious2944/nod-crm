# Screenshots

This directory contains screenshots of the current NOD CRM interface.

Screenshots are intended to show the real product as it exists today — no mockups, no concepts, and no production data.

## Available screenshots

| File | Content | Status |
| --- | --- | --- |
| `today-light.png` | `/today` — the Aujourd'hui cockpit with demo data | ⏳ To add |
| `today-dark.png` | The cockpit in dark mode | ⏳ To add |
| `board-light.png` | `/follow-ups` list with demo follow-ups | ⚠️ Stale — predates V0.2 |
| `board-dark.png` | The follow-up list in dark mode | ⏳ To add |
| `quick-actions.png` | Follow-up card with quick actions and snooze popover | ⏳ To add |
| `new-follow-up.png` | Follow-up creation dialog with inline contact creation | ⏳ To add |
| `login.png` | Login screen | ⏳ To add |

## Screenshot rules

When adding or replacing a screenshot:

- **Use demo data only.** Never use real contacts, customers, email addresses or organisations.
- Prefer the built-in demo seed when possible.
- Check the entire frame before committing the image.
- Do not expose a production hostname, browser bookmarks, personal information or infrastructure details.
- Use PNG format.
- Prefer 1440 × 900 or wider for the main board so the navigation and follow-up cards remain readable.
- Keep each image under 500 KB when practical.
- Replace screenshots when the interface changes materially.

A stale screenshot should be treated as a documentation bug.

## Main screenshot

The primary screenshot used in the project README is currently:

`board-light.png`

**It is out of date.** It was captured before V0.2 and shows Contacts as
"bientôt" when Contacts is a shipped module, no "Aujourd'hui" entry, and the
old "Follow-up" navigation label. By this file's own rule, that is a
documentation bug.

Since V0.3, the best overview of the application is the **Aujourd'hui** cockpit
(`/today`), which is where a session now lands. `today-light.png` should replace
`board-light.png` as the main README screenshot once captured.

It is displayed from the root `README.md` with:

```markdown
![NOD CRM follow-up list](docs/screenshots/board-light.png)
