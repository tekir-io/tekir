import env from '#env'

export default {
  name: env.APP_NAME,
  key: env.APP_KEY,
  port: env.PORT,
  env: env.NODE_ENV,
}
