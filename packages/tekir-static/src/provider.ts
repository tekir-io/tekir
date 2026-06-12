import type { App } from '@tekir/core'
import { fileExists, fileResponse, isDirectory } from '@tekir/runtime'
import { resolve } from 'path'
import { resolveSafePath, realPathContained } from './resolver'

export class StaticProvider {
  async boot(app: App) {
    const config = app.use('config')
    const dir = config('static.dir', 'public')
    const dotFiles = config('static.dotFiles', 'ignore') as 'allow' | 'ignore' | 'deny'
    const symlinks = config('static.symlinks', 'follow') as 'follow' | 'deny'
    const server = app.use('server') as any

    server.fallback(async (req: Request) => {
      const url = new URL(req.url)
      if (url.pathname === '/') return null
      const root = resolve(process.cwd(), dir)
      const result = resolveSafePath(url.pathname, root, dotFiles)
      if (!result.ok) {
        if (result.reason === 'malformed') {
          return new Response('{"error":"Bad Request"}', { status: 400, headers: { 'Content-Type': 'application/json' } })
        }
        return null
      }
      const filePath = result.path!
      if (await fileExists(filePath) && !(await isDirectory(filePath))) {
        if (symlinks === 'deny' && !(await realPathContained(filePath, root))) {
          return new Response('{"error":"Not Found"}', { status: 404, headers: { 'Content-Type': 'application/json' } })
        }
        return fileResponse(filePath)
      }
      return new Response('{"error":"Not Found"}', { status: 404, headers: { 'Content-Type': 'application/json' } })
    })
  }
}
