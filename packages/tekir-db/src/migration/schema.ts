import { TableBuilder } from './table_builder'
import { SqlCompiler, type Operation } from './sql_compiler'

export class Schema {
  private operations: Operation[] = []
  private db: any
  private driver: string

  constructor(db: any, driver: string) {
    this.db = db
    this.driver = driver
  }

  createTable(name: string, callback: (table: TableBuilder) => void): void {
    const builder = new TableBuilder()
    callback(builder)
    this.operations.push({ type: 'createTable', tableName: name, builder })
  }

  createTableIfNotExists(name: string, callback: (table: TableBuilder) => void): void {
    const builder = new TableBuilder()
    callback(builder)
    this.operations.push({ type: 'createTableIfNotExists', tableName: name, builder })
  }

  alterTable(name: string, callback: (table: TableBuilder) => void): void {
    const builder = new TableBuilder()
    callback(builder)
    this.operations.push({ type: 'alterTable', tableName: name, builder })
  }

  dropTable(name: string): void {
    this.operations.push({ type: 'dropTable', tableName: name })
  }

  dropTableIfExists(name: string): void {
    this.operations.push({ type: 'dropTableIfExists', tableName: name })
  }

  renameTable(from: string, to: string): void {
    this.operations.push({ type: 'renameTable', tableName: from, newName: to })
  }

  raw(sql: string): void {
    this.operations.push({ type: 'raw', tableName: '', sql })
  }

  async execute(): Promise<void> {
    const compiler = new SqlCompiler(this.driver)
    const statements = compiler.compile(this.operations)
    this.operations = []

    const run = async () => {
      for (const sql of statements) {
        await this.db.exec(sql)
      }
    }

    // Wrap DDL in a transaction so a failure midway does not leave a partially
    // applied schema. SQLite and Postgres support transactional DDL; MySQL
    // auto-commits DDL, so a transaction there is a no-op but still harmless.
    if (typeof this.db.transaction === 'function') {
      await this.db.transaction(run)
    } else {
      await run()
    }
  }
}
