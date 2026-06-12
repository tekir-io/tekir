import { Post } from '~/models/post'

export async function run() {
  if ((await Post.count()) > 0) return

  await Post.createMany([
    { title: 'Getting Started with tekir', body: 'tekir is a Bun-native framework...', userId: 1, status: 'published' },
    { title: 'Building APIs', body: 'Learn how to build REST APIs...', userId: 1, status: 'published' },
    { title: 'Draft Post', body: 'This is still a draft...', userId: 2, status: 'draft' },
  ])
}
