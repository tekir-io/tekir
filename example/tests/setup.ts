import { client } from '@tekir/testing'
import { server } from '../server'

// Random port so tests don't collide with `bun run dev` (which owns 5001).
server.configure({ port: 0 })
server.start()

export const request = client(`http://localhost:${server.getServer().port}`)
