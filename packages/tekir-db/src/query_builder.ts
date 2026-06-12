// Fluent Query Builder — wraps raw SQL generation
// db.from('users').where('role', 'admin').select('id', 'email')

/**
 * Validate a SQL identifier (table or column name) against a strict allowlist regex.
 * Only allows `[a-zA-Z_][a-zA-Z0-9_.]*` — rejects any SQL injection payload.
 *
 * @param name - The identifier to validate (e.g. `'users'`, `'users.id'`).
 * @returns The validated name string.
 * @throws {Error} If the name contains invalid characters.
 *
 * @example
 * validateIdentifier('users')         // OK
 * validateIdentifier('users.id')      // OK
 * validateIdentifier("users; DROP--") // throws Error
 */
export function validateIdentifier(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(name)) {
    throw new Error(`Invalid SQL identifier: "${name}"`)
  }
  return name
}

/**
 * Validate and wrap a SQL identifier in double quotes. Supports dot notation for `table.column`.
 *
 * @param name - Identifier to quote (e.g. `'users'` → `'"users"'`, `'users.id'` → `'"users"."id"'`).
 * @returns The quoted identifier string.
 * @throws {Error} If any part of the name is invalid.
 */
export function quoteIdentifier(name: string): string {
  // Allow "table"."column" dot notation
  return name.split('.').map(part => `"${validateIdentifier(part)}"`).join('.')
}

/** Whitelist of allowed WHERE / HAVING comparison operators */
const VALID_WHERE_OPERATORS = new Set(['=', '!=', '<', '>', '<=', '>=', '<>', 'LIKE', 'NOT LIKE', 'IS', 'IS NOT', 'IN', 'NOT IN'])

/**
 * Validate a SQL comparison operator against an allowlist.
 * Allowed: `=`, `!=`, `<`, `>`, `<=`, `>=`, `<>`, `LIKE`, `NOT LIKE`, `IS`, `IS NOT`, `IN`, `NOT IN`.
 *
 * @param op - The operator string to validate.
 * @returns The original operator string (case-preserved).
 * @throws {Error} If the operator is not in the allowlist.
 */
export function validateOperator(op: string): string {
  const normalized = op.toUpperCase().trim()
  if (!VALID_WHERE_OPERATORS.has(normalized)) {
    throw new Error(`Invalid SQL operator: "${op}"`)
  }
  return op
}

/**
 * Fluent SQL query builder with fully parameterized queries and SQL injection protection.
 * All identifiers are validated, all values are parameterized — never interpolated into SQL.
 *
 * @example
 * ```ts
 * // SELECT
 * const users = await db.from('users')
 *   .select('name', 'email')
 *   .where('role', 'admin')
 *   .where('age', '>', 18)
 *   .orderBy('name', 'asc')
 *   .limit(10)
 *   .all()
 *
 * // INSERT
 * await db.from('users').insert({ name: 'Ali', email: 'ali@test.com' })
 *
 * // UPDATE
 * await db.from('users').where('id', 1).update({ name: 'Veli' })
 *
 * // DELETE
 * await db.from('users').where('id', 1).delete()
 *
 * // AGGREGATES
 * const count = await db.from('users').where('active', true).count()
 * const total = await db.from('orders').sum('amount')
 * ```
 */
export class QueryBuilder {
  private _table: string
  private _db: any
  private _selects: string[] = []
  private _wheres: { sql: string; params: any[] }[] = []
  private _orWheres: { sql: string; params: any[] }[] = []
  private _joins: string[] = []
  private _orderBys: string[] = []
  private _groupBys: string[] = []
  private _havings: { sql: string; params: any[] }[] = []
  private _limit?: number
  private _offset?: number
  private _distinct = false

  /**
   * Create a new query builder for the given table.
   *
   * @param db - The database instance to execute queries against.
   * @param table - The table name to query. Must be a valid SQL identifier.
   * @throws {Error} If the table name contains invalid characters.
   */
  constructor(db: any, table: string) {
    validateIdentifier(table)
    this._db = db
    this._table = table
  }

  // ── Select ─────────────────────────────────────────────

