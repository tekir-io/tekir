import { ColumnBuilder } from './column_builder'

export class TableBuilder {
  readonly columns: ColumnBuilder[] = []
  readonly dropColumns: string[] = []
  readonly renames: { from: string; to: string }[] = []

  private _addColumn(name: string, type: string, length?: number): ColumnBuilder {
    const col = new ColumnBuilder(name, type, length)
    this.columns.push(col)
    return col
  }

  // ── Column types ──────────────────────────────────────

  id(name = 'id'): ColumnBuilder {
    return this._addColumn(name, 'id').primary().autoIncrement()
  }

  string(name: string, length = 255): ColumnBuilder {
    return this._addColumn(name, 'string', length)
  }

  text(name: string): ColumnBuilder {
    return this._addColumn(name, 'text')
  }

  integer(name: string): ColumnBuilder {
    return this._addColumn(name, 'integer')
  }

  real(name: string): ColumnBuilder {
    return this._addColumn(name, 'real')
  }

  boolean(name: string): ColumnBuilder {
    return this._addColumn(name, 'boolean')
  }

  timestamp(name: string): ColumnBuilder {
    return this._addColumn(name, 'timestamp')
  }

  json(name: string): ColumnBuilder {
    return this._addColumn(name, 'json')
  }

  blob(name: string): ColumnBuilder {
    return this._addColumn(name, 'blob')
  }

  // ── Shorthands ────────────────────────────────────────

  timestamps(): void {
    this.timestamp('created_at').defaultTo('now')
    this.timestamp('updated_at').nullable().defaultTo('now')
  }

  softDeletes(): void {
    this.timestamp('deleted_at').nullable()
  }

  // ── Alter operations ──────────────────────────────────

  dropColumn(name: string): void {
    this.dropColumns.push(name)
  }

  renameColumn(from: string, to: string): void {
    this.renames.push({ from, to })
  }
}
