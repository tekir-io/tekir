import type { ColumnDefinition } from './column_builder'
import type { TableBuilder } from './table_builder'

export interface Operation {
  type: 'createTable' | 'createTableIfNotExists' | 'alterTable' | 'dropTable' | 'dropTableIfExists' | 'renameTable' | 'raw'
  tableName: string
  newName?: string
  builder?: TableBuilder
  sql?: string
}


const SQLITE_TYPES: Record<string, string> = {
  id: 'INTEGER',
  string: 'TEXT',
  text: 'TEXT',
  integer: 'INTEGER',
  real: 'REAL',
  boolean: 'INTEGER',
  timestamp: 'TEXT',
  json: 'TEXT',
  blob: 'BLOB',
}

const PG_TYPES: Record<string, string> = {
  id: 'SERIAL',
  string: 'VARCHAR',
  text: 'TEXT',
  integer: 'INTEGER',
  real: 'DOUBLE PRECISION',
  boolean: 'BOOLEAN',
  timestamp: 'TIMESTAMP',
  json: 'JSONB',
  blob: 'BYTEA',
}

const MYSQL_TYPES: Record<string, string> = {
  id: 'INT',
  string: 'VARCHAR',
  text: 'TEXT',
  integer: 'INT',
  real: 'DOUBLE',
  boolean: 'TINYINT(1)',
  timestamp: 'TIMESTAMP',
  json: 'JSON',
  blob: 'BLOB',
}


export class SqlCompiler {
  private typeMap: Record<string, string>
  private driver: string

  constructor(driver: string) {
    this.driver = driver
    this.typeMap = driver === 'postgres' ? PG_TYPES : driver === 'mysql' ? MYSQL_TYPES : SQLITE_TYPES
  }

  compile(operations: Operation[]): string[] {
    const statements: string[] = []
    for (const op of operations) {
      switch (op.type) {
        case 'createTable':
          if (op.builder) statements.push(this.compileCreateTable(op.tableName, op.builder, false))
          break
        case 'createTableIfNotExists':
          if (op.builder) statements.push(this.compileCreateTable(op.tableName, op.builder, true))
          break
        case 'alterTable':
          if (op.builder) statements.push(...this.compileAlterTable(op.tableName, op.builder))
          break
        case 'dropTable':
          statements.push(`DROP TABLE ${this.quote(op.tableName)}`)
          break
        case 'dropTableIfExists':
          statements.push(`DROP TABLE IF EXISTS ${this.quote(op.tableName)}`)
          break
        case 'renameTable':
          if (op.newName) statements.push(`ALTER TABLE ${this.quote(op.tableName)} RENAME TO ${this.quote(op.newName)}`)
          break
        case 'raw':
          if (op.sql) statements.push(op.sql)
          break
      }
    }
    return statements
  }

  private compileCreateTable(name: string, builder: TableBuilder, ifNotExists: boolean): string {
    const defs = builder.columns.map(col => this.compileColumn(col.toDefinition()))
    const fks = builder.columns
      .map(col => col.toDefinition())
      .filter(d => d.references)
      .map(d => this.compileForeignKey(d))

    const ifne = ifNotExists ? ' IF NOT EXISTS' : ''
    return `CREATE TABLE${ifne} ${this.quote(name)} (\n  ${[...defs, ...fks].join(',\n  ')}\n)`
  }

  private compileColumn(col: ColumnDefinition): string {
    const parts: string[] = []
    parts.push(this.quote(col.name))

    // Type
    if (col.type === 'id') {
      if (this.driver === 'sqlite') {
        parts.push('INTEGER PRIMARY KEY AUTOINCREMENT')
        return parts.join(' ')
      } else if (this.driver === 'postgres') {
        parts.push('SERIAL PRIMARY KEY')
        return parts.join(' ')
      } else {
        parts.push('INT PRIMARY KEY AUTO_INCREMENT')
        return parts.join(' ')
      }
    }

    let sqlType = this.typeMap[col.type] || 'TEXT'
    if (col.type === 'string' && col.length && this.driver !== 'sqlite') {
      sqlType = `VARCHAR(${col.length})`
    }
    parts.push(sqlType)

    // Constraints
    if (col.primary) parts.push('PRIMARY KEY')
    if (col.autoIncrement && col.type !== 'id') {
      if (this.driver === 'sqlite') parts.push('AUTOINCREMENT')
      else if (this.driver === 'mysql') parts.push('AUTO_INCREMENT')
    }
    if (!col.nullable && col.type !== 'id') parts.push('NOT NULL')
    if (col.unique) parts.push('UNIQUE')

    // Default
    if (col.defaultValue !== undefined) {
      if (col.defaultValue === 'now') {
        if (this.driver === 'sqlite') parts.push("DEFAULT (datetime('now'))")
        else if (this.driver === 'postgres') parts.push('DEFAULT NOW()')
        else parts.push('DEFAULT CURRENT_TIMESTAMP')
      } else if (typeof col.defaultValue === 'string') {
        parts.push(`DEFAULT '${col.defaultValue.replace(/'/g, "''")}'`)
      } else if (typeof col.defaultValue === 'boolean') {
        parts.push(`DEFAULT ${col.defaultValue ? 1 : 0}`)
      } else {
        parts.push(`DEFAULT ${col.defaultValue}`)
      }
    }

    return parts.join(' ')
  }

  private static readonly VALID_FK_ACTIONS = new Set(['CASCADE', 'SET NULL', 'SET DEFAULT', 'RESTRICT', 'NO ACTION'])

  private validateFkAction(action: string): string {
    const upper = action.toUpperCase().trim()
    if (!SqlCompiler.VALID_FK_ACTIONS.has(upper)) {
      throw new Error(`Invalid foreign key action: "${action}"`)
    }
    return upper
  }

  private compileForeignKey(col: ColumnDefinition): string {
    const ref = col.references as NonNullable<ColumnDefinition['references']>
    let sql = `FOREIGN KEY (${this.quote(col.name)}) REFERENCES ${this.quote(ref.table)} (${this.quote(ref.column)})`
    if (ref.onDelete) sql += ` ON DELETE ${this.validateFkAction(ref.onDelete)}`
    if (ref.onUpdate) sql += ` ON UPDATE ${this.validateFkAction(ref.onUpdate)}`
    return sql
  }

  private compileAlterTable(name: string, builder: TableBuilder): string[] {
    const stmts: string[] = []

    for (const col of builder.columns) {
      const def = this.compileColumn(col.toDefinition())
      stmts.push(`ALTER TABLE ${this.quote(name)} ADD COLUMN ${def}`)
    }

    for (const col of builder.dropColumns) {
      stmts.push(`ALTER TABLE ${this.quote(name)} DROP COLUMN ${this.quote(col)}`)
    }

    for (const r of builder.renames) {
      stmts.push(`ALTER TABLE ${this.quote(name)} RENAME COLUMN ${this.quote(r.from)} TO ${this.quote(r.to)}`)
    }

    return stmts
  }

  private quote(name: string): string {
    // Allowlist identifier validation prevents injection if a table/column name
    // is ever sourced from config or a schema diff rather than a literal.
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new Error(`Invalid SQL identifier: "${name}"`)
    }
    if (this.driver === 'mysql') return `\`${name}\``
    return `"${name}"`
  }
}
