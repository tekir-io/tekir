import type { CorsConfig } from '@tekir/cors'

export default {
  enabled: true,
  origin: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  headers: true,
  credentials: true,
  maxAge: 86400,
} satisfies CorsConfig
