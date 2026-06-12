import { useState, useEffect } from 'react'

interface Todo { id: number; title: string; done: number }

export default function App() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [title, setTitle] = useState('')

  const load = () => fetch('/api/todos').then(r => r.json()).then(setTodos)
  useEffect(() => { load() }, [])

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    await fetch('/api/todos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) })
    setTitle('')
    load()
  }

  const toggle = async (t: Todo) => {
    await fetch(`/api/todos/${t.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done: !t.done }) })
    load()
  }

  const remove = async (id: number) => {
    await fetch(`/api/todos/${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <div className="container">
      <h1>tekir + Bun Todo</h1>
      <form onSubmit={add}>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="New todo..." />
        <button type="submit">Add</button>
      </form>
      <ul>
        {todos.map(t => (
          <li key={t.id}>
            <input type="checkbox" checked={!!t.done} onChange={() => toggle(t)} />
            <span className={t.done ? 'done' : ''}>{t.title}</span>
            <button className="delete" onClick={() => remove(t.id)}>x</button>
          </li>
        ))}
      </ul>
      {!todos.length && <p style={{ color: '#999' }}>No todos yet</p>}
    </div>
  )
}
