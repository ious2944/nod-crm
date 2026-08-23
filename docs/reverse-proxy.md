# Reverse proxy

NOD CRM does not terminate TLS. It expects a reverse proxy in front of it in
production, and none at all in local development.

Samples: [Nginx](../deploy/nginx/), [Caddy](../deploy/caddy/),
[Traefik](../deploy/traefik/). Whatever you use, the rules below are what
matter.

## HTTPS is mandatory

Session cookies are issued with the `Secure` flag when `NODE_ENV=production`.
Browsers will not send them over plain HTTP, so an instance without TLS is
reachable but impossible to log into.

The cookie is also `__Host-` prefixed, which additionally requires `Path=/` and
forbids a `Domain` attribute. It cannot be set by a subdomain or overwritten by
one.

## Set `X-Real-IP`, and only that

NOD CRM reads **`X-Real-IP` only** to identify a client for rate limiting and
logging. Your proxy must set it from the actual peer address.

`X-Forwarded-For` is deliberately ignored. With the usual
`$proxy_add_x_forwarded_for`, the proxy *appends* the real address to whatever
the client sent — so the first element of the list, the one you would be
tempted to read as "the origin", is entirely attacker-controlled. Anyone could
send a different `X-Forwarded-For` on each attempt and get a fresh network
identity, defeating per-IP rate limiting.

If `X-Real-IP` is absent or malformed, NOD CRM uses `null`: per-IP rate limiting
is lost, per-account limiting still applies. Losing a control is better than
trusting a value the client chooses.

IPv6 addresses are aggregated on their first 64 bits, since a provider commonly
hands a whole /64 to one subscriber.

The client IP is used for rate limiting and logging only — **never** for an
authorization decision.

## Do not duplicate security headers

The application emits, on every response:

`Content-Security-Policy` (with a per-request nonce and `strict-dynamic`),
`X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`,
`X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy`, `X-Robots-Tag`.

Pass them through. Adding a second CSP at the proxy does not strengthen
anything: browsers enforce the intersection of all policies, and the usual
result is a blank page nobody can debug.

**HSTS is the exception.** It belongs to the proxy, because only the proxy
knows the request genuinely arrived over TLS:

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

`preload` is omitted from the samples on purpose — submitting to the preload
list commits your entire domain and is slow to undo.

## Do not expose `/api/health`

The health probe runs a database query. The container calls it on its own
loopback interface; the internet does not need a free way to make PostgreSQL
work. The samples return 404 for it — not 403, so the path does not even
announce that it exists.

From the host it stays available:

```bash
curl -s http://127.0.0.1:3000/api/health
```

## Rate limit `/login`

The application already limits login attempts (5 per account and 30 per IP over
15 minutes, in the database). A proxy-level limit sits in front of it and is
cheaper: it rejects before any Argon2id work happens.

The Nginx sample defines a dedicated `limit_req` zone at 10 requests/minute per
IP with a burst of 10 — far above human use, far below automation.

Add [Fail2ban](../deploy/fail2ban/) if you want repeat offenders banned rather
than merely slowed.

## Streaming

NOD CRM streams Server Components. Turn response buffering **off**
(`proxy_buffering off` in Nginx, `flush_interval -1` in Caddy) or the interface
will feel like it hangs and then arrives all at once.

## No WebSocket

NOD CRM opens none in V0.1. The samples deliberately omit `Upgrade` handling:
the usual `$connection_upgrade` variable needs an http-level `map`, your server
may already define one for another service, and a duplicate declaration breaks
`nginx -t` — which blocks every reload, for every site on the machine.

## Checklist

- [ ] TLS terminated, HTTP redirects to HTTPS
- [ ] HSTS set at the proxy
- [ ] `X-Real-IP` set from the peer address
- [ ] Application security headers passed through unmodified
- [ ] `/api/health` not reachable from outside
- [ ] `/login` rate limited
- [ ] Response buffering off
- [ ] Firewall allows 80 and 443 only
- [ ] Application still bound to `127.0.0.1`, database publishing no port
