import type { HashConfig } from '@tekir/hash'

export default {
  default: 'bcrypt',
  bcrypt: { rounds: 10 },
} satisfies HashConfig
