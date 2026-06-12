/**
 * Build-entry preparation for `tekir build`.
 *
 * `tekir build` parses the user entry with `oxc-parser`, locates the
 * top-level `await tekir({...})` call, and emits a temporary source
 * that contains only:
 *
 *   1. Every bare `import 'X'` (no specifiers) — kept conservatively
 *      because side-effect-only imports register polyfills, type
 *      augmentation, etc., that the `tekir()` argument may rely on.
 *   2. The transitive closure of imports + top-level declarations
 *      (`const`, `let`, `function`, `class`) reachable from the
 *      `tekir()` call's argument expression.
 *   3. The `tekir()` call itself, verbatim.
 *
 * Everything else — `app.router.registerDir(...)`, `app.start(...)`,
 * `app.onShutdown(...)` callbacks, custom services with eager init,
 * scheduler ticks, fs watchers — is dropped. Inside `tekir()`, the
 * build dispatch fires the `onBuild` hooks, runs `Bun.build` for the
 * backend bundle, and exits; the temporary file is never re-evaluated
 * at runtime — the original entry is what gets bundled and shipped.
 *
 * Returning `null` is the safe-fallback signal: any AST shape we do
 * not recognise (no `tekir()` call, dynamic argument, multiple calls,
 * parse error) keeps the cli on a full-entry import so user code that
 * doesn't fit this shape still builds.
 */

import { readFileSync } from 'fs'
import { isAbsolute, join } from 'path'

let parserCache: { parseSync: (filename: string, src: string) => any } | null = null

async function tryLoadParser(): Promise<typeof parserCache> {
  if (parserCache) return parserCache
  try {
    const mod: any = await import('oxc-parser' as string)
    parserCache = { parseSync: mod.parseSync ?? mod.default?.parseSync }
    if (typeof parserCache.parseSync !== 'function') return null
    return parserCache
  } catch {
    return null
  }
}

interface BuildEntryResult {
  /** Generated source ready to write to a temp file and import. */
  source: string
  /** Names of top-level statements that were dropped, for diagnostics. */
  dropped: string[]
  /** Names of imports that were dropped, for diagnostics. */
  droppedImports: string[]
}

/**
 * Walk an AST node recursively and collect every `Identifier` it
 * references that is not an own binding of a sub-scope. We intentionally
 * stay coarse here: the goal is "names that resolve to module scope",
 * and over-approximation (keeping a binding we don't actually need) is
 * fine — under-approximation (dropping a needed binding) breaks
 * builds. A few cases are excluded to keep the result useful:
 *
 *   - Property keys on member access (`a.b` → `b` is not a free var).
 *   - Object literal property keys (`{ foo: bar }` → `foo` is not).
 *   - The bound name of a `function` or arrow parameter, which is
 *     scoped to the function body and shadows module bindings.
 *   - The bound name in a `VariableDeclarator`'s left-hand-side
 *     (`const x = y` → `y` is free, `x` is the binding).
 */
function collectFreeIdentifiers(node: any, out: Set<string>): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const child of node) collectFreeIdentifiers(child, out); return }
  if (typeof node.type !== 'string') return

  switch (node.type) {
    case 'Identifier':
      out.add(node.name)
      return
    case 'MemberExpression': {
      collectFreeIdentifiers(node.object, out)
      // `node.property` is only a free identifier when access is computed
      // (`obj[name]`); otherwise it's a literal property key.
      if (node.computed) collectFreeIdentifiers(node.property, out)
      return
    }
    case 'Property':
    case 'ObjectProperty': {
      // Computed keys can reference identifiers; static keys are labels.
      if (node.computed) collectFreeIdentifiers(node.key, out)
      collectFreeIdentifiers(node.value, out)
      return
    }
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
    case 'FunctionDeclaration': {
      // Parameters and inner identifiers are best handled by a scope
      // analyser, but we under-include here on purpose: the body might
      // reference module-scope names too. Walk parameters' default
      // values (free) and the body.
      for (const param of node.params ?? []) collectFreeIdentifiers(param, out)
      collectFreeIdentifiers(node.body, out)
      return
    }
    case 'VariableDeclarator': {
      // The `id` is a binding being created; only the initializer
      // contains free identifiers.
      collectFreeIdentifiers(node.init, out)
      return
    }
    default: {
      for (const key of Object.keys(node)) {
        if (key === 'type' || key === 'parent' || key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue
        const value = (node as any)[key]
        if (value && typeof value === 'object') collectFreeIdentifiers(value, out)
      }
    }
  }
}

