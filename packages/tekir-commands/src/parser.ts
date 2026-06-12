import type { ArgsDef, FlagsDef, ParsedInput } from './types'

/**
 * Parse raw argv tokens into structured command input with typed args and flags.
 *
 * @param {string[]} argv - The argument tokens (without the command name)
 * @param {ArgsDef} [argsDef={}] - Argument definitions
 * @param {FlagsDef} [flagsDef={}] - Flag definitions
 * @param {boolean} [allowUnknownFlags=false] - Whether to allow unrecognized flags
 * @returns {ParsedInput} Parsed command input with args, flags, and unknownFlags
 *
 * @example
 * ```ts
 * const result = parse(['myfile.txt', '--verbose', '--port', '3000'], {
 *   file: { type: 'string', required: true }
 * }, {
 *   verbose: { type: 'boolean' },
 *   port: { type: 'number', default: 8080 }
 * })
 * // result.args.file === 'myfile.txt'
 * // result.flags.verbose === true
 * // result.flags.port === 3000
 * ```
 */
// Keys that would mutate Object's prototype chain if used as a bag key.
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function assertSafeKey(key: string): void {
  if (UNSAFE_KEYS.has(key)) throw new Error(`Unsafe flag/arg name: ${key}`)
}

export function parse(
  argv: string[],
  argsDef: ArgsDef = {},
  flagsDef: FlagsDef = {},
  allowUnknownFlags = false
): ParsedInput {
  // Use null-prototype objects for the parsed bags so a malicious flag/arg
  // name (`__proto__`, `constructor`, `prototype`) can never reach Object's
  // prototype, and so a polluted key can't ride along into a downstream
  // Object.assign / spread merge.
  const result: ParsedInput = {
    command: '',
    args: Object.create(null),
    flags: Object.create(null),
    unknownFlags: [],
  }

  // Build flag lookup: kebab-name → { key, def }
  const flagByName = new Map<string, { key: string; def: FlagsDef[string] }>()
  const flagByAlias = new Map<string, { key: string; def: FlagsDef[string] }>()

  for (const [key, def] of Object.entries(flagsDef)) {
    assertSafeKey(key)
    const name = toKebab(key)
    flagByName.set(name, { key, def })
    if (def.alias) flagByAlias.set(def.alias, { key, def })
    if (def.default !== undefined) result.flags[key] = def.default
  }

  // Ordered arg names
  const argEntries = Object.entries(argsDef)

  let i = 0
  const positionals: string[] = []

  while (i < argv.length) {
    const token = argv[i]

    if (token.startsWith('--no-')) {
      const name = token.slice(5)
      const entry = flagByName.get(name)
      if (entry && entry.def.type === 'boolean') {
        result.flags[entry.key] = false
      } else if (allowUnknownFlags) {
        result.unknownFlags.push(token)
      } else {
        throw new Error(`Unknown flag: ${token}`)
      }
      i++

    } else if (token.startsWith('--')) {
      let name: string
      let value: string | undefined

      if (token.includes('=')) {
        const eqIdx = token.indexOf('=')
        name = token.slice(2, eqIdx)
        value = token.slice(eqIdx + 1)
      } else {
        name = token.slice(2)
      }

      const entry = flagByName.get(name)
      if (!entry) {
        if (allowUnknownFlags) { result.unknownFlags.push(token); i++; continue }
        throw new Error(`Unknown flag: --${name}`)
      }

      const { key, def } = entry

      if (def.type === 'boolean') {
        result.flags[key] = true
      } else if (def.type === 'array') {
        if (value === undefined) {
          if (i + 1 >= argv.length || !isValueToken(argv[i + 1])) throw new Error(`Missing value for flag --${name}`)
          value = argv[++i]
        }
        if (!result.flags[key]) result.flags[key] = []
        result.flags[key].push(def.parse ? def.parse(value) : value)
      } else {
        if (value === undefined) {
          if (i + 1 >= argv.length || !isValueToken(argv[i + 1])) throw new Error(`Missing value for flag --${name}`)
          value = argv[++i]
        }
        let final: any = value
        if (def.type === 'number') {
          final = Number(value)
          if (isNaN(final)) throw new Error(`Flag --${name} must be a valid number`)
        }
        result.flags[key] = def.parse ? def.parse(final) : final
      }
      i++

    } else if (token.startsWith('-') && token.length > 1 && !token.startsWith('--')) {
      const chars = token.slice(1)
      for (let c = 0; c < chars.length; c++) {
        const alias = chars[c]
        const entry = flagByAlias.get(alias)
        if (!entry) {
          if (allowUnknownFlags) { result.unknownFlags.push(`-${alias}`); continue }
          throw new Error(`Unknown flag: -${alias}`)
        }

        const { key, def } = entry

        if (def.type === 'boolean') {
          result.flags[key] = true
        } else {
          let value: string
          if (c + 1 < chars.length) {
            value = chars.slice(c + 1)
          } else if (i + 1 < argv.length && isValueToken(argv[i + 1])) {
            value = argv[++i]
          } else {
            throw new Error(`Missing value for flag -${alias}`)
          }
          let final: any = value
          if (def.type === 'number') {
            final = Number(value)
            if (isNaN(final)) throw new Error(`Flag -${alias} must be a valid number`)
          }
          result.flags[key] = def.parse ? def.parse(final) : final
          break
        }
      }
      i++

    } else {
      positionals.push(token)
      i++
    }
  }

  // Map positionals to args
  let posIdx = 0
  for (const [key, def] of argEntries) {
    assertSafeKey(key)
    const required = def.required ?? true
    if (def.type === 'spread') {
      const remaining = positionals.slice(posIdx)
      if (required && remaining.length === 0) throw new Error(`Missing required argument: ${key}`)
      result.args[key] = remaining.map(v => def.parse ? def.parse(v) : v)
      posIdx = positionals.length
    } else {
      const value = positionals[posIdx]
      if (required && value === undefined && def.default === undefined) {
        throw new Error(`Missing required argument: ${key}`)
      }
      const final = value ?? def.default
      result.args[key] = def.parse ? def.parse(final) : final
      if (value !== undefined) posIdx++
    }
  }

  return result
}

// A token can be consumed as a flag value when it doesn't look like another
// flag. Negative numbers (`-5`, `-0.5`) are an exception so `--offset -5`
// works instead of forcing the `--offset=-5` form.
function isValueToken(token: string): boolean {
  if (!token.startsWith('-')) return true
  return /^-\d/.test(token) && !isNaN(Number(token))
}

function toKebab(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}
