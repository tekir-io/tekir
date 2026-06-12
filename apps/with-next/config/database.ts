export default {
  default: 'sqlite',
  connections: {
    sqlite: { driver: 'sqlite', connection: { path: ':memory:' } },
  },
}
