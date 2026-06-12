#!/usr/bin/env node
// create-tekir-app — scaffold a new tekir project

import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, resolve, dirname, isAbsolute, relative } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))


/**
 * Validate a user-supplied project name and resolve it to a safe target
 * directory under the current working directory.
 *
 * The name becomes a filesystem path, so an unsanitized value like `../../x`,
 * an absolute path (`/etc/x`, `C:\Windows\x`), or one containing path
 * separators could write files outside the cwd. This rejects those: the name
 * must be a single safe segment, and the resolved target must stay under cwd.
 *
 * @param {string} name - The raw project name (argv or prompt)
 * @returns {{ ok: true; name: string; targetDir: string } | { ok: false; error: string }}
 */
export function resolveProjectTarget(
  name: string,
  cwd: string = process.cwd()
): { ok: true; name: string; targetDir: string } | { ok: false; error: string } {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return { ok: false, error: 'Project name is required' }
  if (trimmed === '.' || trimmed === '..') {
    return { ok: false, error: 'Project name cannot be "." or ".."' }
  }
  if (isAbsolute(trimmed)) {
    return { ok: false, error: 'Project name cannot be an absolute path' }
  }
  // Reject any path separators (POSIX and Windows) and traversal segments.
  if (/[\\/]/.test(trimmed) || trimmed.split(/[\\/]/).includes('..')) {
    return { ok: false, error: 'Project name cannot contain path separators or ".."' }
  }
  // Restrict to a conservative safe segment.
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    return { ok: false, error: 'Project name may only contain letters, numbers, ".", "-", and "_"' }
  }

  const targetDir = resolve(cwd, trimmed)
  const rel = relative(cwd, targetDir)
  // Final defense: the resolved target must stay under cwd.
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    return { ok: false, error: 'Project name resolves outside the current directory' }
  }

  return { ok: true, name: trimmed, targetDir }
}

/**
 * Normalize a (already-validated) project name into a valid npm package name:
 * lowercase, with leading dots/underscores stripped. Falls back to "app" if
 * nothing valid remains.
 *
 * @param {string} name - A validated project name
 * @returns {string} A valid npm package name
 */
export function toPackageName(name: string): string {
  const normalized = name.toLowerCase().replace(/^[._]+/, '')
  return normalized || 'app'
}