  /**
   * Specify columns to select. Call multiple times to add more columns.
   *
   * @param columns - Column names to include in the result set.
   * @returns The query builder for chaining.
   *
   * @example
   * db.from('users').select('id', 'name', 'email').all()
   */
  select(...columns: string[]): this {
    // Reject anything that looks like raw SQL (parens for aggregate
    // expressions, aliases via `AS`, comments, semicolons). Callers who
    // genuinely need aggregates such as `COUNT(*)` must opt in through
    // `selectRaw()`, which trusts the input. The old behaviour of
    // silently passing any string containing `(` through as raw SQL was
    // the SQL-injection footgun called out in the security audit.
    for (const c of columns) {
      if (c === '*') continue
      if (/[()\s;]|--/.test(c)) {
        throw new Error(
          `select(${JSON.stringify(c)}) looks like raw SQL. Use selectRaw() for aggregates or expressions, ` +
          `or pass a plain column identifier.`,
        )
      }
    }
    this._selects.push(...columns)
    return this
  }

  /**
   * Add a raw SQL select expression (e.g. aggregate functions, complex
   * computed columns). The string is appended to the SELECT list verbatim
   * — never pass user input here. Prefer {@link select} for plain columns.
   *
   * @param expression - Raw SQL fragment, already correctly escaped.
   * @returns The query builder for chaining.
   *
   * @example
   * db.from('orders').selectRaw('COUNT(*) AS total').first()
   */
  selectRaw(expression: string): this {
    // Sentinel prefix marks this entry so `_buildSelect()` skips
    // `quoteIdentifier()` for it. The prefix itself is stripped before
    // emission so the SQL output remains exactly what the caller wrote.
    this._selects.push(` raw ${expression}`)
    return this
  }

  /**
   * Add a DISTINCT clause to the query. Optionally specify columns to select.
   *
   * @param columns - Optional column names to select distinctly.
   * @returns The query builder for chaining.
   *
   * @example
   * db.from('users').distinct('role').all()
   */
  distinct(...columns: string[]): this {
    this._distinct = true
    if (columns.length) this._selects.push(...columns)
    return this
  }

  // ── Where ──────────────────────────────────────────────

  /**
   * Add a WHERE condition. Supports equality shorthand and explicit operators.
   *
   * @param column - The column name to filter on.
   * @param operatorOrValue - The comparison operator (e.g. `'>'`, `'LIKE'`) or the value for equality.
   * @param value - The value to compare against when an operator is provided.
   * @returns The query builder for chaining.
   *
   * @example
   * db.from('users').where('role', 'admin')          // WHERE role = 'admin'
   * db.from('users').where('age', '>', 18)            // WHERE age > 18
   */
  where(column: string, operatorOrValue?: any, value?: any): this {
    if (value === undefined) {
      this._wheres.push({ sql: `${quoteIdentifier(column)} = ?`, params: [operatorOrValue] })
    } else {
      this._wheres.push({ sql: `${quoteIdentifier(column)} ${validateOperator(operatorOrValue)} ?`, params: [value] })
    }
    return this
  }

  /**
   * Add an OR WHERE condition. Same signature as `where()`.
   *
   * @param column - The column name to filter on.
   * @param operatorOrValue - The comparison operator or the value for equality.
   * @param value - The value to compare against when an operator is provided.
   * @returns The query builder for chaining.
   *
   * @example
   * db.from('users').where('role', 'admin').orWhere('role', 'moderator')
   */
  orWhere(column: string, operatorOrValue?: any, value?: any): this {
    if (value === undefined) {
      this._orWheres.push({ sql: `${quoteIdentifier(column)} = ?`, params: [operatorOrValue] })
    } else {
      this._orWheres.push({ sql: `${quoteIdentifier(column)} ${validateOperator(operatorOrValue)} ?`, params: [value] })
    }
    return this
  }

  /**
   * Add a WHERE != condition.
   *
   * @param column - The column name to filter on.
   * @param value - The value the column must not equal.
   * @returns The query builder for chaining.
   */
  whereNot(column: string, value: any): this {
    this._wheres.push({ sql: `${quoteIdentifier(column)} != ?`, params: [value] })
    return this
  }

