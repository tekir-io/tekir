import { tekir } from '@tekir/core'
import { DatabaseProvider } from '@tekir/db'
import type { Database } from '@tekir/db'

const { service } = await tekir({
  config: {
    app: { name: 'MySQL Test', port: 3098 },
    database: {
      default: 'mysql',
      connections: {
        mysql: {
          driver: 'mysql',
          connection: {
            connectionString: process.env.DATABASE_URL || 'mysql://root:@localhost:3306/test',
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
  console.log('✅ MySQL connected!', result[0])
} catch (e: any) {
  console.error('❌ Connection failed:', e.message)
}

try {
  await db.exec('CREATE TABLE IF NOT EXISTS _tekir_test (id INT AUTO_INCREMENT PRIMARY KEY, msg TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)')
  console.log('✅ Table created')

  await db.run('INSERT INTO _tekir_test (msg) VALUES (?)', ['Hello from tekir!'])
  console.log('✅ Row inserted')

  const rows = await db.query('SELECT * FROM _tekir_test')
  console.log('✅ Rows:', rows)

  await db.exec('DROP TABLE _tekir_test')
  console.log('✅ Table dropped')
} catch (e: any) {
  console.error('❌ Query failed:', e.message)
}

process.exit(0)
