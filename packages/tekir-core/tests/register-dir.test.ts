import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Router } from '../src/router/router'

describe('Router.registerDir', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'tekir-regdir-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  test('registers decorator-style controllers (with __prefix + __routes)', async () => {
    // Mimic what `@Controller('/users')` + `@Get('/')` would produce.
    writeFileSync(
      join(tmp, 'users.ts'),
      `
class UsersController {
  list() { return [] }
}
UsersController.__prefix = ['/users']
UsersController.__routes = [{ method: 'GET', path: '/', methodName: 'list', options: {} }]
export default UsersController
`,
    )

    const router = new Router()
    await router.registerDir(tmp)
    router.compile()

    const match = router.match('GET', '/users')
    expect(match).not.toBeNull()
    expect(match!.route.pattern).toBe('/users')
  })

  test('invokes a functional registrar with the router instance', async () => {
    writeFileSync(
      join(tmp, 'health.ts'),
      `export default (router) => router.get('/health', () => ({ ok: true }))`,
    )

    const router = new Router()
    await router.registerDir(tmp)
    router.compile()

    expect(router.match('GET', '/health')).not.toBeNull()
  })

  test('uses a class with a register(router) method', async () => {
    writeFileSync(
      join(tmp, 'admin.ts'),
      `
export default class AdminController {
  register(router) {
    router.get('/admin', () => ({ admin: true }))
  }
}
`,
    )

    const router = new Router()
    await router.registerDir(tmp)
    router.compile()

    expect(router.match('GET', '/admin')).not.toBeNull()
  })

  test('uses a plain object with a register method', async () => {
    writeFileSync(
      join(tmp, 'docs.ts'),
      `export default {
  register(router) { router.get('/docs', () => 'docs') }
}`,
    )

    const router = new Router()
    await router.registerDir(tmp)
    router.compile()

    expect(router.match('GET', '/docs')).not.toBeNull()
  })

  test('skips files with unrecognized export shapes and logs a warning', async () => {
    writeFileSync(join(tmp, 'config.ts'), `export default { name: 'no-router-here' }`)

    const router = new Router()
    const original = console.warn
    let warned = ''
    console.warn = (msg: string) => { warned = msg }
    try {
      await router.registerDir(tmp)
    } finally {
      console.warn = original
    }

    expect(warned).toContain('registerDir')
    expect(warned).toContain('unrecognized')
  })

  test('handles named-export decorator class without an explicit pick', async () => {
    // Real-world pattern: `export class FooController` with @Controller
    // metadata, no `export default`. Used to need a manual `pick`; now
    // the default loader sees the single named export and forwards it.
    writeFileSync(
      join(tmp, 'users.ts'),
      `
class UsersController {
  list() { return [] }
}
UsersController.__prefix = ['/users']
UsersController.__routes = [{ method: 'GET', path: '/', methodName: 'list', options: {} }]
export { UsersController }
`,
    )

    const router = new Router()
    await router.registerDir(tmp)
    router.compile()

    expect(router.match('GET', '/users')).not.toBeNull()
  })

  test('warns once with an inliner hint when zero modules are loaded', async () => {
    // Empty directory (no controllers) — typical "production bundle ran but
    // the AST inliner did not transform the call" scenario. The warning
    // points the user at the missing plugin.
    const router = new Router()
    const original = console.warn
    let warned = ''
    console.warn = (msg: string) => { warned += msg + '\n' }
    try {
      await router.registerDir(tmp)
    } finally {
      console.warn = original
    }

    expect(warned).toContain('No modules loaded from')
    expect(warned).toContain('createInlinerPlugin')
    expect(warned).toContain('--compile')
  })

  test('warning includes the source file path on unrecognized exports', async () => {
    writeFileSync(join(tmp, 'config.ts'), `export default { name: 'no-router-here' }`)

    const router = new Router()
    const original = console.warn
    let warned = ''
    console.warn = (msg: string) => { warned = msg }
    try {
      await router.registerDir(tmp)
    } finally {
      console.warn = original
    }

    expect(warned).toContain('config.ts')
    expect(warned).toContain('skipped')
  })

  test('mixes patterns in the same directory', async () => {
    writeFileSync(
      join(tmp, 'a-decorator.ts'),
      `
class A {}
A.__prefix = ['/a']
A.__routes = []
export default A
`,
    )
    writeFileSync(
      join(tmp, 'b-functional.ts'),
      `export default (router) => router.get('/b', () => 'b')`,
    )
    writeFileSync(
      join(tmp, 'c-class-method.ts'),
      `export default class C { register(r) { r.get('/c', () => 'c') } }`,
    )

    const router = new Router()
    await router.registerDir(tmp)
    router.compile()

    expect(router.match('GET', '/b')).not.toBeNull()
    expect(router.match('GET', '/c')).not.toBeNull()
  })
})
