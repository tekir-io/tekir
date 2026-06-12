import { Layout } from './layout'

export function HomePage({ stats }: { stats: { users: number; posts: number; published: number } }) {
  return (
    <Layout title="tekir Fullstack Demo">
      <h1>Welcome to tekir Framework</h1>
      <p style={{ marginBottom: '24px', color: '#64748b' }}>
        A Bun-native web framework with Elysia-level performance and AdonisJS-style DX.
      </p>
      <div className="grid">
        <div className="card stat">
          <div className="stat-value">{stats.users}</div>
          <div className="stat-label">Users</div>
        </div>
        <div className="card stat">
          <div className="stat-value">{stats.posts}</div>
          <div className="stat-label">Total Posts</div>
        </div>
        <div className="card stat">
          <div className="stat-value">{stats.published}</div>
          <div className="stat-label">Published</div>
        </div>
      </div>
      <h2>Packages Used</h2>
      <div className="card">
        <table>
          <thead><tr><th>Package</th><th>Feature</th></tr></thead>
          <tbody>
            <tr><td>@tekir/core</td><td>Server, Router, App, Exceptions, SSE</td></tr>
            <tr><td>@tekir/decorators</td><td>@Controller, @Get, @Post, @Middleware</td></tr>
            <tr><td>@tekir/env</td><td>Environment validation (envalid)</td></tr>
            <tr><td>@tekir/config</td><td>Config loader (dot-notation)</td></tr>
            <tr><td>@tekir/logger</td><td>Pino-style structured logging</td></tr>
            <tr><td>@tekir/cors</td><td>CORS middleware</td></tr>
            <tr><td>@tekir/validator</td><td>Zod validation middleware</td></tr>
            <tr><td>@tekir/auth</td><td>Guard system (AccessToken)</td></tr>
            <tr><td>@tekir/limiter</td><td>Rate limiting (Memory store)</td></tr>
            <tr><td>@tekir/cache</td><td>Cache manager (Memory store)</td></tr>
            <tr><td>@tekir/session</td><td>Session middleware (Memory store)</td></tr>
            <tr><td>@tekir/db</td><td>Drizzle ORM + bun:sqlite</td></tr>
            <tr><td>@tekir/view</td><td>React SSR streaming</td></tr>
          </tbody>
        </table>
      </div>
    </Layout>
  )
}

export function UsersPage({ users }: { users: any[] }) {
  return (
    <Layout title="Users">
      <h1>Users</h1>
      <div className="card">
        <table>
          <thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Role</th><th>Joined</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.id}</td>
                <td><strong>{u.name}</strong></td>
                <td>{u.email}</td>
                <td><span className={`badge badge-${u.role}`}>{u.role}</span></td>
                <td className="text-muted">{new Date(u.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  )
}

export function PostsPage({ posts }: { posts: any[] }) {
  return (
    <Layout title="Posts">
      <h1>Posts</h1>
      <div className="grid">
        {posts.map((p) => (
          <div className="card" key={p.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <strong>{p.title}</strong>
              <span className={`badge badge-${p.status}`}>{p.status}</span>
            </div>
            <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '8px' }}>{p.body.substring(0, 100)}...</p>
            <span className="text-muted">by User #{p.userId}</span>
          </div>
        ))}
      </div>
    </Layout>
  )
}

export function DashboardPage({ user, recentPosts, cache }: { user: any; recentPosts: any[]; cache: { hit: boolean; key: string } }) {
  return (
    <Layout title="Dashboard">
      <h1>Dashboard</h1>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Welcome, {user.name}</h2>
        <p>Role: <span className={`badge badge-${user.role}`}>{user.role}</span></p>
        <p className="text-muted">Cache: {cache.hit ? 'HIT' : 'MISS'} ({cache.key})</p>
      </div>
      <h2>Your Recent Posts</h2>
      {recentPosts.length === 0 ? (
        <div className="card"><p className="text-muted">No posts yet.</p></div>
      ) : (
        recentPosts.map((p) => (
          <div className="card" key={p.id}>
            <strong>{p.title}</strong>
            <span className={`badge badge-${p.status}`} style={{ marginLeft: '8px' }}>{p.status}</span>
          </div>
        ))
      )}
    </Layout>
  )
}

export function LoginPage({ error }: { error?: string }) {
  return (
    <Layout title="Login">
      <h1>Login</h1>
      {error && <div className="flash flash-error">{error}</div>}
      <div className="card" style={{ maxWidth: '400px' }}>
        <form method="POST" action="/login">
          <label>Email</label>
          <input type="email" name="email" placeholder="ali@tekir.dev" required style={{ display: 'block', width: '100%', padding: '8px 12px', margin: '8px 0', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '14px' }} />
          <label>Password</label>
          <input type="password" name="password" placeholder="secret" required style={{ display: 'block', width: '100%', padding: '8px 12px', margin: '8px 0', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '14px' }} />
          <button type="submit" className="btn btn-primary" style={{ marginTop: '12px', width: '100%' }}>Login</button>
        </form>
        <p className="text-muted" style={{ marginTop: '12px' }}>Don't have an account? <a href="/register">Register</a></p>
      </div>
    </Layout>
  )
}

export function RegisterPage({ error }: { error?: string }) {
  return (
    <Layout title="Register">
      <h1>Register</h1>
      {error && <div className="flash flash-error">{error}</div>}
      <div className="card" style={{ maxWidth: '400px' }}>
        <form method="POST" action="/register">
          <label>Name</label>
          <input type="text" name="name" placeholder="Ali" required style={{ display: 'block', width: '100%', padding: '8px 12px', margin: '8px 0', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '14px' }} />
          <label>Email</label>
          <input type="email" name="email" placeholder="ali@tekir.dev" required style={{ display: 'block', width: '100%', padding: '8px 12px', margin: '8px 0', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '14px' }} />
          <label>Password</label>
          <input type="password" name="password" placeholder="Min 6 characters" required minLength={6} style={{ display: 'block', width: '100%', padding: '8px 12px', margin: '8px 0', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '14px' }} />
          <button type="submit" className="btn btn-primary" style={{ marginTop: '12px', width: '100%' }}>Register</button>
        </form>
        <p className="text-muted" style={{ marginTop: '12px' }}>Already have an account? <a href="/login">Login</a></p>
      </div>
    </Layout>
  )
}

export function NotFoundPage() {
  return (
    <Layout title="404 Not Found">
      <div style={{ textAlign: 'center', padding: '60px 0' }}>
        <div style={{ fontSize: '72px', fontWeight: 700, color: '#6366f1' }}>404</div>
        <p style={{ fontSize: '18px', color: '#64748b' }}>Page not found</p>
        <a href="/" className="btn btn-primary" style={{ marginTop: '16px' }}>Go Home</a>
      </div>
    </Layout>
  )
}
