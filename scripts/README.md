# scripts

Repo checks. Plain Node, no dependencies, so they run anywhere Node does and
drop into CI unchanged.

| Script | What it checks |
|---|---|
| [`check-sw.mjs`](check-sw.mjs) | That the service worker still waits, and carries a version constant. |

## check-sw.mjs

```bash
node scripts/check-sw.mjs
```

Exits non-zero on a violation.

Two assertions, both from `update-bar-spec.md`:

1. **`skipWaiting()` and `clients.claim()` appear nowhere outside the
   message handler.** This is the single change that silently turns the
   update bar back into a takeover, reloading assets under a page still
   running the old JavaScript. It is exactly the kind of line somebody adds
   to fix a caching complaint without knowing what it was protecting, and it
   cannot be caught by reading the diff.
2. **`SW_VERSION` exists.** The browser compares the worker byte for byte,
   so a worker with no changing version is an update prompt nobody ever
   sees.

The handler's extent is measured by brace depth and not assumed, and
comments are stripped before scanning, so the prose in `sw.js` explaining
the rule does not read as a violation of it.
