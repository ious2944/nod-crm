# Screenshots

This directory contains screenshots of the current NOD CRM interface.

Screenshots are intended to show the real product as it exists today — no mockups, no concepts, and no production data.

## Available screenshots

| File | Content | Status |
| --- | --- | --- |
| `board-light.png` | `/follow-ups` main board with demo follow-ups | ✅ Available |
| `board-dark.png` | Main board in dark mode | ⏳ To add |
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

The primary screenshot used in the project README is:

`board-light.png`

It represents the main Follow-Up experience and should remain the best overview of the current application.

It is displayed from the root `README.md` with:

```markdown
![NOD CRM Follow-Up board](docs/screenshots/board-light.png)
