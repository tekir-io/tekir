import { readdir } from 'node:fs/promises'
import { resolve, sep } from 'path'
import { fileExists } from '@tekir/runtime'
import type { BaseCommand } from './base_command'
import { parse } from './parser'
import { colors } from './ui'

type CommandClass = typeof BaseCommand & { new(): BaseCommand }

/**
 * Command kernel that discovers, registers, and executes CLI commands.
 *
 * @example
 * ```ts
 * import { Kernel } from '@tekir/commands'
 *
 * const kernel = new Kernel(app)
 * await kernel.discover('./commands')
 * await kernel.handle(process.argv.slice(2))
 * ```
 */
export class Kernel {
  private commands = new Map<string, CommandClass>()
  private aliases = new Map<string, string>()
  private app: any = null

  /**
   * Create a new Kernel instance.
   * @param {any} [app] - The application instance to inject into commands
   */
  constructor(app?: any) {
    this.app = app
  }

  /**
   * Register a single command class.
   * @param {CommandClass} Cmd - The command class to register (must have a static commandName)
   * @returns {this} The kernel instance for chaining
   *
   * @example
   * ```ts
   * kernel.register(MigrateCommand)
   * ```
   */
  register(Cmd: CommandClass): this {
    const name = Cmd.commandName
    if (!name) throw new Error('Command must have a static commandName')
    this.commands.set(name, Cmd)
    for (const alias of Cmd.aliases || []) this.aliases.set(alias, name)
    return this
  }

  /**
   * Register multiple command classes at once.
   * @param {CommandClass[]} commands - Array of command classes to register
   * @returns {this} The kernel instance for chaining
   *
   * @example
   * ```ts
   * kernel.registerAll([MigrateCommand, SeedCommand, ServeCommand])
   * ```
   */
  registerAll(commands: CommandClass[]): this {
    for (const cmd of commands) this.register(cmd)
    return this
  }

  /**
   * Auto-discover and register command files from a directory.
   * Scans for .ts/.js files that export a class with a static commandName.
   *
   * IMPORTANT: every matched file is `import()`-ed, which runs its top-level
   * code. Only point this at a trusted, application-owned directory (e.g.
   * `app/commands`), never at a user-writable or third-party location, since
   * a file dropped there would execute on discovery.
   *
   * The directory is resolved to an absolute base and each discovered file is
   * verified to stay under that base (guards against symlinks / `..` escapes
   * surfaced by the recursive walk) before it is imported. Import failures are
   * reported on stderr instead of being silently swallowed so a broken command
   * is visible.
   *
   * @param {string} dir - Path to the trusted commands directory
   * @returns {Promise<this>} The kernel instance for chaining
   *
   * @example
   * ```ts
   * await kernel.discover('./app/commands')
   * ```
   */
  async discover(dir: string): Promise<this> {
    if (!(await fileExists(dir))) return this
    const base = resolve(dir)
    const dirFiles = await readdir(base, { recursive: true }) as string[]
    for (const file of dirFiles) {
      if (!/\.(ts|js)$/.test(file) || file.endsWith('.d.ts')) continue
      const full = resolve(base, file)
      // Confine to the trusted base; a recursive walk can surface entries
      // (via symlinks or odd names) that resolve outside it.
      if (full !== base && !full.startsWith(base + sep)) continue
      try {
        const mod = await import(full.replace(/\\/g, '/'))
        const Cmd = mod.default || Object.values(mod).find((v: any) => typeof v === 'function' && v.commandName)
        if (Cmd?.commandName) this.register(Cmd as CommandClass)
      } catch (err: any) {
        console.error(`${colors.yellow('⚠')} Failed to load command file ${file}: ${err?.message ?? err}`)
      }
    }
    return this
  }

