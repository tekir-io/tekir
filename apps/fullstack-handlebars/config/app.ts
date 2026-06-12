import env from '#env'

export default {
  name: env.APP_NAME,
  port: env.PORT,
  env: env.NODE_ENV,
}