  /**
   * Add a WHERE IS NULL condition.
   *
   * @param column - The column that must be NULL.
   * @returns The query builder for chaining.
   */
  whereNull(column: string): this {
    this._wheres.push({ sql: `${quoteIdentifier(column)} IS NULL`, params: [] })
    return this
  }

  /**
   * Add a WHERE IS NOT NULL condition.
   *
   * @param column - The column that must not be NULL.
   * @returns The query builder for chaining.
   */
  whereNotNull(column: string): this {
    this._wheres.push({ sql: `${quoteIdentifier(column)} IS NOT NULL`, params: [] })
    return this
  }

  /**
   * Add a WHERE IN condition.
   *
   * @param column - The column to check against the list.
   * @param values - Array of allowed values.
   * @returns The query builder for chaining.
   *
   * @example
   * db.from('users').whereIn('role', ['admin', 'moderator']).all()
   */
  whereIn(column: string, values: any[]): this {
    // An empty IN () is invalid SQL; `IN ()` semantically matches nothing.
    if (values.length === 0) {
      this._wheres.push({ sql: '1 = 0', params: [] })
      return this
    }
    const placeholders = values.map(() => '?').join(', ')
    this._wheres.push({ sql: `${quoteIdentifier(column)} IN (${placeholders})`, params: values })
    return this
  }

  /**
   * Add a WHERE NOT IN condition.
   *
   * @param column - The column to check against the list.
   * @param values - Array of excluded values.
   * @returns The query builder for chaining.
   */
  whereNotIn(column: string, values: any[]): this {
    // An empty NOT IN () is invalid SQL; excluding nothing matches everything.
    if (values.length === 0) {
      this._wheres.push({ sql: '1 = 1', params: [] })
      return this
    }
    const placeholders = values.map(() => '?').join(', ')
    this._wheres.push({ sql: `${quoteIdentifier(column)} NOT IN (${placeholders})`, params: values })
    return this
  }

  /**
   * Add a WHERE BETWEEN condition.
   *
   * @param column - The column to check.
   * @param range - A two-element tuple `[min, max]`.
   * @returns The query builder for chaining.
   *
   * @example
   * db.from('orders').whereBetween('total', [100, 500]).all()
   */
  whereBetween(column: string, range: [any, any]): this {
    this._wheres.push({ sql: `${quoteIdentifier(column)} BETWEEN ? AND ?`, params: range })
    return this
  }

  /**
   * Add a WHERE LIKE condition for pattern matching.
   *
   * @param column - The column to match against.
   * @param pattern - The LIKE pattern (e.g. `'%admin%'`).
   * @returns The query builder for chaining.
   */
  whereLike(column: string, pattern: string): this {
    this._wheres.push({ sql: `${quoteIdentifier(column)} LIKE ?`, params: [pattern] })
    return this
  }

  /**
   * Add a raw WHERE clause. Use `?` placeholders for parameterized values.
   *
   * @param sql - Raw SQL condition string.
   * @param params - Parameter values to bind to the placeholders.
   * @returns The query builder for chaining.
   *
   * @example
   * db.from('users').whereRaw('LOWER(email) = ?', ['ali@test.com']).first()
   */
  whereRaw(sql: string, params: any[] = []): this {
    this._wheres.push({ sql, params })
    return this
  }

  // ── Joins ──────────────────────────────────────────────

  private static readonly VALID_JOIN_OPERATORS = new Set(['=', '!=', '<', '>', '<=', '>=', '<>'])

  private _buildJoin(type: string, table: string, col1: string, operator: string, col2: string): string {
    if (!QueryBuilder.VALID_JOIN_OPERATORS.has(operator)) {
      throw new Error(`Invalid JOIN operator: "${operator}"`)
    }
    return `${type} JOIN ${quoteIdentifier(table)} ON ${quoteIdentifier(col1)} ${operator} ${quoteIdentifier(col2)}`
  }

  /**
   * Add an INNER JOIN clause.
   *
   * @param table - The table to join.
   * @param col1 - The left-hand column (typically `'table.column'`).
   * @param operator - The join comparison operator (e.g. `'='`).
   * @param col2 - The right-hand column.
   * @returns The query builder for chaining.
   *
   * @example
   * db.from('posts').join('users', 'posts.userId', '=', 'users.id').all()
   */
  join(table: string, col1: string, operator: string, col2: string): this {
    this._joins.push(this._buildJoin('INNER', table, col1, operator, col2))
    return this
  }

