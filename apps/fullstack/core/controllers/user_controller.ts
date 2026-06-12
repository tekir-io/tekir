import { Controller, Get, Post, Middleware } from '@tekir/http-decorators'
import type { HttpContext } from '@tekir/core'
import { validate } from '@tekir/validator'
import { z } from 'zod'
import { User } from '~/models/user'

const createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['user', 'admin']).default('user'),
})

@Controller('/api/users')
export class UserController {
  @Get('/')
  async index({ response }: HttpContext) {
    const users = await User.all()
    return response.ok(users.map(u => u.toJSON()))
  }

  @Get('/:id', { where: { id: { match: /^\d+$/, cast: Number } } })
  async show({ params, response }: HttpContext) {
    const user = await User.find(Number(params.id))
    if (!user) return response.notFound({ message: 'User not found' })
    return response.ok(user.toJSON())
  }

  @Post('/')
  @Middleware([validate({ body: createUserSchema })])
  async store({ body, response }: HttpContext) {
    const user = await User.create(body)
    return response.created(user.toJSON())
  }
}