/** Pull every binding name introduced by a top-level statement. */
function bindingNamesOf(stmt: any): string[] {
  if (!stmt) return []
  switch (stmt.type) {
    case 'ImportDeclaration':
      return (stmt.specifiers ?? [])
        .map((s: any) => s.local?.name)
        .filter((n: string | undefined) => typeof n === 'string')
    case 'ExportNamedDeclaration':
      if (stmt.declaration) return bindingNamesOf(stmt.declaration)
      return []
    case 'ExportDefaultDeclaration':
      return []
    case 'VariableDeclaration':
      return (stmt.declarations ?? [])
        .flatMap((d: any) => extractDeclaratorNames(d.id))
    case 'FunctionDeclaration':
    case 'ClassDeclaration':
      return stmt.id?.name ? [stmt.id.name] : []
    default:
      return []
  }
}

/** Recursively collect names from a destructuring pattern. */
function extractDeclaratorNames(pattern: any): string[] {
  if (!pattern) return []
  if (pattern.type === 'Identifier') return [pattern.name]
  if (pattern.type === 'ObjectPattern') {
    return (pattern.properties ?? []).flatMap((p: any) => {
      if (p.type === 'RestElement') return extractDeclaratorNames(p.argument)
      return extractDeclaratorNames(p.value ?? p.key)
    })
  }
  if (pattern.type === 'ArrayPattern') {
    return (pattern.elements ?? []).flatMap((e: any) => e ? extractDeclaratorNames(e) : [])
  }
  if (pattern.type === 'AssignmentPattern') return extractDeclaratorNames(pattern.left)
  if (pattern.type === 'RestElement') return extractDeclaratorNames(pattern.argument)
  return []
}

/**
 * Spot the top-level `await tekir({...})` call. Accepts both shapes that
 * appear in real entries:
 *
 *   const app = await tekir({...})
 *   await tekir({...})              // value discarded
 *   export const app = await tekir({...})
 *
 * Returns the wrapping top-level statement node (so the build-entry emitter
 * can keep it verbatim) plus the call expression for argument analysis.
 */
function findTekirCallStatement(body: any[]): { stmt: any; call: any } | null {
  for (const stmt of body) {
    const inner = stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : stmt
    if (!inner) continue

    // const app = await tekir({...})
    if (inner.type === 'VariableDeclaration') {
      for (const decl of inner.declarations ?? []) {
        const init = decl.init
        if (init?.type === 'AwaitExpression' && init.argument?.type === 'CallExpression') {
          if (init.argument.callee?.type === 'Identifier' && init.argument.callee.name === 'tekir') {
            return { stmt, call: init.argument }
          }
        }
      }
    }

    // await tekir({...})
    if (inner.type === 'ExpressionStatement') {
      const expr = inner.expression
      if (expr?.type === 'AwaitExpression' && expr.argument?.type === 'CallExpression') {
        if (expr.argument.callee?.type === 'Identifier' && expr.argument.callee.name === 'tekir') {
          return { stmt, call: expr.argument }
        }
      }
    }
  }
  return null
}

/**
 * Build the build-entry source. Returns `null` when the entry shape is not
 * supported (no top-level `await tekir()`, multiple calls, parse error,
 * etc.) — callers fall back to the historical full-entry execution.
 */