  /**
   * Add a LEFT JOIN clause.
   *
   * @param table - The table to join.
   * @param col1 - The left-hand column.
   * @param operator - The join comparison operator.
   * @param col2 - The right-hand column.
   * @returns The query builder for chaining.
   */
  leftJoin(table: string, col1: string, operator: string, col2: string): this {
    this._joins.push(this._buildJoin('LEFT', table, col1, operator, col2))
    return this
  }

  /**
   * Add a RIGHT JOIN clause.
   *
   * @param table - The table to join.
   * @param col1 - The left-hand column.
   * @param operator - The join comparison operator.
   * @param col2 - The right-hand column.
   * @returns The query builder for chaining.
   */
  rightJoin(table: string, col1: string, operator: string, col2: string): this {
    this._joins.push(this._buildJoin('RIGHT', table, col1, operator, col2))
    return this
  }

  // ── Order / Group / Having ─────────────────────────────

  /**
   * Add an ORDER BY clause.
   *
   * @param column - The column to sort by.
   * @param direction - Sort direction: `'asc'` (default) or `'desc'`.
   * @returns The query builder for chaining.
   */
  orderBy(column: string, direction: 'asc' | 'desc' = 'asc'): this {
    const dir = direction.toLowerCase() === 'desc' ? 'DESC' : 'ASC'
    this._orderBys.push(`${quoteIdentifier(column)} ${dir}`)
    return this
  }

  /**
   * Add a GROUP BY clause for one or more columns.
   *
   * @param columns - Column names to group by.
   * @returns The query builder for chaining.
   */
  groupBy(...columns: string[]): this {
    this._groupBys.push(...columns.map(c => quoteIdentifier(c)))
    return this
  }

  /**
   * Add a HAVING clause (typically used with GROUP BY and aggregates).
   *
   * @param column - The column or aggregate to filter on.
   * @param operator - The comparison operator.
   * @param value - The value to compare against.
   * @returns The query builder for chaining.
   *
   * @example
   * db.from('orders').groupBy('userId').having('COUNT(*)', '>', 5).all()
   */
  having(column: string, operator: string, value: any): this {
    this._havings.push({ sql: `${quoteIdentifier(column)} ${validateOperator(operator)} ?`, params: [value] })
    return this
  }

  /**
   * Add a raw HAVING clause. Use `?` placeholders for parameterized values.
   *
   * @param sql - Raw SQL HAVING condition.
   * @param params - Parameter values to bind.
   * @returns The query builder for chaining.
   */
  havingRaw(sql: string, params: any[] = []): this {
    this._havings.push({ sql, params })
    return this
  }

  // ── Limit / Offset ─────────────────────────────────────

  /**
   * Limit the number of rows returned.
   *
   * @param n - Maximum number of rows. Must be a non-negative finite number.
   * @returns The query builder for chaining.
   * @throws {Error} If the value is negative or non-finite.
   */
  limit(n: number): this {
    const val = Math.floor(n)
    if (!Number.isFinite(val) || val < 0) throw new Error(`Invalid LIMIT value: ${n}`)
    this._limit = val
    return this
  }

  /**
   * Skip a number of rows before returning results.
   *
   * @param n - Number of rows to skip. Must be a non-negative finite number.
   * @returns The query builder for chaining.
   * @throws {Error} If the value is negative or non-finite.
   */
  offset(n: number): this {
    const val = Math.floor(n)
    if (!Number.isFinite(val) || val < 0) throw new Error(`Invalid OFFSET value: ${n}`)
    this._offset = val
    return this
  }