  /**
   * Parse argv and execute the matching command.
   * Displays help if no command is given or command is 'help'.
   * @param {string[]} argv - The command-line arguments (without the binary name)
   * @returns {Promise<void>}
   *
   * @example
   * ```ts
   * await kernel.handle(['migrate', '--seed', '--force'])
   * ```
   */
  async handle(argv: string[]): Promise<void> {
    const commandName = argv[0]

    if (!commandName || commandName === 'help' || commandName === '--help') {
      this.printHelp()
      return
    }

    const resolvedName = this.aliases.get(commandName) ?? commandName
    const Cmd = this.commands.get(resolvedName)

    if (!Cmd) {
      console.log(`\n  ${colors.red('✖')} Unknown command: ${commandName}`)
      this.printSuggestions(commandName)
      console.log(`  Run ${colors.cyan('help')} to see all commands.\n`)
      process.exit(1)
    }

    if (argv.includes('--help') || argv.includes('-h')) {
      this.printCommandHelp(Cmd)
      return
    }

    let parsed
    try {
      parsed = parse(argv.slice(1), Cmd.args, Cmd.flags, Cmd.options?.allowUnknownFlags)
    } catch (err: any) {
      console.log(`\n  ${colors.red('✖')} ${err.message}\n`)
      process.exit(1)
    }
    parsed.command = resolvedName

    if (Cmd.options?.startApp && this.app) {
      try { await this.app.boot() } catch (e: any) {
        console.log(`\n  ${colors.red('✖')} Failed to boot app: ${e.message}\n`)
        process.exit(1)
      }
    }

    const instance = new (Cmd as any)()
    instance.app = this.app
    instance.parsed = parsed
    await instance.exec()

    if (!Cmd.options?.staysAlive) process.exit(instance.exitCode)
  }

  /**
   * Print the global help listing all registered commands grouped by namespace.
   * @returns {void}
   */
  printHelp() {
    console.log(`\n  ${colors.bold('Tekir CLI')}\n`)
    console.log(`  Usage: bun run index.ts ${colors.cyan('<command>')} [args] [flags]\n`)

    const groups = new Map<string, { name: string; desc: string }[]>()
    for (const [name, Cmd] of this.commands) {
      const parts = name.split(':')
      const group = parts.length > 1 ? parts[0] : 'general'
      if (!groups.has(group)) groups.set(group, [])
      const list = groups.get(group)
      if (list) list.push({ name, desc: Cmd.description || '' })
    }

    for (const [group, cmds] of groups) {
      console.log(`  ${colors.bold(group)}`)
      for (const cmd of cmds.sort((a, b) => a.name.localeCompare(b.name))) {
        console.log(`    ${colors.cyan(cmd.name.padEnd(24))} ${colors.dim(cmd.desc)}`)
      }
      console.log()
    }
  }

  private printCommandHelp(Cmd: CommandClass) {
    console.log()
    console.log(`  ${colors.bold(Cmd.commandName)}`)
    if (Cmd.description) console.log(`  ${Cmd.description}`)
    if (Cmd.help?.length) { console.log(); for (const l of Cmd.help) console.log(`  ${l}`) }

    const argEntries = Object.entries(Cmd.args || {})
    if (argEntries.length) {
      console.log(`\n  ${colors.bold('Arguments:')}`)
      for (const [name, def] of argEntries) {
        const req = (def.required ?? true) ? '' : colors.dim(' (optional)')
        const desc = def.description ? ` ${colors.dim(def.description)}` : ''
        console.log(`    ${colors.cyan(name)}${req}${desc}`)
      }
    }

    const flagEntries = Object.entries(Cmd.flags || {})
    if (flagEntries.length) {
      console.log(`\n  ${colors.bold('Flags:')}`)
      for (const [name, def] of flagEntries) {
        const flag = `--${toKebab(name)}`
        const alias = def.alias ? `, -${def.alias}` : ''
        const desc = def.description ? ` ${colors.dim(def.description)}` : ''
        const defVal = def.default !== undefined ? ` ${colors.dim(`[default: ${def.default}]`)}` : ''
        console.log(`    ${colors.cyan(flag)}${alias}${desc}${defVal}`)
      }
    }

    if (Cmd.aliases?.length) console.log(`\n  ${colors.bold('Aliases:')} ${Cmd.aliases.join(', ')}`)
    console.log()
  }

  private printSuggestions(input: string) {
    const all = [...this.commands.keys(), ...this.aliases.keys()]
    const suggestions = all.filter(n => n.startsWith(input.slice(0, 3)) || n.includes(input)).slice(0, 3)
    if (suggestions.length) console.log(`  Did you mean: ${suggestions.map(s => colors.cyan(s)).join(', ')}?`)
  }
}

function toKebab(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}
