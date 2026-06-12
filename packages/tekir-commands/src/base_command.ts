import type { CommandOptions, ArgsDef, FlagsDef, ParsedInput } from './types'
import { Prompts } from './prompts'
import { Logger, TerminalUI, colors } from './ui'

/**
 * Abstract base class for CLI commands. Extend this to create custom commands.
 *
 * @example
 * ```ts
 * import { BaseCommand } from '@tekir/commands'
 *
 * class MigrateCommand extends BaseCommand {
 *   static commandName = 'migrate'
 *   static description = 'Run database migrations'
 *
 *   async run() {
 *     this.logger.info('Running migrations...')
 *   }
 * }
 * ```
 */
export abstract class BaseCommand {
  // ── Metadata (set as static on subclass) ────────────────────────────────

  static commandName: string = ''
  static description: string = ''
  static aliases: string[] = []
  static help: string[] = []
  static options: CommandOptions = {}
  static args: ArgsDef = {}
  static flags: FlagsDef = {}

  // ── Runtime context ─────────────────────────────────────────────────────

  app: any = null
  parsed!: ParsedInput
  exitCode: number = 0
  error: Error | null = null

  /** Parsed argument values — e.g. this.args.name */
  get args(): Record<string, any> { return this.parsed?.args ?? {} }

  /** Parsed flag values — e.g. this.flags.verbose */
  get flags(): Record<string, any> { return this.parsed?.flags ?? {} }

  // ── Utilities ───────────────────────────────────────────────────────────

  readonly logger = new Logger()
  readonly prompt = new Prompts()
  readonly ui = new TerminalUI()
  readonly colors = colors

  // ── Lifecycle methods (override in subclass) ────────────────────────────

  /**
   * Lifecycle hook called before interact(). Use for setup logic.
   * @returns {Promise<void>}
   */
  async prepare(): Promise<void> {}

  /**
   * Lifecycle hook for interactive prompts. Called after prepare(), before run().
   * @returns {Promise<void>}
   */
  async interact(): Promise<void> {}

  /**
   * Main command logic. Must be implemented by subclasses.
   * @returns {Promise<void>}
   */
  abstract run(): Promise<void>

  /**
   * Lifecycle hook called after run() completes (even on error).
   * Return true to indicate the error was handled.
   * @returns {Promise<boolean | void>} True if the error was handled, otherwise void
   */
  async completed(): Promise<boolean | void> {}

  // ── Internal execution ──────────────────────────────────────────────────

  /**
   * Execute the full command lifecycle: prepare -> interact -> run -> completed.
   * @returns {Promise<void>}
   */
  async exec(): Promise<void> {
    try {
      await this.prepare()
      await this.interact()
      await this.run()
    } catch (err: any) {
      this.error = err
      this.exitCode = 1
    }

    try {
      const handled = await this.completed()
      if (!handled && this.error) {
        this.logger.error(this.error)
      }
    } catch (completedErr: any) {
      this.logger.error(completedErr)
      this.exitCode = 1
    }
  }

  /**
   * Terminate the process with the current exit code.
   * @returns {void}
   */
  terminate() {
    process.exit(this.exitCode)
  }
}
