import { defineEnv, str, port } from '@tekir/env'

export default defineEnv({
  NODE_ENV: str({ choices: ['development', 'production', 'test'], default: 'development' }),
  APP_NAME: str({ default: 'tekir API' }),
  APP_KEY: str({ default: 'tekir-dev-secret-key-change-in-production' }),
  PORT: port({ default: 3000 }),
  DB_PATH: str({ default: ':memory:' }),
  LOG_LEVEL: str({ default: 'info' }),
})