  /**
   * Shorthand for setting LIMIT and OFFSET based on a page number.
   *
   * @param page - The 1-based page number.
   * @param perPage - Number of rows per page. Defaults to `20`.
   * @returns The query builder for chaining.
   *
   * @example
   * db.from('users').forPage(3, 25).all()  // LIMIT 25 OFFSET 50
   */
  forPage(page: number, perPage = 20): this {
    const p = Math.floor(page)
    const pp = Math.floor(perPage)
    if (!Number.isFinite(p) || p < 1) throw new Error(`Invalid page value: ${page} (must be >= 1)`)
    if (!Number.isFinite(pp) || pp < 1) throw new Error(`Invalid perPage value: ${perPage} (must be >= 1)`)
    // Funnel through the same guards as limit()/offset() so SQL emitters
    // never see a malformed numeric — `forPage(-1, 20)` would otherwise
    // produce `LIMIT 20 OFFSET -40`, which most engines reject anyway but
    // some accept and emit warnings for.
    this.limit(pp)
    this.offset((p - 1) * pp)
    return this
  }

  // ── Execute: SELECT ────────────────────────────────────

  private _buildSelect(): { sql: string; params: any[] } {
    const cols = this._selects.length ? this._selects.map(c => {
      if (c === '*') return c
      if (c.startsWith(' raw ')) return c.slice(' raw '.length)
      return quoteIdentifier(c)
    }).join(', ') : '*'
    const dist = this._distinct ? 'DISTINCT ' : ''
    let sql = `SELECT ${dist}${cols} FROM "${this._table}"`

    if (this._joins.length) sql += ' ' + this._joins.join(' ')

    const params: any[] = []
    const whereParts: string[] = []
    for (const w of this._wheres) { whereParts.push(w.sql); params.push(...w.params) }
    for (const w of this._orWheres) { whereParts.push(`OR ${w.sql}`); params.push(...w.params) }
    if (whereParts.length) sql += ' WHERE ' + whereParts.join(' AND ').replace(/ AND OR /g, ' OR ')

    if (this._groupBys.length) sql += ' GROUP BY ' + this._groupBys.join(', ')
    if (this._havings.length) {
      const hParts = this._havings.map(h => { params.push(...h.params); return h.sql })
      sql += ' HAVING ' + hParts.join(' AND ')
    }
    if (this._orderBys.length) sql += ' ORDER BY ' + this._orderBys.join(', ')
    if (this._limit !== undefined) sql += ` LIMIT ${this._limit}`
    if (this._offset !== undefined) sql += ` OFFSET ${this._offset}`

    return { sql, params }
  }

  async all<T = any>(): Promise<T[]> {
    const { sql, params } = this._buildSelect()
    return this._db.query(sql, params)
  }

  async first<T = any>(): Promise<T | null> {
    this._limit = 1
    const { sql, params } = this._buildSelect()
    return this._db.queryOne(sql, params)
  }

  async firstOrFail<T = any>(): Promise<T> {
    const row = await this.first<T>()
    if (!row) throw new Error(`No rows found in "${this._table}"`)
    return row
  }

  // ── Aggregates ─────────────────────────────────────────

  async count(column = '*'): Promise<number> {
    const orig = [...this._selects]
    const safeCol = column === '*' ? '*' : quoteIdentifier(column)
    this._selects = [` raw COUNT(${safeCol}) as count`]
    const { sql, params } = this._buildSelect()
    this._selects = orig
    const row = await this._db.queryOne(sql, params)
    return row?.count ?? 0
  }

  async sum(column: string): Promise<number> {
    const orig = [...this._selects]
    this._selects = [` raw SUM(${quoteIdentifier(column)}) as total`]
    const { sql, params } = this._buildSelect()
    this._selects = orig
    const row = await this._db.queryOne(sql, params)
    return row?.total ?? 0
  }

  async avg(column: string): Promise<number> {
    const orig = [...this._selects]
    this._selects = [` raw AVG(${quoteIdentifier(column)}) as average`]
    const { sql, params } = this._buildSelect()
    this._selects = orig
    const row = await this._db.queryOne(sql, params)
    return row?.average ?? 0
  }

  async min(column: string): Promise<any> {
    const orig = [...this._selects]
    this._selects = [` raw MIN(${quoteIdentifier(column)}) as value`]
    const { sql, params } = this._buildSelect()
    this._selects = orig
    const row = await this._db.queryOne(sql, params)
    return row?.value
  }

  async max(column: string): Promise<any> {
    const orig = [...this._selects]
    this._selects = [` raw MAX(${quoteIdentifier(column)}) as value`]
    const { sql, params } = this._buildSelect()
    this._selects = orig
    const row = await this._db.queryOne(sql, params)
    return row?.value
  }

