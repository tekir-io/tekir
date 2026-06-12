import { Controller, Get, Post, Middleware } from '@tekir/http-decorators'
import type { HttpContext } from '@tekir/core'
import { validate } from '@tekir/validator'
import { authenticate } from '@tekir/auth'
import { z } from 'zod'
import { User } from '~/models/user'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
})

@Controller('/api/auth')
export class AuthController {
  @Post('/register')
  @Middleware([validate({ body: registerSchema })])
  async register(ctx: HttpContext) {
    const { body, response } = ctx
    if (await User.exists('email', body.email)) {
      return response.conflict({ message: 'Email already registered' })
    }

    const user = await User.create(body)
    await ctx.auth.login(user, 'jwt')
    const { token, expiresAt } = await ctx.auth.generate()

    return response.created({
      user: user.toJSON(),
      token: { type: 'bearer', value: token, expiresAt },
    })
  }

  @Post('/login')
  @Middleware([validate({ body: loginSchema })])
  async doLogin(ctx: HttpContext) {
    const { body, response } = ctx
    const user = await User.findBy('email', body.email)
    if (!user || user.password !== body.password) {
      return response.unauthorized({ message: 'Invalid credentials' })
    }

    await ctx.auth.login(user, 'jwt')
    const { token, expiresAt } = await ctx.auth.generate()

    return response.ok({
      user: user.toJSON(),
      token: { type: 'bearer', value: token, expiresAt },
    })
  }

  @Post('/token')
  @Middleware([authenticate('jwt')])
  async createToken({ auth, body, response }: HttpContext) {
    const { token, id } = await auth.generate({
      name: String(body?.name || 'API Token'),
      expiresIn: Number(body?.expiresIn || 30 * 86400),
    })
    return response.created({ token, id, message: 'Store this token securely.' })
  }

  @Get('/tokens')
  @Middleware([authenticate('jwt')])
  async listTokens({ auth, response }: HttpContext) {
    return response.ok(await auth.list())
  }

  @Post('/logout')
  @Middleware([authenticate('jwt')])
  async logout({ auth, response }: HttpContext) {
    await auth.revokeAll()
    return response.ok({ message: 'All tokens revoked' })
  }

  @Get('/me')
  @Middleware([authenticate(['jwt', 'api'])])
  me({ auth }: HttpContext) {
    return { user: auth.user, guard: auth.guard }
  }
}
