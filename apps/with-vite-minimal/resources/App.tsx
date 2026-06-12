import { useState, useEffect } from 'react'

interface Todo {
  id: number
  title: string
  done: number
}

export default function App() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [title, setTitle] = useState('')

  const fetchTodos = async () => {
    const res = await fetch('/api/todos')
    setTodos(await res.json())
  }

  useEffect(() => { fetchTodos() }, [])

  const addTodo = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    setTitle('')
    fetchTodos()
  }

  const toggleTodo = async (todo: Todo) => {
    await fetch(`/api/todos/${todo.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: !todo.done }),
    })
    fetchTodos()
  }

  const deleteTodo = async (id: number) => {
    await fetch(`/api/todos/${id}`, { method: 'DELETE' })
    fetchTodos()
  }

  return (
    <div style={{ maxWidth: 500, margin: '40px auto', fontFamily: 'system-ui' }}>
      <h1>tekir + Vite adfaasdfasdfasdfsd Todo</h1>
      <form onSubmit={addTodo} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="New todo..."
          style={{ flex: 1, padding: 8, borderRadius: 4, border: '1px solid #ccc' }}
        />
        <button type="submit" style={{ padding: '8px 16px' }}>Add</button>
      </form>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {todos.map(todo => (
          <li key={todo.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid #eee' }}>
            <input type="checkbox" checked={!!todo.done} onChange={() => toggleTodo(todo)} />
            <span style={{ flex: 1, textDecoration: todo.done ? 'line-through' : 'none' }}>{todo.title}</span>
            <button onClick={() => deleteTodo(todo.id)} style={{ color: 'red', border: 'none', cursor: 'pointer' }}>x</button>
          </li>
        ))}
      </ul>
      {todos.length === 0 && <p style={{ color: '#999' }}>No todos yet</p>}
    </div>
  )
}
