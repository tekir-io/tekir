// Runtime detection

import { createRequire } from 'node:module'

export type Runtime = 'bun' | 'node'

let _runtime: Runtime | null = null

/**
 * Detect the current JavaScript runtime (Bun or Node.js). Result is cached after first call.
 * @returns {Runtime} 'bun' or 'node'
 *
 * @example
 * ```ts
 * const runtime = detectRuntime() // 'bun' or 'node'
 * ```
 */
export function detectRuntime(): Runtime {
  if (_runtime) return _runtime
  const proc = (globalThis as any).process
  // `process.versions.bun` only exists in real Bun, not our polyfill.
  if (proc?.versions?.bun) { _runtime = 'bun'; return _runtime }
  // Positive Node detection: require a real `process.versions.node` AND the
  // Node module system. A bare `process` shim (Deno, edge runtimes) without
  // `node:*` modules would otherwise be misclassified as 'node' and then
  // crash inside `serveNode` / `spawnNode`.
  if (proc?.versions?.node) { _runtime = 'node'; return _runtime }
  throw new Error('Unsupported runtime: expected Bun or Node.js (no process.versions.bun or process.versions.node)')
}

/**
 * Check if the current runtime is Bun.
 * @returns {boolean} True if running in Bun
 */
export function isBun(): boolean {
  return detectRuntime() === 'bun'
}

/**
 * Check if the current runtime is Node.js.
 * @returns {boolean} True if running in Node.js
 */
export function isNode(): boolean {
  return detectRuntime() === 'node'
}

/**
 * Get the display name of the current runtime.
 * @returns {string} 'Bun' or 'Node.js'
 */
export function runtimeName(): string {
  return isBun() ? 'Bun' : 'Node.js'
}

/**
 * Get the version string of the current runtime.
 * @returns {string} The runtime version (e.g. '1.0.25' for Bun, 'v22.6.0' for Node.js)
 */
export function runtimeVersion(): string {
  if (isBun()) return (globalThis as any).Bun.version || 'unknown'
  return process.version
}

/**
 * Get a cached require function that works in both Bun and Node.js ESM.
 * Bun uses the global require; Node.js uses createRequire from the current working directory.
 *
 * @returns {(id: string) => any} A require function compatible with both runtimes
 *
 * @example
 * ```ts
 * const require = getRequire()
 * const bcrypt = require('bcrypt')
 * ```
 */
let _require: (id: string) => any
export function getRequire(): (id: string) => any {
  if (_require) return _require
  if (isBun()) {
    _require = require
  } else {
    // Resolve native deps (bcrypt, argon2, better-sqlite3) relative to this
    // module's location, not the process cwd. A cwd-based require breaks when
    // the app boots from a different directory or a monorepo sub-package.
    _require = createRequire(import.meta.url)
  }
  return _require
}
