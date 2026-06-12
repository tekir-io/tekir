import { defineEnv, str, port } from '@tekir/env'

export default defineEnv({
  NODE_ENV: str({ choices: ['development', 'production', 'test'], default: 'development' }),
  PORT: port({ default: 4007 }),
  APP_NAME: str({ default: 'tekir Handlebars Demo' }),
})
