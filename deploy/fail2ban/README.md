# Fail2ban and NOD CRM

Fail2ban is **optional**. NOD CRM already rate-limits logins in the application
(5 failures per account and 30 per IP over 15 minutes, stored in PostgreSQL),
and the sample Nginx configuration adds a network-level limit on `/login`.
Fail2ban is the third layer: it bans the address instead of just refusing the
request.

Everything here is **additive**. No existing jail is redefined, widened, or
weakened.

## What already works with the Nginx sample alone

`deploy/nginx/nod-crm-limits.conf` makes Nginx write
`limiting requests, excess: …` to the virtual host's error log when an IP
exceeds the quota on `/login`. That is exactly what the stock
`nginx-limit-req` jail detects — provided it watches the right file:

```bash
sudo fail2ban-client get nginx-limit-req logpath
```

If it only watches specific paths rather than `/var/log/nginx/*.log`, add the
NOD CRM log **without removing the others**:

```bash
sudo fail2ban-client set nginx-limit-req addlogpath \
     /var/log/nginx/crm.example.com.error.log
```

Make it permanent in `/etc/fail2ban/jail.d/`, not in `jail.conf`. The
`nod-crm-limit-req` jail in `nod-crm.local` does this for you as a separate
jail, which is safer than editing the stock one.

## Optional jail: bursts of POST /login

`nginx-limit-req` only fires past the Nginx quota. The jail below catches a
quieter pattern upstream of it: many form submissions from one IP, staying
under the `limit_req` threshold.

### Why it does not key on failed logins

Two deliberate reasons:

1. Next.js Server Actions answer **200** even on a rejected password — the form
   is simply re-rendered with a message. No jail based on the HTTP status can
   tell a failure from a success.
2. NOD CRM's application logs contain **IP fingerprints only**, never the
   address in clear text. Fail2ban would have nothing to ban.

Per-account failure counting is therefore handled inside the application, and
Fail2ban sticks to what it does best: volume per IP.

## Install

Replace `crm.example.com` with your own virtual host in `nod-crm.local` first.

```bash
sudo install -o root -g root -m 644 nod-crm-login.conf /etc/fail2ban/filter.d/nod-crm-login.conf
sudo install -o root -g root -m 644 nod-crm.local      /etc/fail2ban/jail.d/nod-crm.local

# Check BEFORE reloading: the filter must match the right lines.
sudo fail2ban-regex /var/log/nginx/crm.example.com.access.log \
     /etc/fail2ban/filter.d/nod-crm-login.conf

sudo fail2ban-client -t          # MUST succeed
sudo systemctl reload fail2ban
sudo fail2ban-client status nod-crm-login
```

## Remove

```bash
sudo rm /etc/fail2ban/jail.d/nod-crm.local /etc/fail2ban/filter.d/nod-crm-login.conf
sudo systemctl reload fail2ban
```

Other jails stay intact in both directions.
