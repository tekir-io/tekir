import type { TekirApp } from '@tekir/core'

export default async function (_tekir: TekirApp) {
  // Run setup that should happen on every boot. Database schema is applied
  // separately via `bun run index.ts migrate` (see `start/commands.ts`).
}
