import type { TekirApp, HttpContext } from '@tekir/core'
import { view, db, hash } from '#services'

interface UserRow { id: number; name: string; email: string; password: string; role: string }

export default async function({ router }: TekirApp) {
  async function getUser(session: HttpContext['session']): Promise<UserRow | null> {
    const userId = session.get<number>('user_id')
    if (!userId) return null
    return await db.queryOne<UserRow>('SELECT id, name, email, role FROM users WHERE id = ?', [userId])
  }

  router.get('/', async ({ session }: HttpContext) => {
    const user = await getUser(session)
    const users = (await db.queryOne<{ c: number }>('SELECT COUNT(*) as c FROM users'))!.c
    const posts = (await db.queryOne<{ c: number }>('SELECT COUNT(*) as c FROM posts'))!.c
    return view.render('pages/home', { title: 'Home', stats: { users, posts }, user })
  })

  router.get('/users', async ({ session }: HttpContext) => {
    const user = await getUser(session)
    const users = await db.query('SELECT * FROM users ORDER BY id')
    return view.render('pages/users', { title: 'Users', users, user })
  })

  router.get('/posts', async ({ session }: HttpContext) => {
    const user = await getUser(session)
    const flash = session.getFlash<string>('success')
    const posts = await db.query('SELECT * FROM posts ORDER BY id DESC')
    return view.render('pages/posts', { title: 'Posts', posts, flash, user })
  })

  router.get('/posts/new', async ({ session }: HttpContext) => {
    const user = await getUser(session)
    if (!user) return Response.redirect('/login', 302)
    return view.render('pages/new-post', { title: 'New Post', user })
  })

  router.post('/posts', async ({ body, session }: HttpContext) => {
    const user = await getUser(session)
    if (!user) return Response.redirect('/login', 302)
    await db.run('INSERT INTO posts (title, body, status, user_id) VALUES (?, ?, ?, ?)', [body.title, body.body, 'published', user.id])
    session.flash('success', 'Post created successfully!')
    return Response.redirect('/posts', 303)
  })

  router.get('/login', async ({ session }: HttpContext) => {
    if (await getUser(session)) return Response.redirect('/dashboard', 302)
    return view.render('pages/login', { title: 'Login' })
  })

  router.post('/login', async ({ body, session }: HttpContext) => {
    const user = await db.queryOne<UserRow>('SELECT * FROM users WHERE email = ?', [body.email])
    if (!user || !(await hash.verify(String(body.password), user.password))) {
      return view.render('pages/login', { title: 'Login', error: 'Invalid email or password' })
    }
    await session.regenerate()
    session.put('user_id', user.id)
    session.flash('success', `Welcome back, ${user.name}!`)
    return Response.redirect('/dashboard', 303)
  })

  router.get('/register', async ({ session }: HttpContext) => {
    if (await getUser(session)) return Response.redirect('/dashboard', 302)
    return view.render('pages/register', { title: 'Register' })
  })

  router.post('/register', async ({ body, session }: HttpContext) => {
    const existing = await db.queryOne('SELECT id FROM users WHERE email = ?', [body.email])
    if (existing) {
      return view.render('pages/register', { title: 'Register', error: 'Email already registered' })
    }
    const pw = await hash.make(String(body.password))
    await db.run('INSERT INTO users (name, email, password) VALUES (?, ?, ?)', [body.name, body.email, pw])
    const user = await db.queryOne<UserRow>('SELECT * FROM users WHERE email = ?', [body.email])
    await session.regenerate()
    session.put('user_id', user!.id)
    session.flash('success', `Welcome, ${user!.name}!`)
    return Response.redirect('/dashboard', 303)
  })

  router.get('/dashboard', async ({ session }: HttpContext) => {
    const user = await getUser(session)
    if (!user) return Response.redirect('/login', 302)
    const flash = session.getFlash<string>('success')
    const posts = await db.query('SELECT * FROM posts WHERE user_id = ? ORDER BY id DESC', [user.id])
    return view.render('pages/dashboard', { title: 'Dashboard', user, flash, posts })
  })

  router.post('/logout', async ({ session }: HttpContext) => {
    session.forget('user_id')
    await session.regenerate()
    return Response.redirect('/', 303)
  })
}
