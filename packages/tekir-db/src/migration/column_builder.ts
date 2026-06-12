export interface ColumnDefinition {
  name: string
  type: string
  length?: number
  nullable: boolean
  unique: boolean
  primary: boolean
  autoIncrement: boolean
  defaultValue?: unknown
  references?: { table: string; column: string; onDelete?: string; onUpdate?: string }
  index: boolean
}

export class ColumnBuilder {
  private _def: ColumnDefinition

  constructor(name: string, type: string, length?: number) {
    this._def = {
      name,
      type,
      length,
      nullable: false,
      unique: false,
      primary: false,
      autoIncrement: false,
      index: false,
    }
  }

  notNullable(): this { this._def.nullable = false; return this }
  nullable(): this { this._def.nullable = true; return this }
  unique(): this { this._def.unique = true; return this }
  primary(): this { this._def.primary = true; return this }
  autoIncrement(): this { this._def.autoIncrement = true; return this }
  defaultTo(value: unknown): this { this._def.defaultValue = value; return this }
  index(): this { this._def.index = true; return this }

  references(table: string, column: string = 'id'): this {
    this._def.references = { table, column }
    return this
  }

  onDelete(action: string): this {
    if (this._def.references) this._def.references.onDelete = action
    return this
  }

  onUpdate(action: string): this {
    if (this._def.references) this._def.references.onUpdate = action
    return this
  }

  toDefinition(): ColumnDefinition {
    return { ...this._def }
  }
}
