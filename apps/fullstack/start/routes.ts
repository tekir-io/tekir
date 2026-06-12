import type { TekirApp, HttpContext } from '@tekir/core'
import { service } from '@tekir/core'
import type { Hash } from '@tekir/hash'
import { ViewController } from '~/controllers/view_controller'
import { UserController } from '~/controllers/user_controller'
import { PostController } from '~/controllers/post_controller'
import { ApiController } from '~/controllers/api_controller'
import { AuthController } from '~/controllers/auth_controller'
import { LoginPage, RegisterPage } from '#resources/views/pages'
import { User } from '~/models/user'
import { view } from '#services'

const hash = service<Hash>('hash')

export default async function({ router }: TekirApp) {
  router.register(ViewController, UserController, PostController, ApiController, AuthController)

  router.get('/login', async ({ session }: HttpContext) => {
    if (session.get('user_id')) return Response.redirect('/dashboard', 302)
    return view.render(LoginPage, {})
  })

  router.post('/login', async ({ body, session }: HttpContext) => {
    const user = await User.findBy('email', String(body.email))
    if (!user || !(await hash.verify(String(body.password), user.password))) {
      return view.render(LoginPage, { error: 'Invalid email or password' })
    }
    await session.regenerate()
    session.put('user_id', user.id)
    session.flash('success', `Welcome back, ${user.name}!`)
    return Response.redirect('/dashboard', 303)
  })

  router.get('/register', async ({ session }: HttpContext) => {
    if (session.get('user_id')) return Response.redirect('/dashboard', 302)
    return view.render(RegisterPage, {})
  })

  router.post('/register', async ({ body, session }: HttpContext) => {
    if (await User.exists('email', String(body.email))) {
      return view.render(RegisterPage, { error: 'Email already registered' })
    }
    const pw = await hash.make(String(body.password))
    const user = await User.create({ name: body.name, email: body.email, password: pw, role: 'user' })
    await session.regenerate()
    session.put('user_id', user.id)
    session.flash('success', `Welcome, ${user.name}!`)
    return Response.redirect('/dashboard', 303)
  })

  router.post('/logout', async ({ session }: HttpContext) => {
    session.forget('user_id')
    await session.regenerate()
    return Response.redirect('/', 303)
  })
}
