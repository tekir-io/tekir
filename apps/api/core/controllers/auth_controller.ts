import { Controller, Get, Post, Middleware } from '@tekir/http-decorators'
import type { HttpContext } from '@tekir/core'
import { validate } from '@tekir/validator'
import { z } from 'zod'
import { User } from '~/models/user'
import { registerSchema, loginSchema } from '~/validators/auth'
import { registerLimiter, loginLimiter } from '~/limiters'
import { ApiTag, ApiSummary, ApiBody, ApiResponse, ApiBearerAuth } from '@tekir/swagger-decorators'
import { auth, hash } from '#services'

@Controller('/api/auth')
@ApiTag('Auth')
export default class AuthController {
  /**
   * POST /api/auth/register
   * Create a new user account and return a JWT token.
   */
  @Post('/register')
  @ApiSummary('Register a new user account')
  @ApiBody(registerSchema)
  @ApiResponse(201, {
    type: 'object',
    properties: {
      message: { type: 'string' },
      token: { type: 'string' },
      expiresAt: { type: 'string', format: 'date-time' },
      user: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
        },
      },
    },
  })
  @ApiResponse(409, {
    type: 'object',
    properties: { message: { type: 'string' } },
  })
  @Middleware([
    registerLimiter,
    validate({ body: registerSchema }),
  ])
  async register(ctx: HttpContext) {
    const { name, email, password } = ctx.body as z.infer<typeof registerSchema>

    // Check email uniqueness
    const existing = await User.findBy('email', email)
    if (existing) {
      return ctx.response.conflict({ message: 'An account with this email already exists.' })
    }

    // Hash password
    const hashedPassword = await hash.make(password)

    // Create user
    const user = await User.create({ name, email, password: hashedPassword })

    // Generate JWT
    const guard = auth.guard('jwt')
    const { token, expiresAt } = await guard.generate!(user)

    return ctx.response.created({
      message: 'Account created successfully.',
      token,
      expiresAt,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    })
  }

  /**
   * POST /api/auth/login
   * Authenticate a user and return a JWT token.
   */
  @Post('/login')
  @ApiSummary('Log in and obtain a JWT token')
  @ApiBody(loginSchema)
  @ApiResponse(200, {
    type: 'object',
    properties: {
      message: { type: 'string' },
      token: { type: 'string' },
      expiresAt: { type: 'string', format: 'date-time' },
      user: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          role: { type: 'string' },
        },
      },
    },
  })
  @ApiResponse(401, {
    type: 'object',
    properties: { message: { type: 'string' } },
  })
  @Middleware([
    loginLimiter,
    validate({ body: loginSchema }),
  ])
  async login(ctx: HttpContext) {
    const { email, password } = ctx.body as z.infer<typeof loginSchema>

    // Find user by email
    const user = await User.findBy('email', email)
    if (!user) {
      return ctx.response.unauthorized({ message: 'Invalid credentials.' })
    }

    // Verify password
    const isValid = await hash.verify(password, user.password)
    if (!isValid) {
      return ctx.response.unauthorized({ message: 'Invalid credentials.' })
    }

    // Generate JWT
    const guard = auth.guard('jwt')
    const { token, expiresAt } = await guard.generate!(user)

    return ctx.response.ok({
      message: 'Logged in successfully.',
      token,
      expiresAt,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    })
  }

  /**
   * GET /api/auth/me
   * Return the currently authenticated user (protected route).
   */
  @Get('/me')
  @ApiSummary('Get the currently authenticated user')
  @ApiResponse(200, {
    type: 'object',
    properties: {
      user: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          role: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  })
  @ApiBearerAuth()
  @Middleware([auth.middleware()])
  async me(ctx: HttpContext) {
    const user = ctx.auth.user as User

    return ctx.response.ok({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
      },
    })
  }

  /**
   * POST /api/auth/logout
   * Sign out the current user (protected route).
   */
  @Post('/logout')
  @ApiSummary('Log out the current user')
  @ApiResponse(200, {
    type: 'object',
    properties: { message: { type: 'string' } },
  })
  @ApiBearerAuth()
  @Middleware([auth.middleware()])
  async logout(ctx: HttpContext) {
    // Invoke guard-level logout if available (e.g. token revocation)
    if (ctx.auth?.logout) {
      await ctx.auth.logout()
    }

    return ctx.response.ok({ message: 'Logged out successfully.' })
  }
}
