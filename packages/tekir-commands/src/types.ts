// Argument & Flag definitions

export interface ArgDef {
  type: 'string' | 'spread'
  description?: string
  required?: boolean
  default?: any
  parse?: (value: string) => any
}

export interface FlagDef {
  type: 'boolean' | 'string' | 'number' | 'array'
  alias?: string
  description?: string
  default?: any
  parse?: (value: string) => any
}

export type ArgsDef = Record<string, ArgDef>
export type FlagsDef = Record<string, FlagDef>

// Command options

export interface CommandOptions {
  startApp?: boolean
  staysAlive?: boolean
  allowUnknownFlags?: boolean
}

// Parsed CLI input

export interface ParsedInput {
  command: string
  args: Record<string, any>
  flags: Record<string, any>
  unknownFlags: string[]
}

// UI types

export interface TableColumn {
  content: string
  hAlign?: 'left' | 'right'
}

export type TableCell = string | TableColumn

export interface TaskContext {
  update(message: string): void
  error(message: string): string
}
