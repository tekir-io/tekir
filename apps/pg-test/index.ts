import { tekir } from '@tekir/core'
import { DatabaseProvider } from '@tekir/db'
import type { Database } from '@tekir/db'

const { service } = await tekir({
  config: {
    app: { name: 'PG Test', port: 3099 },
    database: {
      default: 'postgres',
      connections: {
        postgres: {
          driver: 'postgres',
          connection: {
            connectionString: process.env.DATABASE_URL || 'postgresql://postgres:@localhost:5432/test',
          },
        },
      },
    },
  },
  providers: [DatabaseProvider],
})

const db = service<Database>('db')

console.log('Driver:', db.driver)

try {
  const result = await db.query('SELECT NOW() as now')
  console.log('✅ PostgreSQL connected!', result[0])
} catch (e: any) {
  console.error('❌ Connection failed:', e.message)
}

try {
  await db.exec('CREATE TABLE IF NOT EXISTS _tekir_test (id SERIAL PRIMARY KEY, msg TEXT, created_at TIMESTAMP DEFAULT NOW())')
  console.log('✅ Table created')

  await db.run('INSERT INTO _tekir_test (msg) VALUES ($1)', ['Hello from Tekir!'])
  console.log('✅ Row inserted')

  const rows = await db.query('SELECT * FROM _tekir_test')
  console.log('✅ Rows:', rows)

  await db.exec('DROP TABLE _tekir_test')
  console.log('✅ Table dropped')
} catch (e: any) {
  console.error('❌ Query failed:', e.message)
}

process.exit(0)
