import env from '#env'

export default {
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  pretty: env.NODE_ENV !== 'production',
  name: env.APP_NAME,
  timestamp: true,
  redact: ['password', 'token', 'secret'],
}
