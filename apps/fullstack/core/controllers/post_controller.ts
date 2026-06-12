import { Controller, Get, Post as HttpPost, Delete, Middleware } from '@tekir/http-decorators'
import type { HttpContext } from '@tekir/core'
import { validate } from '@tekir/validator'
import { limiter } from '@tekir/limiter'
import { z } from 'zod'
import { Post } from '~/models/post'

const createPostSchema = z.object({
  title: z.string().min(3).max(200),
  body: z.string().min(10),
  userId: z.number().int().positive(),
  status: z.enum(['draft', 'published']).default('draft'),
})

@Controller('/api/posts')
export class PostController {
  @Get('/')
  @Middleware([limiter({ max: 60, window: 60 })])
  async index({ response }: HttpContext) {
    const posts = await Post.all()
    return response.ok(posts.map(p => p.toJSON()))
  }

  @HttpPost('/')
  @Middleware([validate({ body: createPostSchema })])
  async store({ body, response }: HttpContext) {
    const post = await Post.create(body)
    return response.created(post.toJSON())
  }

  @Get('/:id', { where: { id: { match: /^\d+$/, cast: Number } } })
  async show({ params, response }: HttpContext) {
    try {
      const post = await Post.findOrFail(Number(params.id))

      return response.ok(post.toJSON())
    } catch {
      return response.notFound({ message: 'Post not found' })
    }
  }

  @Delete('/:id', { where: { id: { match: /^\d+$/, cast: Number } } })
  async destroy({ params, response }: HttpContext) {
    await Post.destroy(Number(params.id))
    return response.noContent()
  }
}
