# tekir contributor playground

A tiny app wired to the workspace packages, kept here so contributors can:

- iterate on framework internals (`packages/*/src`) and see changes immediately,
- review PRs end-to-end without setting up a fresh project,
- sanity-check that the local workspace builds and boots.

## Run it

From the framework root:

```bash
bun install        # one-time, links workspace packages
bun run dev:example
```

Or from inside this folder:

```bash
bun install
bun run dev
```

Server starts on `http://localhost:5001`.

## What's inside

A single `index.ts` that wires up `@tekir/core`, `@tekir/cors`, `@tekir/db`
(in-memory sqlite), and `@tekir/swagger`. A few endpoints exercise the
common patterns: GET, dynamic params, POST body, JSON response, swagger UI.

This is intentionally minimal. If you need to test a feature that's not
covered, add a route here, push the diff with your PR.
