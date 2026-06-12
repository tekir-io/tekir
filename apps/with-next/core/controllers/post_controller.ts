import { Controller, Get, Post, Delete } from '@tekir/http-decorators'
import type { HttpContext } from '@tekir/core'
import { db } from '#services'

@Controller('/api')
export default class PostController {
  @Get('/posts')
  async list() {
    return await db.query('SELECT * FROM posts')
  }

  @Get('/posts/:id')
  async show(ctx: HttpContext) {
    const post = await db.queryOne('SELECT * FROM posts WHERE id = ?', [ctx.params.id])
    if (!post) return ctx.response.notFound({ error: 'Not found' })
    return post
  }

  @Post('/posts')
  async create(ctx: HttpContext) {
    await db.run('INSERT INTO posts (title, content) VALUES (?, ?)', [ctx.body.title, ctx.body.content || ''])
    return await db.queryOne('SELECT * FROM posts ORDER BY id DESC LIMIT 1')
  }

  @Delete('/posts/:id')
  async remove(ctx: HttpContext) {
    await db.run('DELETE FROM posts WHERE id = ?', [ctx.params.id])
    return { deleted: true }
  }
}
