# Security review checklist (prototype)

Reviewed during Milestone 10 by the volunteer developer. **This is a self-review, not an independent audit.** Before real patient data is entered, ask a qualified person (for example the clinic's Tech Team or an external reviewer) to repeat it. Items marked "Clinic" need a decision or an action from the clinic.

## What is in place (and tested)

| Area | Control | Test |
|---|---|---|
| Passwords | scrypt hashing with a random salt; at least 10 characters with letters and numbers; seeded users must change the password at first sign-in | m1, m10 |
| Guessing | Account locks 15 minutes after 5 wrong passwords; one computer is blocked for 15 minutes after 20 failed sign-ins (in memory, resets when the server restarts); same cost for unknown and known usernames | m1, m10 |
| Sessions | Random 256-bit token, only its hash is stored; HttpOnly, SameSite=Strict cookie; signed out after 60 minutes idle and after 10 hours in any case; changing a password signs out other devices; deactivating a user or resetting their password signs them out at once and an old session never comes back | m1, m10 |
| Request forgery | Every non-GET request needs the `X-Requested-With: emr` header (a cross-site page cannot send it) | m1 |
| Browser hardening | Content-Security-Policy `default-src 'self'` (no inline scripts or styles), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` (no camera, microphone, location), HSTS when `EMR_SECURE=1` | m10 |
| Injection | Every database query uses placeholders. The few places that build SQL text from variables use fixed lists or constants, checked by reading all of them. The screens build the page with safe DOM calls, never with HTML strings | review |
| Files | Static files are served only from `public/`; path traversal is refused; request bodies are limited to 1 MB | m1 |
| Authorization | Every API route checks the role's permission in `lib/permissions.js`. Restricted records need a stated reason; HIV records are invisible to roles without permission; sensitive lab results are hidden; phone numbers need consent | m1–m9 |
| Audit | Sign-ins, failed sign-ins, record views, changes, exports, user administration. The log never stores clinical content, results, or passwords | m1–m10 |
| Reports | Aggregate numbers only; small counts of sensitive indicators shown as "<5"; exports masked; CSV cannot run formulas | m9 |
| Backups | Consistent snapshot while running; integrity and checksum verified; optional passphrase encryption (AES-256-GCM); restore refuses damaged or newer-version files and never deletes the current database | m10 |
| User administration | Deactivate, reactivate, change role, reset password, unlock. An administrator cannot deactivate themselves or change their own role | m10 |

## Known limits (not fixed in the prototype)

1. **Plain HTTP.** The server speaks HTTP. On a shared network, passwords and records can be read by others on that network. For anything beyond one computer, put it behind HTTPS (a reverse proxy such as Caddy or nginx) and start with `EMR_SECURE=1`. *Clinic: decide who sets this up.*
2. **The database file is not encrypted.** Anyone who can copy `data/emr.db` can read it. Use full-disk encryption (BitLocker on Windows, LUKS on Linux) and restrict who can sign in to the computer. *Clinic.*
3. **Backups are only encrypted if you set a passphrase** (`EMR_BACKUP_PASSPHRASE`). A lost USB drive with a plain backup is a data breach. *Clinic: choose and store the passphrase safely; without it the backup cannot be opened.*
4. **No two-factor sign-in.** Passwords only.
5. **The audit log can be changed by someone who has the database file.** It is not tamper-evident. Protect the file as in item 2, and keep encrypted backups as an independent copy.
6. **The sign-in throttle is per computer address and in memory.** Behind a reverse proxy every user may look like one address; configure the proxy to pass the real address before relying on it.
7. **No Host-header check.** If the server is reachable on the network, a hostile web page could try DNS-rebinding tricks. By default it listens on `127.0.0.1` only (this computer). Do not change `HOST` to `0.0.0.0` without HTTPS and a firewall.
8. **`node:sqlite` is experimental** in Node 22. It has been stable in this project's tests; the database layer is isolated in `lib/db.js` so it can be swapped.
9. **No penetration test, no dependency audit needed** (there are no npm dependencies), but also no fuzzing.
10. **Demo accounts.** `--demo` creates accounts with a published password. Never run demo mode with real data.

## Before real data (go-live gate)

- [ ] Clinic leadership approves a data protection policy and names a data controller (see `emr-prototype/DISCOVERY_QUESTIONS.md`, section J).
- [ ] An independent person repeats this review.
- [ ] HTTPS in front of the server; `EMR_SECURE=1`; the server computer is locked down and disk-encrypted.
- [ ] A first-run admin password is changed, no demo users exist, user accounts are created per person (no shared accounts).
- [ ] Backups are scheduled, encrypted, copied off the computer, and one restore has been rehearsed successfully (see the Admin guide).
- [ ] Clinicians have reviewed every "draft" clinical rule (list in `HANDOVER.md`).
- [ ] Native speakers have reviewed the Burmese and Karen text.
- [ ] A breach response plan exists (who to tell, including the 72-hour rule if it applies).
