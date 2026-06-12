import { Controller, Get } from '@tekir/http-decorators'
import type { HttpContext } from '@tekir/core'
import { view, cache } from '#services'
import { User } from '~/models/user'
import { Post } from '~/models/post'
import { HomePage, UsersPage, PostsPage, DashboardPage } from '#resources/views/pages'

@Controller('')
export class ViewController {
  @Get('/')
  async home({ session }: HttpContext) {
    const flash = { success: session.getFlash<string>('success') }
    const stats = await cache.getOrSet('home:stats', 30, async () => ({
      users: await User.count(),
      posts: await Post.count(),
      published: await Post.countBy('status', 'published'),
    }))
    return view.render(HomePage, { stats, flash })
  }

  @Get('/users')
  async users() {
    const users = await User.all()
    return view.render(UsersPage, { users: users.map(u => u.toJSON()) })
  }

  @Get('/posts')
  async posts({ session }: HttpContext) {
    const flash = { success: session.getFlash<string>('success') }
    const posts = await Post.all()
    return view.render(PostsPage, { posts: posts.map(p => p.toJSON()), flash })
  }

  @Get('/dashboard')
  async dashboard({ session }: HttpContext) {
    const userId = session.get<number>('user_id')
    if (!userId) return Response.redirect('/login', 302)
    const flash = { success: session.getFlash<string>('success') }
    const user = await User.find(userId)
    if (!user) return Response.redirect('/login', 302)
    const data = await Post.findManyBy('userId', user.id)
    return view.render(DashboardPage, {
      user: user.toJSON(),
      recentPosts: data.map((p: any) => p.toJSON ? p.toJSON() : p),
      cache: { hit: false, key: '' },
      flash,
    })
  }
}