  // ── Pagination ─────────────────────────────────────────

  async paginate<T = any>(page: number, perPage = 20) {
    // Clamp to safe bounds: page < 1 / NaN → 1, perPage < 1 / NaN → 20.
    // Prevents a negative OFFSET or a 0/NaN LIMIT reaching the SQL emitter.
    const p = Number.isFinite(page) && Math.floor(page) >= 1 ? Math.floor(page) : 1
    const pp = Number.isFinite(perPage) && Math.floor(perPage) >= 1 ? Math.floor(perPage) : 20
    const total = await this.count()
    this._limit = pp
    this._offset = (p - 1) * pp
    const { sql, params } = this._buildSelect()
    const data = await this._db.query(sql, params) as T[]
    const lastPage = total === 0 ? 0 : Math.ceil(total / pp)
    return {
      data,
      meta: { total, page: p, perPage: pp, lastPage, hasMore: p < lastPage },
    }
  }

  // ── Execute: INSERT ────────────────────────────────────

  async insert(values: Record<string, any>): Promise<void> {
    const keys = Object.keys(values)
    const cols = keys.map(k => quoteIdentifier(k)).join(', ')
    const placeholders = keys.map(() => '?').join(', ')
    const sql = `INSERT INTO "${this._table}" (${cols}) VALUES (${placeholders})`
    await this._db.run(sql, Object.values(values))
  }

  async multiInsert(rows: Record<string, any>[]): Promise<void> {
    if (rows.length === 0) return
    const keys = Object.keys(rows[0])
    const cols = keys.map(k => quoteIdentifier(k)).join(', ')
    const rowPlaceholders = keys.map(() => '?').join(', ')
    const allPlaceholders = rows.map(() => `(${rowPlaceholders})`).join(', ')
    const allValues = rows.flatMap(r => keys.map(k => r[k]))
    const sql = `INSERT INTO "${this._table}" (${cols}) VALUES ${allPlaceholders}`
    await this._db.run(sql, allValues)
  }

  // ── Execute: UPDATE ────────────────────────────────────

  async update(values: Record<string, any>): Promise<number> {
    const sets = Object.keys(values).map(k => `${quoteIdentifier(k)} = ?`).join(', ')
    const params = [...Object.values(values)]

    let sql = `UPDATE "${this._table}" SET ${sets}`
    const whereParts: string[] = []
    for (const w of this._wheres) { whereParts.push(w.sql); params.push(...w.params) }
    if (whereParts.length) sql += ' WHERE ' + whereParts.join(' AND ')

    await this._db.run(sql, params)
    return 0 // SQLite doesn't return affected rows via run
  }

  async increment(column: string, amount = 1): Promise<void> {
    const quoted = quoteIdentifier(column)
    const params: any[] = [amount]
    let sql = `UPDATE "${this._table}" SET ${quoted} = ${quoted} + ?`
    const whereParts: string[] = []
    for (const w of this._wheres) { whereParts.push(w.sql); params.push(...w.params) }
    if (whereParts.length) sql += ' WHERE ' + whereParts.join(' AND ')
    await this._db.run(sql, params)
  }

  async decrement(column: string, amount = 1): Promise<void> {
    return this.increment(column, -amount)
  }

  // ── Execute: DELETE ────────────────────────────────────

  async delete(): Promise<void> {
    const params: any[] = []
    let sql = `DELETE FROM "${this._table}"`
    const whereParts: string[] = []
    for (const w of this._wheres) { whereParts.push(w.sql); params.push(...w.params) }
    if (whereParts.length) sql += ' WHERE ' + whereParts.join(' AND ')
    await this._db.run(sql, params)
  }

  // ── Debug ──────────────────────────────────────────────

  toSQL(): { sql: string; params: any[] } {
    return this._buildSelect()
  }

  /** Debug-only: returns an approximation of the full SQL query. DO NOT execute the output. */
  toQuery(): string {
    const { sql, params } = this._buildSelect()
    let result = sql
    for (const p of params) {
      const escaped = typeof p === 'string' ? `'${p.replace(/'/g, "''")}'` : String(p)
      result = result.replace('?', escaped)
    }
    return result
  }
}


