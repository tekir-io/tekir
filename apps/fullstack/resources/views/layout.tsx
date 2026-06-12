import type { ReactNode } from 'react'

export function Layout({ title, children, flash }: { title: string; children: ReactNode; flash?: any }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <style dangerouslySetInnerHTML={{ __html: `
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: system-ui, -apple-system, sans-serif; color: #1a1a2e; background: #f8fafc; }
          .container { max-width: 960px; margin: 0 auto; padding: 0 20px; }
          nav { background: #1a1a2e; padding: 16px 0; }
          nav .container { display: flex; align-items: center; justify-content: space-between; }
          nav a { color: #e2e8f0; text-decoration: none; margin-left: 20px; font-size: 14px; }
          nav a:hover { color: #818cf8; }
          nav .brand { color: #818cf8; font-weight: 700; font-size: 18px; }
          main { padding: 32px 0; }
          h1 { margin-bottom: 16px; color: #1a1a2e; }
          h2 { margin: 24px 0 12px; color: #334155; }
          .card { background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 12px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
          .badge { display: inline-block; padding: 2px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
          .badge-admin { background: #fef3c7; color: #92400e; }
          .badge-user { background: #dbeafe; color: #1e40af; }
          .badge-published { background: #d1fae5; color: #065f46; }
          .badge-draft { background: #f3f4f6; color: #6b7280; }
          .flash { padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; }
          .flash-success { background: #d1fae5; color: #065f46; border: 1px solid #a7f3d0; }
          .flash-error { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
          .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #e2e8f0; }
          th { background: #f1f5f9; font-size: 13px; text-transform: uppercase; color: #64748b; }
          .btn { display: inline-block; padding: 8px 16px; border-radius: 8px; font-size: 14px; text-decoration: none; cursor: pointer; border: none; }
          .btn-primary { background: #6366f1; color: white; }
          .btn-danger { background: #E8722A; color: white; }
          .btn-sm { padding: 4px 10px; font-size: 12px; }
          .text-muted { color: #94a3b8; font-size: 13px; }
          .stat { text-align: center; }
          .stat-value { font-size: 36px; font-weight: 700; color: #6366f1; }
          .stat-label { font-size: 13px; color: #64748b; margin-top: 4px; }
        `}} />
      </head>
      <body>
        <nav>
          <div className="container">
            <span className="brand">tekir</span>
            <div>
              <a href="/">Home</a>
              <a href="/dashboard">Dashboard</a>
              <a href="/users">Users</a>
              <a href="/posts">Posts</a>
              <a href="/login">Login</a>
            </div>
          </div>
        </nav>
        <main>
          <div className="container">
            {flash?.success && <div className="flash flash-success">{flash.success}</div>}
            {flash?.error && <div className="flash flash-error">{flash.error}</div>}
            {children}
          </div>
        </main>
      </body>
    </html>
  )
}
