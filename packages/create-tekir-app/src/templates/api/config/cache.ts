import type { CacheConfig } from '@tekir/cache'

export default {
  default: 'memory',
  stores: {
    memory: { driver: 'memory' },
  },
  ttl: 60,
} satisfies CacheConfig
