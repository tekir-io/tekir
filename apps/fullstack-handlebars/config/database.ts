export default {
  default: 'sqlite',
  connections: {
    sqlite: {
      driver: 'sqlite' as const,
      connection: { path: ':memory:' }
    }
  }
}