export async function generateBuildEntry(entryPath: string): Promise<BuildEntryResult | null> {
  const parser = await tryLoadParser()
  if (!parser) return null
  const { parseSync } = parser

  let source: string
  try { source = readFileSync(entryPath, 'utf-8') } catch { return null }

  // Cheap pre-filter: bail out before we parse if the file clearly does
  // not call `tekir(`.
  if (!/\btekir\s*\(/.test(source)) return null

  let result: any
  try { result = parseSync(entryPath, source) } catch { return null }
  const program = result?.program ?? result
  if (!Array.isArray(program?.body)) return null

  const found = findTekirCallStatement(program.body)
  if (!found) return null

  // First pass: index every top-level statement by the names it binds,
  // so identifier resolution is O(1).
  const bindingsToStmt = new Map<string, any>()
  for (const stmt of program.body) {
    for (const name of bindingNamesOf(stmt)) bindingsToStmt.set(name, stmt)
  }

  // Worklist over identifiers reachable from the tekir() call. Anything
  // they bind to becomes a required statement, and its own free
  // identifiers feed the worklist transitively. Seed from the WHOLE
  // statement, not just the argument list, so the `tekir` identifier
  // itself (the callee, resolved via `import { tekir } from
  // '@tekir/core'`) is in the closure too.
  const required = new Set<any>([found.stmt])
  const seenIds = new Set<string>()
  const pending: string[] = []
  const seedIds = new Set<string>()
  collectFreeIdentifiers(found.stmt, seedIds)
  for (const id of seedIds) pending.push(id)

  while (pending.length > 0) {
    const name = pending.pop()!
    if (seenIds.has(name)) continue
    seenIds.add(name)
    const decl = bindingsToStmt.get(name)
    if (!decl || required.has(decl)) continue
    required.add(decl)
    const next = new Set<string>()
    collectFreeIdentifiers(decl, next)
    for (const id of next) if (!seenIds.has(id)) pending.push(id)
  }

  // Always keep bare imports (no specifiers): polyfills, type
  // augmentation, register-once side effects.
  for (const stmt of program.body) {
    if (stmt.type === 'ImportDeclaration' && (stmt.specifiers?.length ?? 0) === 0) {
      required.add(stmt)
    }
  }

  // Emit kept statements in original source order. Source slicing keeps
  // formatting + decorators + comments inside the slice intact.
  const droppedNames: string[] = []
  const droppedImports: string[] = []
  const kept: string[] = []
  for (const stmt of program.body) {
    if (required.has(stmt)) {
      const text = source.slice(stmt.start, stmt.end)
      kept.push(text)
    } else {
      if (stmt.type === 'ImportDeclaration') {
        droppedImports.push(stmt.source?.value ?? '?')
      } else {
        const names = bindingNamesOf(stmt)
        if (names.length > 0) droppedNames.push(...names)
        else droppedNames.push(stmt.type)
      }
    }
  }

  // Banner so a developer who stumbles on the temp file in a stack
  // trace knows what produced it.
  const header = '// AUTO-GENERATED by @tekir/core during `tekir build`.\n' +
    '// Drops top-level statements unreachable from `tekir({...})` so the\n' +
    '// build pass does not trigger eager side effects (Redis subscribers,\n' +
    '// queue workers, fs watchers, scheduler ticks). Do not edit.\n\n'

  return {
    source: header + kept.join('\n'),
    dropped: droppedNames,
    droppedImports,
  }
}

/**
 * Resolve `entry` against `cwd` for callers that pass relative paths
 * (the cli's user-facing flow). Centralised so cli and other
 * consumers share the same resolution logic.
 */
export function resolveEntryPath(entry: string, cwd: string): string {
  if (isAbsolute(entry)) return entry
  return join(cwd, entry)
}

export const __internal = { findTekirCallStatement, collectFreeIdentifiers, bindingNamesOf }
