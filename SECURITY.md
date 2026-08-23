# Security Policy

## Supported versions

NOD CRM is at V0.1. Only the latest release on the default branch receives
security fixes.

| Version | Supported |
| --- | --- |
| 0.1.x | ✅ |
| < 0.1 | ❌ (no such release) |

Once a fix ships, self-hosted instances have to update themselves — there is no
auto-update, and no telemetry telling us who runs what.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.** A public report
tells every operator of a NOD CRM instance about the flaw at the same time as
it tells the maintainers, and they cannot all patch at once.

Report privately through GitHub:

1. Go to the repository's **Security** tab.
2. Choose **Report a vulnerability** (GitHub private security advisories).
3. Describe the issue, how to reproduce it, and the impact you believe it has.

That channel is private between you and the maintainers, and it exists whether
or not the project has a dedicated security mailbox — which is why it is the
one documented here.

If private advisories are unavailable to you for any reason, open a public
issue titled `Security contact request`, with **no technical detail**, asking
for a private channel.

### What to expect

This is a small project maintained by volunteers, so these are honest
intentions rather than a contractual SLA:

- **Acknowledgement** within 7 days.
- **Initial assessment** — confirmed, needs information, or not a
  vulnerability — within 14 days.
- **Fix and disclosure** coordinated with you. We will credit you in the
  advisory and the changelog unless you ask us not to.

Please give us a reasonable window to ship a fix before publishing. If you hear
nothing after 30 days, you are free to disclose.

### In scope

The application in this repository: authentication, session handling,
authorization and workspace isolation, input validation, the Server Actions,
the admin CLI, the Docker image and the sample deployment configuration.

### Out of scope

- Vulnerabilities in third-party dependencies with no NOD CRM-specific impact —
  report those upstream. If NOD CRM's usage makes an upstream issue exploitable,
  that *is* in scope, so tell us.
- Missing hardening on someone's own instance (no HTTPS, exposed database port,
  weak password policy). See [docs/self-hosting.md](docs/self-hosting.md).
- Findings that require host compromise or physical access.
- Denial of service through raw traffic volume. That is your reverse proxy's
  job, and the sample configuration includes rate limiting.
- Automated scanner output with no demonstrated impact.

## Hardening your instance

The defaults are safe, but a self-hosted application is only as secure as its
deployment. At minimum:

- Serve it over HTTPS behind a reverse proxy. Session cookies are `Secure`, so
  plain HTTP does not work anyway.
- Keep PostgreSQL unpublished. The provided Compose file publishes no database
  port; do not add one.
- Keep the application bound to the loopback interface.
- Generate a real `AUTH_SECRET`. The application refuses the example values in
  production, but generate it properly rather than relying on that check.
- Back up the database and *verify* the backups —
  [docs/backup-restore.md](docs/backup-restore.md) ships a verification mode
  that restores into a throwaway database.
- Keep the image updated.

The full picture — threat model, every control, and an honest list of what is
*not* covered — is in [docs/security-model.md](docs/security-model.md).

## What NOD CRM never logs

No password, password hash, session token, cookie, `Authorization` header or
`DATABASE_URL` is ever written to the logs. Authentication events carry a
masked email and a short IP fingerprint — never a plain address.
