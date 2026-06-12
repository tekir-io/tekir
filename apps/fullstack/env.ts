import { defineEnv, str, port, num } from '@tekir/env'

export default defineEnv({
  NODE_ENV: str({ choices: ['development', 'production', 'test'], default: 'development' }),
  PORT: port({ default: 3000 }),
  APP_NAME: str({ default: 'tekir App' }),
  APP_KEY: str({ default: 'change-me' }),

  // Database
  DB_DRIVER: str({ choices: ['sqlite', 'postgres', 'mysql'], default: 'sqlite' }),
  DB_PATH: str({ default: ':memory:' }),
  DATABASE_URL: str({ default: '' }),
  DB_HOST: str({ default: 'localhost' }),
  DB_PORT: num({ default: 5432 }),
  DB_USER: str({ default: '' }),
  DB_PASSWORD: str({ default: '' }),
  DB_DATABASE: str({ default: '' }),

  // Redis
  REDIS_URL: str({ default: '' }),
})
