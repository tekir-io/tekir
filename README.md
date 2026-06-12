<p align="center">
  <img src="https://tekir.io/logo.svg" width="80" alt="tekir" />
</p>

<h1 align="center">tekir</h1>

<p align="center">
  The full-stack TypeScript framework for Bun and Node.js.
</p>

<p align="center">
  <a href="https://tekir.io">Website</a> ·
  <a href="https://docs.tekir.io">Docs</a> ·
  <a href="https://tekir.io/packages">Packages</a> ·
  <a href="https://tekir.io/blog">Blog</a> ·
  <a href="https://discord.gg/tekir">Discord</a>
</p>

---

Everything you need in one Bun framework. Authentication, ORM, validation, mail, queues, cache, testing, all working together. Think Laravel, Rails, or AdonisJS, but built from scratch for Bun.

## Quick Start

```bash
bunx create-tekir-app my-app
cd my-app
bun run dev
```

## Features

- **Bun Native**: Built directly on Bun.serve. Within 1% of raw Bun in benchmarks.
- **46 Packages**: Auth, ORM, validation, mail, queues, cron, cache, testing, and more.
- **5,000+ Tests**: Every package tested, every integration verified.
- **Full TypeScript**: No `any` leaks. Your IDE knows everything.
- **Optional Decorators**: Use `@Controller` or plain functions. Your choice.
- **Also runs on Node.js**: Via `@tekir/runtime`, everything works on Node.js 22+.

## Packages

| Category | Packages |
|----------|----------|
| **Core** | `@tekir/core` `@tekir/runtime` |
| **Database** | `@tekir/db` `@tekir/mongodb` `@tekir/redis` `@tekir/cache` `@tekir/session` |
| **Security** | `@tekir/auth` `@tekir/authorize` `@tekir/hash` `@tekir/encryption` `@tekir/cors` `@tekir/shield` `@tekir/limiter` `@tekir/validator` `@tekir/social` |
| **Communication** | `@tekir/mail` `@tekir/queue` `@tekir/notification` `@tekir/emitter` `@tekir/cron` |
| **Storage** | `@tekir/drive` `@tekir/static` `@tekir/bodyparser` |
| **Utilities** | `@tekir/commands` `@tekir/config` `@tekir/env` `@tekir/i18n` `@tekir/logger` `@tekir/view` |
| **Decorators** | `@tekir/decorators` `@tekir/http-decorators` `@tekir/db-decorators` `@tekir/cron-decorators` `@tekir/event-decorators` `@tekir/swagger-decorators` |
| **Dev Tools** | `@tekir/testing` `@tekir/swagger` `@tekir/health` `create-tekir-app` |
| **Frontend** | `@tekir/vite` `@tekir/next` |

## Development

```bash
# Install dependencies
bun install

# Run tests
bun run test

# Lint
bun run lint
```

## License

MIT
