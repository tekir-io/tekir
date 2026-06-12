import { client } from '@tekir/testing'
import { app } from '../server'

app.server.configure({ port: 0 })
app.server.start()

export const request = client(`http://localhost:${app.server.getServer().port}`)
