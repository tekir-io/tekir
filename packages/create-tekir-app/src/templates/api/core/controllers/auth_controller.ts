import { Controller, Get, Post, Middleware } from '@tekir/http-decorators'
import type { HttpContext } from '@tekir/core'
import { authenticate } from '@tekir/auth'
import { validate } from '@tekir/validator'
import { User } from '~/models/user'
import { hash } from '#services'
import {
  registerSchema, loginSchema,
  type RegisterBody, type LoginBody,
} from '#validations/auth'

@Controller('/api/auth')
export default class AuthController {
  @Post('/register')
  @Middleware([validate({ body: registerSchema })])
  async register({ body, response, auth }: HttpContext) {
    const { name, email, password } = body as RegisterBody

    if (await User.exists('email', email)) {
      return response.conflict({ message: 'Email already registered' })
    }

    const user = await User.create({ name, email, password })
    await auth.login(user, 'jwt')
    const { token, expiresAt } = await auth.generate()

    return response.created({
      user: user.toJSON(),
      token: { type: 'bearer', value: token, expiresAt },
    })
  }

  @Post('/login')
  @Middleware([validate({ body: loginSchema })])
  async login({ body, response, auth }: HttpContext) {
    const { email, password } = body as LoginBody

    const user = await User.findBy('email', email)
    if (!user || !(await hash.verify(password, user.password as string))) {
      return response.unauthorized({ message: 'Invalid credentials' })
    }

    await auth.login(user, 'jwt')
    const { token, expiresAt } = await auth.generate()

    return response.ok({
      user: user.toJSON(),
      token: { type: 'bearer', value: token, expiresAt },
    })
  }

  @Post('/logout')
  @Middleware([authenticate('jwt')])
  async logout({ auth, response }: HttpContext) {
    // JWT is stateless: server-side logout is a no-op, the client should
    // discard the token. For revocable tokens, switch to the `api` guard
    // and call `auth.revokeAll()` instead.
    await auth.logout()
    return response.ok({ message: 'Logged out' })
  }

  @Get('/me')
  @Middleware([authenticate(['jwt', 'api'])])
  me({ auth }: HttpContext) {
    return { user: auth.user, guard: auth.guard }
  }
}
