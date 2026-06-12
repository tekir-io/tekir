import { useState, useEffect } from 'react'

interface Post {
  id: number
  title: string
  content: string
  created_at: string
}

export default function Home() {
  const [posts, setPosts] = useState<Post[]>([])
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')

  const fetchPosts = async () => {
    const res = await fetch('/api/posts')
    setPosts(await res.json())
  }

  useEffect(() => { fetchPosts() }, [])

  const addPost = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    await fetch('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content }),
    })
    setTitle('')
    setContent('')
    fetchPosts()
  }

  const deletePost = async (id: number) => {
    await fetch(`/api/posts/${id}`, { method: 'DELETE' })
    fetchPosts()
  }

  return (
    <div style={{ maxWidth: 600, margin: '40px auto', padding: '0 20px' }}>
      <h1>My App</h1>
      <p style={{ color: '#666' }}>tekir API + Next.js SSR</p>

      <form onSubmit={addPost} style={{ marginBottom: 24 }}>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Post title..."
          style={{ display: 'block', width: '100%', padding: 8, marginBottom: 8, borderRadius: 4, border: '1px solid #ccc' }}
        />
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="Content..."
          rows={3}
          style={{ display: 'block', width: '100%', padding: 8, marginBottom: 8, borderRadius: 4, border: '1px solid #ccc' }}
        />
        <button type="submit" style={{ padding: '8px 16px' }}>Create Post</button>
      </form>

      {posts.map((post) => (
        <article key={post.id} style={{ padding: '16px 0', borderBottom: '1px solid #eee' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>{post.title}</h2>
            <button onClick={() => deletePost(post.id)} style={{ color: 'red', border: 'none', cursor: 'pointer' }}>Delete</button>
          </div>
          <p style={{ color: '#444' }}>{post.content}</p>
          <small style={{ color: '#999' }}>{post.created_at}</small>
        </article>
      ))}

      {posts.length === 0 && <p style={{ color: '#999' }}>No posts yet. Create one above.</p>}

      <div style={{ marginTop: 24, padding: 16, background: '#f5f5f5', borderRadius: 8 }}>
        <p style={{ margin: 0 }}>
          API Docs: <a href="/docs">/docs</a>
        </p>
      </div>
    </div>
  )
}