const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`


const TEMPLATES = {
  minimal: {
    name: 'Minimal',
    description: 'Single-file TODO API with SQLite, Swagger, and CORS',
  },
  api: {
    name: 'API',
    description: 'Full API project with auth, database, validation, mail, and more',
  },
  fullstack: {
    name: 'Fullstack',
    description: 'API + React frontend with views, auth, and database',
  },
  'with-vite': {
    name: 'Vite + React',
    description: 'tekir API backend + Vite React frontend on the same port',
  },
  'with-next': {
    name: 'Next.js',
    description: 'tekir API backend + Next.js SSR frontend on the same port',
  },
} as const

type TemplateName = keyof typeof TEMPLATES


async function main() {
  const args = process.argv.slice(2)

  console.log('')
  console.log(bold('  create-tekir-app'))
  console.log(dim('  The full-stack TypeScript framework for Bun'))
  console.log('')

  // Parse project name
  let projectName = args[0]
  if (!projectName || projectName.startsWith('-')) {
    projectName = await prompt(cyan('  Project name: '))
    if (!projectName) {
      console.log(red('  Error: Project name is required'))
      process.exit(1)
    }
  }

  // Validate the name before it ever becomes a path (traversal / abs-path guard).
  const resolved = resolveProjectTarget(projectName)
  if (!resolved.ok) {
    console.log(red(`  Error: ${resolved.error}`))
    process.exit(1)
  }
  projectName = resolved.name
  const targetDir = resolved.targetDir

  // Parse template from --template flag or prompt
  let template: TemplateName | undefined
  const templateFlag = args.find(a => a.startsWith('--template='))
  if (templateFlag) {
    template = templateFlag.split('=')[1] as TemplateName
  }

  if (!template || !TEMPLATES[template]) {
    console.log('')
    console.log('  Select a template:')
    console.log('')
    const entries = Object.entries(TEMPLATES) as [TemplateName, typeof TEMPLATES[TemplateName]][]
    entries.forEach(([key, val], i) => {
      console.log(`    ${bold(`${i + 1}.`)} ${bold(val.name)} ${dim(`(${key})`)}`)
      console.log(`       ${dim(val.description)}`)
    })
    console.log('')
    const choice = await prompt(cyan(`  Template (1-${entries.length}): `))
    const idx = parseInt(choice) - 1
    template = (Object.keys(TEMPLATES) as TemplateName[])[idx]
    if (!template) {
      console.log(red('  Error: Invalid template'))
      process.exit(1)
    }
  }

  // Check if directory exists
  if (existsSync(targetDir)) {
    const files = readdirSync(targetDir)
    if (files.length > 0) {
      console.log(red(`  Error: Directory "${projectName}" already exists and is not empty`))
      process.exit(1)
    }
  }

  console.log('')
  console.log(`  ${dim('Template:')}  ${bold(TEMPLATES[template].name)}`)
  console.log(`  ${dim('Project:')}   ${bold(projectName)}`)
  console.log('')

  // Copy template
  const templateDir = join(__dirname, 'templates', template)
  if (!existsSync(templateDir)) {
    console.log(red(`  Error: Template "${template}" not found`))
    process.exit(1)
  }

  mkdirSync(targetDir, { recursive: true })
  copyDir(templateDir, targetDir)

  // Update package.json with project name (normalized to a valid npm name:
  // lowercase, no leading dots/underscores) so the toolchain doesn't choke.
  const pkgPath = join(targetDir, 'package.json')
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    pkg.name = toPackageName(projectName)
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  }

  // Create .env if template has .env.example
  const envExample = join(targetDir, '.env.example')
  const envFile = join(targetDir, '.env')
  if (existsSync(envExample) && !existsSync(envFile)) {
    const content = readFileSync(envExample, 'utf-8')
    writeFileSync(envFile, content)
  }

  // Done
  console.log(green('  Done!') + ' Project created at ' + bold(projectName))
  console.log('')
  console.log('  Next steps:')
  console.log('')
  console.log(`    ${cyan('cd')} ${projectName}`)
  console.log(`    ${cyan('bun install')}`)
  console.log(`    ${cyan('bun run dev')}`)
  console.log('')
}


function copyDir(src: string, dest: string) {
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(src)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'bun.lock') continue
    const srcPath = join(src, entry)
    const destPath = join(dest, entry)
    const stat = statSync(srcPath)
    if (stat.isDirectory()) {
      copyDir(srcPath, destPath)
    } else {
      // Rename .template files back to their original name
      const finalPath = destPath.endsWith('.template') ? destPath.slice(0, -'.template'.length) : destPath
      writeFileSync(finalPath, readFileSync(srcPath))
    }
  }
}

function prompt(message: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(message)
    process.stdin.setEncoding('utf-8')
    process.stdin.resume()
    const onData = (chunk: string | Buffer) => {
      cleanup()
      resolve(chunk.toString().trim())
    }
    // Without an EOF handler a piped/closed stdin (CI, `echo | create-...`)
    // would hang forever waiting for a 'data' event that never comes.
    const onEnd = () => {
      cleanup()
      resolve('')
    }
    const cleanup = () => {
      process.stdin.removeListener('data', onData)
      process.stdin.removeListener('end', onEnd)
      process.stdin.pause()
    }
    process.stdin.once('data', onData)
    process.stdin.once('end', onEnd)
  })
}

// Only run the scaffolder when invoked as the entry point, so importing this
// module (e.g. from tests for the pure helpers) doesn't kick off a prompt.
// `import.meta.main` covers Bun; the argv[1] comparison covers Node hosts.
const invokedDirectly =
  (import.meta as any).main === true ||
  (typeof process !== 'undefined' &&
    process.argv[1] !== undefined &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url))

if (invokedDirectly) {
  main().catch((e) => {
    console.error(red(`  Error: ${e.message}`))
    process.exit(1)
  })
}