/**
 * Fluent INSERT query builder with support for single/multi-row inserts and upserts.
 *
 * @example
 * ```ts
 * // Simple insert
 * await db.table('users').values({ name: 'Ali', email: 'ali@test.com' }).exec()
 *
 * // Upsert (insert or update on conflict)
 * await db.table('users')
 *   .values({ email: 'ali@test.com', name: 'Ali Updated' })
 *   .onConflict('email')
 *   .merge(['name'])
 *   .exec()
 *
 * // Multi-row insert
 * await db.table('users')
 *   .multiInsert([{ name: 'Ali' }, { name: 'Veli' }])
 *   .exec()
 * ```
 */
export class InsertBuilder {
  private _db: any
  private _table: string
  private _values: Record<string, any> = {}
  private _rows: Record<string, any>[] = []
  private _onConflictCols?: string[]
  private _conflictAction?: 'ignore' | 'merge'
  private _mergeCols?: string[]
  private _mergeValues?: Record<string, any>

  constructor(db: any, table: string) {
    validateIdentifier(table)
    this._db = db
    this._table = table
  }

  values(data: Record<string, any>): this {
    this._values = data
    return this
  }

  multiInsert(rows: Record<string, any>[]): this {
    this._rows = rows
    return this
  }

  onConflict(columns?: string | string[]): this {
    this._onConflictCols = columns ? (Array.isArray(columns) ? columns : [columns]) : []
    return this
  }

  ignore(): this {
    this._conflictAction = 'ignore'
    return this
  }

  merge(columnsOrValues?: string[] | Record<string, any>): this {
    this._conflictAction = 'merge'
    if (Array.isArray(columnsOrValues)) this._mergeCols = columnsOrValues
    else if (columnsOrValues) this._mergeValues = columnsOrValues
    return this
  }

  async exec(): Promise<void> {
    if (this._rows.length > 0) {
      return this._execMulti()
    }

    const keys = Object.keys(this._values)
    const cols = keys.map(k => quoteIdentifier(k)).join(', ')
    const placeholders = keys.map(() => '?').join(', ')
    let sql = `INSERT INTO "${this._table}" (${cols}) VALUES (${placeholders})`

    if (this._onConflictCols !== undefined) {
      const conflictCols = this._onConflictCols.length
        ? `(${this._onConflictCols.map(c => quoteIdentifier(c)).join(', ')})`
        : ''
      if (this._conflictAction === 'ignore') {
        sql += ` ON CONFLICT ${conflictCols} DO NOTHING`
      } else if (this._conflictAction === 'merge') {
        if (this._mergeValues) {
          const sets = Object.entries(this._mergeValues).map(([k]) => `${quoteIdentifier(k)} = ?`).join(', ')
          sql += ` ON CONFLICT ${conflictCols} DO UPDATE SET ${sets}`
        } else {
          const mergeCols = this._mergeCols || keys
          const sets = mergeCols.map(k => `${quoteIdentifier(k)} = EXCLUDED.${quoteIdentifier(k)}`).join(', ')
          sql += ` ON CONFLICT ${conflictCols} DO UPDATE SET ${sets}`
        }
      }
    }

    const params = [...Object.values(this._values)]
    if (this._mergeValues) params.push(...Object.values(this._mergeValues))
    await this._db.run(sql, params)
  }

  private async _execMulti(): Promise<void> {
    if (this._rows.length === 0) return
    const keys = Object.keys(this._rows[0])
    const cols = keys.map(k => quoteIdentifier(k)).join(', ')
    const rowPh = keys.map(() => '?').join(', ')
    const allPh = this._rows.map(() => `(${rowPh})`).join(', ')
    const allVals = this._rows.flatMap(r => keys.map(k => r[k]))
    await this._db.run(`INSERT INTO "${this._table}" (${cols}) VALUES ${allPh}`, allVals)
  }

  toSQL(): string {
    const keys = Object.keys(this._values)
    const cols = keys.map(k => quoteIdentifier(k)).join(', ')
    const placeholders = keys.map(() => '?').join(', ')
    return `INSERT INTO "${this._table}" (${cols}) VALUES (${placeholders})`
  }
}
