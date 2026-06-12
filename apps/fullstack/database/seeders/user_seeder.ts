import { User } from '~/models/user'

export async function run() {
  if ((await User.count()) > 0) return

  await User.createMany([
    { name: 'Ali', email: 'ali@tekir.dev', role: 'admin', password: 'hashed' },
    { name: 'Veli', email: 'veli@tekir.dev', role: 'user', password: 'hashed' },
    { name: 'Ayse', email: 'ayse@tekir.dev', role: 'user', password: 'hashed' },
  ])
}
