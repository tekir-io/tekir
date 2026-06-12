import type { GetServerSideProps } from 'next'

interface Post {
  id: number
  title: string
  content: string
  created_at: string
}

export const getServerSideProps: GetServerSideProps = async () => {
  const res = await fetch('http://localhost:3000/api/posts')
  const posts = await res.json()
  return { props: { posts } }
}

export default function Home({ posts }: { posts: Post[] }) {
  return (
    <div style={{ maxWidth: 600, margin: '40px auto', padding: '0 20px', fontFamily: 'system-ui' }}>
      <h1>tekir + Next.js Blog</h1>
      <p style={{ color: '#666' }}>Posts served by tekir API, rendered by Next.js SSR</p>

      {posts.map((post) => (
        <article key={post.id} style={{ padding: '16px 0', borderBottom: '1px solid #eee' }}>
          <h2 style={{ margin: 0 }}>{post.title}</h2>
          <p style={{ color: '#444' }}>{post.content}</p>
          <small style={{ color: '#999' }}>{post.created_at}</small>
        </article>
      ))}

      {posts.length === 0 && <p style={{ color: '#999' }}>No posts yet</p>}

      <div style={{ marginTop: 24, padding: 16, background: '#f5f5f5', borderRadius: 8 }}>
        <p style={{ margin: 0 }}>
          API: <a href="/docs">/docs</a> | Posts: <a href="/api/posts">/api/posts</a>
        </p>
      </div>
    </div>
  )
}
