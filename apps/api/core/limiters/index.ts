import { limiter } from '@tekir/limiter'

export const registerLimiter = limiter({ max: 10, window: 60, by: 'ip', keyPrefix: 'auth:register' })
export const loginLimiter = limiter({ max: 10, window: 60, by: 'ip', keyPrefix: 'auth:login' })
export const writeLimiter = limiter({ max: 30, window: 60, by: 'user', keyPrefix: 'write' })
export const uploadLimiter = limiter({ max: 20, window: 60, by: 'user', keyPrefix: 'upload' })
export const healthLimiter = limiter({ max: 60, window: 60, by: 'ip', keyPrefix: 'health' })
