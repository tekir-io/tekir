import { join, relative, isAbsolute, resolve } from 'path'
import { existsSync, readdirSync, statSync } from 'fs'

export interface ViteEmbedOptions {
  /** Application root (where package.json lives). */
  appRoot: string
  /** Vite build output directory, relative to appRoot (e.g. 'dist/client'). */
  buildDir: string
  /** User's entrypoint file (absolute path or relative to appRoot). */
  userEntry: string
}

export interface ViteEmbedResult {
  /** Virtual entrypoint specifier to feed into `Bun.build({ entrypoints })`. */
  entrypoint: string
  /** Bun plugin to add to `Bun.build({ plugins })`; supplies the embed map and wrapper. */
  plugin: any
}

interface FileEntry {
  absolutePath: string
  urlPath: string
}

const toPosix = (p: string) => p.replace(/\\/g, '/')

function walkDir(dir: string, base: string = dir): FileEntry[] {
  const out: FileEntry[] = []
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...walkDir(full, base))
    } else {
      const rel = toPosix(relative(base, full))
      out.push({ absolutePath: full, urlPath: '/' + rel })
    }
  }
  return out
}

const ENTRY_SPEC = 'tekir-virtual:vite-compile-entry'
const EMBED_SPEC = 'tekir-virtual:vite-embed'
const NS = 'tekir-vite'

/**
 * Build an in-memory Bun plugin that supplies the wrapper entry and the
 * urlPath → embedded-blob map for `frontend: { type: 'vite' }` compiles.
 *
 * The plugin generates two virtual modules:
 *
 *   - `tekir-virtual:vite-compile-entry`  — the entry passed to Bun.build.
 *     Imports the embed module, hoists `@tekir/vite` onto globalThis (so
 *     tekir-core can resolve the frontend module without createRequire on
 *     a node_modules tree that doesn't exist inside the compiled binary),
 *     then dynamically imports the user's `index.ts`.
 *
 *   - `tekir-virtual:vite-embed`  — one `import x from "./..." with { type:
 *     "file" }` per file in `dist/<buildDir>/`, plus a Map keyed by the URL
 *     path. The Map is parked on `globalThis.__TEKIR_VITE_EMBED__`; the
 *     middleware fast-paths it before any disk lookup.
 *
 * Both modules are loaded with `resolveDir` set to `appRoot`, so the
 * `with { type: 'file' }` imports resolve against real Vite output on disk
 * — the only place the bundler still needs to read.
 */
export function generateViteEmbed(opts: ViteEmbedOptions): ViteEmbedResult {
  const { appRoot, buildDir } = opts
  const userEntry = isAbsolute(opts.userEntry) ? opts.userEntry : resolve(appRoot, opts.userEntry)
  const distAbs = resolve(appRoot, buildDir)

  if (!existsSync(distAbs)) {
    throw new Error(`@tekir/vite: build output not found at ${distAbs}. Run vite build first.`)
  }

  const files = walkDir(distAbs)
  if (files.length === 0) {
    throw new Error(`@tekir/vite: no files in ${distAbs}; nothing to embed.`)
  }

  const imports: string[] = []
  const entries: string[] = []
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const varName = `a${i}`
    const importPath = './' + toPosix(relative(appRoot, f.absolutePath))
    // JSON.stringify produces a valid JS string literal, so a filename
    // containing a quote or newline cannot break out of the import specifier.
    imports.push(`import ${varName} from ${JSON.stringify(importPath)} with { type: 'file' }`)
    entries.push(`  [${JSON.stringify(f.urlPath)}, ${varName}],`)
    if (f.urlPath === '/index.html') {
      entries.push(`  ['/', ${varName}],`)
    }
  }

  const embedSrc = `${imports.join('\n')}

const __viteEmbed = new Map<string, string>([
${entries.join('\n')}
])
;(globalThis as any).__TEKIR_VITE_EMBED__ = __viteEmbed
export {}
`

  const userEntryPosix = toPosix(userEntry)
  const wrapperSrc = `import '${EMBED_SPEC}'
import * as __tekirViteMod from '@tekir/vite'
;(globalThis as any).__TEKIR_FRONTEND_MOD_vite = __tekirViteMod
await import(${JSON.stringify(userEntryPosix)})
`

  const plugin = {
    name: 'tekir-vite-embed',
    setup(build: any) {
      build.onResolve({ filter: /^tekir-virtual:vite-(compile-entry|embed)$/ }, (args: any) => ({
        path: args.path,
        namespace: NS,
      }))
      build.onLoad({ filter: /^tekir-virtual:vite-compile-entry$/, namespace: NS }, () => ({
        contents: wrapperSrc,
        loader: 'ts',
        resolveDir: appRoot,
      }))
      build.onLoad({ filter: /^tekir-virtual:vite-embed$/, namespace: NS }, () => ({
        contents: embedSrc,
        loader: 'ts',
        resolveDir: appRoot,
      }))
    },
  }

  return { entrypoint: ENTRY_SPEC, plugin }
}
