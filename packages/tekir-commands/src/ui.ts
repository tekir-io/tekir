import type { TableCell, TaskContext } from './types'

/**
 * ANSI color helper functions for terminal output.
 *
 * @example
 * ```ts
 * console.log(colors.green('Success!'))
 * console.log(colors.bold(colors.cyan('Title')))
 * ```
 */
export const colors = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  blue: (s: string) => `\x1b[34m${s}\x1b[0m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  underline: (s: string) => `\x1b[4m${s}\x1b[0m`,
  bgRed: (s: string) => `\x1b[41m${s}\x1b[0m`,
  bgGreen: (s: string) => `\x1b[42m${s}\x1b[0m`,
  bgYellow: (s: string) => `\x1b[43m${s}\x1b[0m`,
  bgBlue: (s: string) => `\x1b[44m${s}\x1b[0m`,
  bgCyan: (s: string) => `\x1b[46m${s}\x1b[0m`,
  white: (s: string) => `\x1b[37m${s}\x1b[0m`,
}

/**
 * Structured logger for CLI output with colored icons for each log level.
 *
 * @example
 * ```ts
 * const logger = new Logger()
 * logger.info('Server started', { suffix: 'port 3000' })
 * logger.success('Migration complete')
 * logger.error('Connection failed')
 * ```
 */
export class Logger {
  /**
   * Log a debug message.
   * @param {string} message - The message to log
   * @param {object} [opts] - Optional prefix and suffix
   * @param {any} [opts.prefix] - Prefix displayed before the message
   * @param {string} [opts.suffix] - Suffix displayed after the message
   * @returns {void}
   */
  debug(message: string, opts?: { prefix?: any; suffix?: string }) {
    this._log('debug', message, opts)
  }

  /**
   * Log an informational message.
   * @param {string} message - The message to log
   * @param {object} [opts] - Optional prefix and suffix
   * @returns {void}
   */
  info(message: string, opts?: { prefix?: any; suffix?: string }) {
    this._log('info', message, opts)
  }

  /**
   * Log a success message.
   * @param {string} message - The message to log
   * @param {object} [opts] - Optional prefix and suffix
   * @returns {void}
   */
  success(message: string, opts?: { prefix?: any; suffix?: string }) {
    this._log('success', message, opts)
  }

  /**
   * Log a warning message.
   * @param {string} message - The message to log
   * @param {object} [opts] - Optional prefix and suffix
   * @returns {void}
   */
  warning(message: string, opts?: { prefix?: any; suffix?: string }) {
    this._log('warning', message, opts)
  }

  /**
   * Log an error message to stderr.
   * @param {string | Error} message - The error message or Error instance
   * @param {object} [_opts] - Optional prefix and suffix (unused)
   * @returns {void}
   */
  error(message: string | Error, _opts?: { prefix?: any; suffix?: string }) {
    const msg = message instanceof Error ? message.message : message
    process.stderr.write(`  ${colors.red('✖')} ${msg}\n`)
  }

  /**
   * Log a fatal error message to stderr with a highlighted background.
   * @param {string | Error} message - The fatal error message or Error instance
   * @returns {void}
   */
  fatal(message: string | Error) {
    const msg = message instanceof Error ? message.message : message
    process.stderr.write(`  ${colors.bgRed(colors.white(' FATAL '))} ${msg}\n`)
  }

  private _log(level: string, message: string, opts?: { prefix?: any; suffix?: string }) {
    const icons: Record<string, string> = {
      debug: colors.gray('●'),
      info: colors.blue('ℹ'),
      success: colors.green('✔'),
      warning: colors.yellow('⚠'),
    }
    const icon = icons[level] || ''
    const prefix = opts?.prefix ? `${colors.dim(String(opts.prefix))} ` : ''
    const suffix = opts?.suffix ? ` ${colors.dim(opts.suffix)}` : ''
    console.log(`  ${icon} ${prefix}${message}${suffix}`)
  }

  /**
   * Create an action logger that tracks create/skip/fail outcomes with optional duration.
   * @param {string} label - The action label (e.g. a file path)
   * @returns {{ displayDuration(): object; succeeded(): void; skipped(reason?: string): void; failed(error?: string | Error): void }} Action tracker
   *
   * @example
   * ```ts
   * const action = logger.action('config/database.ts')
   * action.displayDuration().succeeded()
   * ```
   */
  action(label: string) {
    const start = Date.now()
    return {
      _showDuration: false,
      displayDuration() { this._showDuration = true; return this },
      succeeded() {
        const dur = this._showDuration ? ` ${colors.dim(`(${Date.now() - start}ms)`)}` : ''
        console.log(`  ${colors.green('CREATE')} ${label}${dur}`)
      },
      skipped(reason?: string) {
        const r = reason ? ` ${colors.dim(reason)}` : ''
        console.log(`  ${colors.yellow('SKIP')}   ${label}${r}`)
      },
      failed(error?: string | Error) {
        const msg = error instanceof Error ? error.message : error
        const r = msg ? ` ${colors.dim(msg)}` : ''
        console.log(`  ${colors.red('ERROR')}  ${label}${r}`)
      },
    }
  }
}

/**
 * Renders a formatted table in the terminal with optional headers and column alignment.
 *
 * @example
 * ```ts
 * new Table()
 *   .head(['Name', 'Status', 'Duration'])
 *   .row(['migrate', 'done', '12ms'])
 *   .row(['seed', 'done', '5ms'])
 *   .render()
 * ```
 */
export class Table {
  private headers: TableCell[] = []
  private rows: TableCell[][] = []
  private _fullWidth = false
  private _fluidCol = 0

  /**
   * Set the table header row.
   * @param {TableCell[]} cells - The header cells
   * @returns {this} The table instance for chaining
   */
  head(cells: TableCell[]) {
    this.headers = cells
    return this
  }

  /**
   * Add a data row to the table.
   * @param {TableCell[]} cells - The row cells
   * @returns {this} The table instance for chaining
   */
  row(cells: TableCell[]) {
    this.rows.push(cells)
    return this
  }

  /**
   * Enable full-width rendering mode.
   * @returns {this} The table instance for chaining
   */
  fullWidth() {
    this._fullWidth = true
    return this
  }

  /**
   * Set the index of the fluid (auto-expanding) column.
   * @param {number} idx - Zero-based column index
   * @returns {this} The table instance for chaining
   */
  fluidColumnIndex(idx: number) {
    this._fluidCol = idx
    return this
  }

  /**
   * Render the table to stdout.
   * @returns {void}
   */
  render() {
    const allRows = [this.headers, ...this.rows]
    const colCount = Math.max(...allRows.map(r => r.length))

    // Calculate column widths
    const widths: number[] = Array(colCount).fill(0)
    for (const row of allRows) {
      for (let i = 0; i < row.length; i++) {
        const text = stripAnsi(cellText(row[i]))
        widths[i] = Math.max(widths[i], text.length)
      }
    }

    // Render
    const renderRow = (row: TableCell[]) => {
      const parts: string[] = []
      for (let i = 0; i < colCount; i++) {
        const cell = row[i] ?? ''
        const text = cellText(cell)
        const align = cellAlign(cell)
        const stripped = stripAnsi(text)
        const pad = widths[i] - stripped.length
        if (align === 'right') {
          parts.push(' '.repeat(Math.max(0, pad)) + text)
        } else {
          parts.push(text + ' '.repeat(Math.max(0, pad)))
        }
      }
      return '  ' + parts.join('  ')
    }

    // Header
    if (this.headers.length > 0) {
      console.log(colors.bold(renderRow(this.headers)))
      const sep = widths.map(w => '─'.repeat(w)).join('──')
      console.log(colors.dim(`  ${sep}`))
    }

    // Rows
    for (const row of this.rows) {
      console.log(renderRow(row))
    }
    console.log()
  }
}

/**
 * Renders boxed/bordered content in the terminal.
 *
 * @example
 * ```ts
 * new Sticker()
 *   .add('Server running at http://localhost:3000')
 *   .add('Press Ctrl+C to stop')
 *   .render()
 * ```
 */
export class Sticker {
  private lines: string[] = []

  /**
   * Add a line of content to the sticker.
   * @param {string} line - The line text
   * @returns {this} The sticker instance for chaining
   */
  add(line: string) {
    this.lines.push(line)
    return this
  }

  /**
   * Render the boxed content to stdout.
   * @returns {void}
   */
  render() {
    const maxLen = Math.max(...this.lines.map(l => stripAnsi(l).length))
    const border = colors.dim('─'.repeat(maxLen + 4))

    console.log()
    console.log(`  ${border}`)
    for (const line of this.lines) {
      const pad = maxLen - stripAnsi(line).length
      console.log(`  ${colors.dim('│')} ${line}${' '.repeat(pad)} ${colors.dim('│')}`)
    }
    console.log(`  ${border}`)
    console.log()
  }
}

/**
 * Renders a list of instruction lines prefixed with a dimmed '>' character.
 *
 * @example
 * ```ts
 * new Instructions()
 *   .add('Run `bun dev` to start the development server')
 *   .add('Open http://localhost:3000 in your browser')
 *   .render()
 * ```
 */
export class Instructions {
  private lines: string[] = []

  /**
   * Add an instruction line.
   * @param {string} line - The instruction text
   * @returns {this} The instructions instance for chaining
   */
  add(line: string) {
    this.lines.push(line)
    return this
  }

  /**
   * Render the instructions to stdout.
   * @returns {void}
   */
  render() {
    console.log()
    for (const line of this.lines) {
      console.log(`  ${colors.dim('>')} ${line}`)
    }
    console.log()
  }
}

/**
 * Sequential task runner with spinner-like output and success/failure indicators.
 *
 * @example
 * ```ts
 * const tasks = new Tasks({ verbose: true })
 * tasks.add('Compile assets', async (ctx) => {
 *   ctx.update('Compiling...')
 *   return 'Done in 120ms'
 * })
 * await tasks.run()
 * ```
 */
export class Tasks {
  private taskList: { title: string; handler: (ctx: TaskContext) => Promise<string> }[] = []
  private _verbose = false

  /**
   * Create a new Tasks runner.
   * @param {object} [options] - Configuration options
   * @param {boolean} [options.verbose=false] - Whether to show detailed task progress
   */
  constructor(options?: { verbose?: boolean }) {
    this._verbose = options?.verbose ?? false
  }

  /**
   * Add a task to the queue.
   * @param {string} title - Display title for the task
   * @param {(ctx: TaskContext) => Promise<string>} handler - Async handler that returns a success message
   * @returns {this} The tasks instance for chaining
   */
  add(title: string, handler: (ctx: TaskContext) => Promise<string>) {
    this.taskList.push({ title, handler })
    return this
  }

  /**
   * Execute all queued tasks sequentially, displaying progress and results.
   * @returns {Promise<void>}
   */
  async run() {
    for (const task of this.taskList) {
      let _lastUpdate = ''
      let failed = false
      let errorMessage = ''

      const verbose = this._verbose
      const ctx: TaskContext = {
        update(message: string) {
          _lastUpdate = message
          if (verbose) {
            console.log(`  ${colors.dim('│')} ${message}`)
          }
        },
        error(message: string) {
          failed = true
          errorMessage = message
          return message
        },
      }

      if (!this._verbose) {
        process.stdout.write(`  ${colors.cyan('◌')} ${task.title}...`)
      } else {
        console.log(`  ${colors.cyan('●')} ${task.title}`)
      }

      try {
        const result = await task.handler(ctx)

        if (failed) {
          if (!this._verbose) {
            process.stdout.write(`\r  ${colors.red('✖')} ${task.title} ${colors.dim(errorMessage)}\n`)
          } else {
            console.log(`  ${colors.red('✖')} ${errorMessage}`)
          }
        } else {
          if (!this._verbose) {
            process.stdout.write(`\r  ${colors.green('✔')} ${task.title} ${colors.dim(result)}\n`)
          } else {
            console.log(`  ${colors.green('✔')} ${result}`)
          }
        }
      } catch (e: any) {
        if (!this._verbose) {
          process.stdout.write(`\r  ${colors.red('✖')} ${task.title} ${colors.dim(e.message)}\n`)
        } else {
          console.log(`  ${colors.red('✖')} ${e.message}`)
        }
      }
    }
  }
}

/**
 * Factory class for creating terminal UI components (tables, stickers, instructions, tasks).
 *
 * @example
 * ```ts
 * const ui = new TerminalUI()
 * ui.table().head(['Name', 'Value']).row(['port', '3000']).render()
 * ```
 */
export class TerminalUI {
  /**
   * Create a new Table instance.
   * @returns {Table} A new table builder
   */
  table() { return new Table() }

  /**
   * Create a new Sticker (boxed content) instance.
   * @returns {Sticker} A new sticker builder
   */
  sticker() { return new Sticker() }

  /**
   * Create a new Instructions instance.
   * @returns {Instructions} A new instructions builder
   */
  instructions() { return new Instructions() }

  /**
   * Create a new Tasks runner instance.
   * @param {object} [options] - Configuration options
   * @param {boolean} [options.verbose=false] - Whether to show detailed task progress
   * @returns {Tasks} A new tasks runner
   */
  tasks(options?: { verbose?: boolean }) { return new Tasks(options) }
}

// Helpers

function cellText(cell: TableCell): string {
  return typeof cell === 'string' ? cell : cell.content
}

function cellAlign(cell: TableCell): string {
  return typeof cell === 'string' ? 'left' : (cell.hAlign ?? 'left')
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '')
}
