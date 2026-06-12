import env from '#env'

export default {
  default: 'sqlite',
  connections: {
    sqlite: {
      driver: 'sqlite' as const,
      connection: { path: env.DB_PATH, wal: true },
    },
  },
}
