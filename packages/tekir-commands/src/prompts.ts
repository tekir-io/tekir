import { createInterface } from 'readline'

/**
 * Interactive terminal prompts for CLI commands.
 *
 * @example
 * ```ts
 * const prompts = new Prompts()
 * const name = await prompts.ask('What is your name?')
 * const confirmed = await prompts.confirm('Continue?')
 * ```
 */
export class Prompts {
  private rl() {
    return createInterface({ input: process.stdin, output: process.stdout })
  }

  private question(rl: ReturnType<typeof createInterface>, prompt: string): Promise<string> {
    return new Promise(resolve => rl.question(prompt, (answer) => { rl.close(); resolve(answer) }))
  }

  /**
   * Prompt the user for text input.
   * @param {string} message - The prompt message
   * @param {object} [options] - Options for validation, default value, hint, and result transformation
   * @param {string} [options.default] - Default value if the user presses Enter
   * @param {(value: string) => true | string} [options.validate] - Validation function returning true or an error message
   * @param {(value: string) => string} [options.result] - Transform the result before returning
   * @param {string} [options.hint] - Hint text shown after the message
   * @returns {Promise<string>} The user's input
   *
   * @example
   * ```ts
   * const name = await prompts.ask('Project name?', { default: 'my-app' })
   * ```
   */
  async ask(message: string, options?: {
    default?: string
    validate?: (value: string) => true | string
    result?: (value: string) => string
    hint?: string
  }): Promise<string> {
    const hint = options?.hint ? ` \x1b[90m(${options.hint})\x1b[0m` : ''
    const def = options?.default ? ` \x1b[90m[${options.default}]\x1b[0m` : ''

    while (true) {
      const rl = this.rl()
      const raw = await this.question(rl, `\x1b[36m?\x1b[0m ${message}${hint}${def}: `)
      const value = raw.trim() || options?.default || ''

      if (options?.validate) {
        const result = options.validate(value)
        if (result !== true) {
          console.log(`\x1b[31m  ${result}\x1b[0m`)
          continue
        }
      }

      return options?.result ? options.result(value) : value
    }
  }

  /**
   * Prompt the user for masked/secret input (e.g. passwords).
   * @param {string} message - The prompt message
   * @param {object} [options] - Options for validation
   * @param {(value: string) => true | string} [options.validate] - Validation function returning true or an error message
   * @returns {Promise<string>} The user's secret input
   *
   * @example
   * ```ts
   * const password = await prompts.secure('Enter password:')
   * ```
   */
  async secure(message: string, options?: {
    validate?: (value: string) => true | string
  }): Promise<string> {
    while (true) {
      // `secure` reads stdin directly in raw mode; do NOT open a readline
      // interface here — it would attach its own 'data' listener to the same
      // stdin and race this loop for bytes, corrupting the masked input.
      const stdin = process.stdin
      const wasRaw = stdin.isRaw
      if (stdin.setRawMode) stdin.setRawMode(true)

      let value = ''
      const prompt = `\x1b[36m?\x1b[0m ${message}: `
      process.stdout.write(prompt)

      value = await new Promise<string>((resolve) => {
        let buf = ''
        const onData = (ch: Buffer) => {
          const c = ch.toString()
          if (c === '\n' || c === '\r') {
            stdin.removeListener('data', onData)
            if (stdin.setRawMode) stdin.setRawMode(wasRaw ?? false)
            process.stdout.write('\n')
            resolve(buf)
          } else if (c === '\x7f' || c === '\b') {
            if (buf.length > 0) {
              buf = buf.slice(0, -1)
              process.stdout.write('\b \b')
            }
          } else if (c === '\x03') {
            // Ctrl+C: restore the terminal and exit with the conventional
            // SIGINT code (130) so scripts see a cancellation, not success.
            if (stdin.setRawMode) stdin.setRawMode(wasRaw ?? false)
            process.stdout.write('\n')
            process.exit(130)
          } else {
            buf += c
            process.stdout.write('*')
          }
        }
        stdin.on('data', onData)
      })

      if (options?.validate) {
        const result = options.validate(value)
        if (result !== true) {
          console.log(`\x1b[31m  ${result}\x1b[0m`)
          continue
        }
      }

      return value
    }
  }

  /**
   * Ask a yes/no confirmation question.
   * @param {string} message - The confirmation message
   * @returns {Promise<boolean>} True if the user confirmed with 'y' or 'yes'
   *
   * @example
   * ```ts
   * if (await prompts.confirm('Delete all records?')) { ... }
   * ```
   */
  async confirm(message: string): Promise<boolean> {
    const rl = this.rl()
    const answer = await this.question(rl, `\x1b[36m?\x1b[0m ${message} \x1b[90m(y/N)\x1b[0m: `)
    return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes'
  }

  /**
   * Ask a toggle question with custom labels.
   * @param {string} message - The prompt message
   * @param {[string, string]} [labels=['Yes', 'No']] - The two toggle labels
   * @returns {Promise<boolean>} True if the user selected the first label
   *
   * @example
   * ```ts
   * const useTypescript = await prompts.toggle('Language?', ['TypeScript', 'JavaScript'])
   * ```
   */
  async toggle(message: string, labels: [string, string] = ['Yes', 'No']): Promise<boolean> {
    const rl = this.rl()
    const answer = await this.question(rl, `\x1b[36m?\x1b[0m ${message} \x1b[90m(${labels[0]}/${labels[1]})\x1b[0m: `)
    return answer.trim().toLowerCase() === labels[0].toLowerCase()
  }

  /**
   * Present a single-select list of choices.
   * @param {string} message - The prompt message
   * @param {(T | { name: T; message: string })[]} choices - Array of choices (strings or objects with name/message)
   * @returns {Promise<T>} The selected choice name
   *
   * @example
   * ```ts
   * const db = await prompts.choice('Database?', ['sqlite', 'postgres', 'mysql'])
   * ```
   */
  async choice<T extends string = string>(message: string, choices: (T | { name: T; message: string })[]): Promise<T> {
    console.log(`\x1b[36m?\x1b[0m ${message}`)

    const items = choices.map((c, i) => {
      const name = typeof c === 'string' ? c : c.name
      const display = typeof c === 'string' ? c : c.message
      return { name, display, index: i }
    })

    for (const item of items) {
      console.log(`  \x1b[90m${item.index + 1})\x1b[0m ${item.display}`)
    }

    // Re-prompt on invalid input rather than silently falling back to the
    // first option — a wrong default can be destructive (e.g. env selection).
    while (true) {
      // question() closes its interface after each answer. Create a fresh one
      // for every attempt, just like ask(), so an invalid choice can actually
      // be re-prompted instead of querying a closed readline interface.
      const rl = this.rl()
      const answer = await this.question(rl, `\x1b[36m>\x1b[0m `)
      const trimmed = answer.trim()
      const idx = parseInt(trimmed, 10) - 1

      if (idx >= 0 && idx < items.length) return items[idx].name

      const match = items.find(i => i.name === trimmed || i.display === trimmed)
      if (match) return match.name

      console.log(`\x1b[31m  Invalid choice. Enter a number 1-${items.length} or an option name.\x1b[0m`)
    }
  }

  /**
   * Present a multi-select list of choices (comma-separated numbers).
   * @param {string} message - The prompt message
   * @param {(T | { name: T; message: string })[]} choices - Array of choices (strings or objects with name/message)
   * @returns {Promise<T[]>} Array of selected choice names
   *
   * @example
   * ```ts
   * const features = await prompts.multiple('Features?', ['auth', 'cors', 'rate-limit'])
   * ```
   */
  async multiple<T extends string = string>(message: string, choices: (T | { name: T; message: string })[]): Promise<T[]> {
    console.log(`\x1b[36m?\x1b[0m ${message} \x1b[90m(comma-separated numbers)\x1b[0m`)

    const items = choices.map((c, i) => {
      const name = typeof c === 'string' ? c : c.name
      const display = typeof c === 'string' ? c : c.message
      return { name, display, index: i }
    })

    for (const item of items) {
      console.log(`  \x1b[90m${item.index + 1})\x1b[0m ${item.display}`)
    }

    const rl = this.rl()
    const answer = await this.question(rl, `\x1b[36m>\x1b[0m `)
    const indices = answer.split(',').map(s => parseInt(s.trim(), 10) - 1).filter(i => i >= 0 && i < items.length)

    return indices.map(i => items[i].name)
  }
}
