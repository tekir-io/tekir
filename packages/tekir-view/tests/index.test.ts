import { test, expect, describe } from 'bun:test'
import { View, ViewProvider } from '../src/index'
import type { ViewEngine, RenderOptions } from '../src/index'


function makeSyncEngine(html = '<div>hello</div>'): ViewEngine {
  return { render: () => html }
}

function makeAsyncEngine(html = '<div>async</div>'): ViewEngine {
  return { render: () => Promise.resolve(html) }
}

function makeStreamEngine(html = '<div>stream</div>'): ViewEngine {
  return {
    render: () => html,
    renderStream: () =>
      Promise.resolve(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(html))
          controller.close()
        },
      })),
  }
}

function createView(engine: ViewEngine, dir?: string): View {
  const v = new View()
  v.configure(engine, dir)
  return v
}


describe('View', () => {
  test('is a class', () => {
    expect(new View()).toBeInstanceOf(View)
  })

  test('configure sets engine and returns this', () => {
    const v = new View()
    expect(v.configure(makeSyncEngine())).toBe(v)
  })

  test('getEngine returns configured engine', () => {
    const engine = makeSyncEngine()
    const v = createView(engine)
    expect(v.getEngine()).toBe(engine)
  })

  test('getEngine throws when no engine configured', () => {
    expect(() => new View().getEngine()).toThrow('No view engine configured')
  })

  test('getDir returns default resources/views', () => {
    const v = new View()
    expect(v.getDir().replace(/\\/g, '/')).toContain('resources/views')
  })

  test('getDir returns custom dir when configured', () => {
    const v = new View()
    v.configure(makeSyncEngine(), '/custom/views')
    expect(v.getDir()).toBe('/custom/views')
  })

  test('render throws when no engine', async () => {
    const v = new View()
    await expect(v.render('test')).rejects.toThrow('No view engine configured')
  })

  test('renderToHTML throws when no engine', async () => {
    const v = new View()
    await expect(v.renderToHTML('test')).rejects.toThrow('No view engine configured')
  })
})


describe('View.render — sync engine', () => {
  test('returns a Response', async () => {
    const v = createView(makeSyncEngine('<p>sync</p>'))
    const res = await v.render('Comp')
    expect(res).toBeInstanceOf(Response)
  })

  test('default status is 200', async () => {
    const res = await createView(makeSyncEngine()).render('Comp')
    expect(res.status).toBe(200)
  })

  test('sets Content-Type to text/html', async () => {
    const res = await createView(makeSyncEngine()).render('Comp')
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  test('body contains rendered HTML', async () => {
    const res = await createView(makeSyncEngine('<span>world</span>')).render('Comp', {}, { stream: false })
    expect(await res.text()).toBe('<span>world</span>')
  })

  test('respects custom status code', async () => {
    const res = await createView(makeSyncEngine()).render('Comp', {}, { status: 404 })
    expect(res.status).toBe(404)
  })

  test('merges extra headers', async () => {
    const res = await createView(makeSyncEngine()).render('Comp', {}, { headers: { 'X-Custom': 'yes' } })
    expect(res.headers.get('x-custom')).toBe('yes')
  })

  test('status 201', async () => {
    const res = await createView(makeSyncEngine()).render('Comp', {}, { status: 201 })
    expect(res.status).toBe(201)
  })

  test('status 301', async () => {
    const res = await createView(makeSyncEngine()).render('Comp', {}, { status: 301 })
    expect(res.status).toBe(301)
  })

  test('status 500', async () => {
    const res = await createView(makeSyncEngine()).render('Comp', {}, { status: 500 })
    expect(res.status).toBe(500)
  })

  test('custom Content-Type overrides default', async () => {
    const res = await createView(makeSyncEngine()).render('Comp', {}, { headers: { 'Content-Type': 'text/plain' } })
    expect(res.headers.get('content-type')).toBe('text/plain')
  })
})


describe('View.render — async engine', () => {
  test('returns a Response', async () => {
    const res = await createView(makeAsyncEngine()).render('Comp', {}, { stream: false })
    expect(res).toBeInstanceOf(Response)
  })

  test('body is correct', async () => {
    const res = await createView(makeAsyncEngine('<em>async</em>')).render('Comp', {}, { stream: false })
    expect(await res.text()).toBe('<em>async</em>')
  })
})


describe('View.render — stream engine', () => {
  test('uses renderStream by default', async () => {
    let usedStream = false
    const engine: ViewEngine = {
      render: () => '<p>sync</p>',
      renderStream: () => { usedStream = true; return Promise.resolve(new ReadableStream({ start(c) { c.close() } })) },
    }
    await createView(engine).render('Comp')
    expect(usedStream).toBe(true)
  })

  test('stream: false falls back to sync', async () => {
    let usedStream = false
    const engine: ViewEngine = {
      render: () => '<p>sync fallback</p>',
      renderStream: () => { usedStream = true; return Promise.resolve(new ReadableStream({ start(c) { c.close() } })) },
    }
    const res = await createView(engine).render('Comp', {}, { stream: false })
    expect(usedStream).toBe(false)
    expect(await res.text()).toBe('<p>sync fallback</p>')
  })

  test('passes props to renderStream', async () => {
    let receivedProps: any
    const engine: ViewEngine = {
      render: () => '',
      renderStream: (_c, props) => { receivedProps = props; return Promise.resolve(new ReadableStream({ start(c) { c.close() } })) },
    }
    await createView(engine).render('Comp', { id: 42 })
    expect(receivedProps).toEqual({ id: 42 })
  })

  test('stream: true with non-stream engine falls back', async () => {
    const res = await createView(makeSyncEngine('<p>no stream</p>')).render('Comp', {}, { stream: true })
    expect(await res.text()).toBe('<p>no stream</p>')
  })
})


describe('View.renderToHTML', () => {
  test('returns string from sync engine', async () => {
    const html = await createView(makeSyncEngine('<div>str</div>')).renderToHTML('Comp')
    expect(html).toBe('<div>str</div>')
  })

  test('returns string from async engine', async () => {
    const html = await createView(makeAsyncEngine('<div>async</div>')).renderToHTML('Comp')
    expect(html).toBe('<div>async</div>')
  })

  test('returns string not Response', async () => {
    const result = await createView(makeSyncEngine()).renderToHTML('Comp')
    expect(typeof result).toBe('string')
    expect(result).not.toBeInstanceOf(Response)
  })

  test('passes props to engine', async () => {
    let received: any
    const engine: ViewEngine = { render: (_c, props) => { received = props; return '<p>ok</p>' } }
    await createView(engine).renderToHTML('Comp', { name: 'Alice' })
    expect(received).toEqual({ name: 'Alice' })
  })

  test('passes undefined props when omitted', async () => {
    let received: any = 'not-called'
    const engine: ViewEngine = { render: (_c, props) => { received = props; return '<p>ok</p>' } }
    await createView(engine).renderToHTML('Comp')
    expect(received).toBeUndefined()
  })
})


describe('Props passing', () => {
  test('render passes props to sync engine', async () => {
    let captured: any
    const engine: ViewEngine = { render: (_c, props) => { captured = props; return '' } }
    await createView(engine).render('Comp', { title: 'Test', count: 5 }, { stream: false })
    expect(captured).toEqual({ title: 'Test', count: 5 })
  })

  test('render passes props to async engine', async () => {
    let captured: any
    const engine: ViewEngine = { render: (_c, props) => { captured = props; return Promise.resolve('') } }
    await createView(engine).render('Comp', { id: 7 }, { stream: false })
    expect(captured).toEqual({ id: 7 })
  })
})


describe('Engine replacement', () => {
  test('configure replaces previous engine', async () => {
    const v = createView(makeSyncEngine('<p>first</p>'))
    v.configure(makeSyncEngine('<p>second</p>'))
    expect(await v.renderToHTML('Comp')).toBe('<p>second</p>')
  })

  test('reptekirg sync with async works', async () => {
    const v = createView(makeSyncEngine('<p>sync</p>'))
    v.configure(makeAsyncEngine('<p>now async</p>'))
    expect(await v.renderToHTML('Comp')).toBe('<p>now async</p>')
  })
})


describe('Multiple sequential renders', () => {
  test('two renders both call engine', async () => {
    let callCount = 0
    const engine: ViewEngine = { render: () => { callCount++; return '<p>ok</p>' } }
    const v = createView(engine)
    await v.render('Comp', {}, { stream: false })
    await v.render('Comp', {}, { stream: false })
    expect(callCount).toBe(2)
  })
})


describe('RenderOptions', () => {
  test('stream option', () => { const o: RenderOptions = { stream: true }; expect(o.stream).toBe(true) })
  test('status option', () => { const o: RenderOptions = { status: 404 }; expect(o.status).toBe(404) })
  test('headers option', () => { const o: RenderOptions = { headers: { 'X-Foo': 'bar' } }; expect(o.headers!['X-Foo']).toBe('bar') })
})


describe('ViewProvider', () => {
  test('is a class', () => {
    expect(new ViewProvider()).toBeInstanceOf(ViewProvider)
  })

  test('has register method', () => {
    expect(typeof new ViewProvider().register).toBe('function')
  })

  test('does nothing when config("view") is falsy', async () => {
    let instanceCalled = false
    const mockApp = {
      use: () => (k: string) => k === 'view' ? null : null,
      instance: () => { instanceCalled = true },
    }
    await new ViewProvider().register(mockApp as any)
    expect(instanceCalled).toBe(false)
  })

  test('registers view service when engine provided', async () => {
    const engine = makeSyncEngine()
    let registeredKey = ''
    let registeredValue: any = null
    const mockApp = {
      use: () => (k: string) => {
        if (k === 'view') return { engine }
        if (k === 'view.engine') return engine
        if (k === 'view.dir') return undefined
        return null
      },
      instance: (key: string, val: any) => { registeredKey = key; registeredValue = val },
    }
    await new ViewProvider().register(mockApp as any)
    expect(registeredKey).toBe('view')
    expect(registeredValue).toBeInstanceOf(View)
  })
})


describe('View — configure and getDir', () => {
  test('configure with custom dir sets the dir', () => {
    const v = new View()
    v.configure(makeSyncEngine(), '/my/templates')
    expect(v.getDir()).toBe('/my/templates')
  })

  test('configure twice changes dir', () => {
    const v = new View()
    v.configure(makeSyncEngine(), '/first')
    v.configure(makeSyncEngine(), '/second')
    expect(v.getDir()).toBe('/second')
  })

  test('configure without dir uses default', () => {
    const v = new View()
    v.configure(makeSyncEngine())
    expect(v.getDir().replace(/\\/g, '/')).toContain('resources/views')
  })

  test('getEngine returns the latest engine after reconfigure', () => {
    const e1 = makeSyncEngine('<p>first</p>')
    const e2 = makeSyncEngine('<p>second</p>')
    const v = new View()
    v.configure(e1)
    v.configure(e2)
    expect(v.getEngine()).toBe(e2)
  })
})

describe('View.render — status codes', () => {
  test('status 400', async () => {
    const res = await createView(makeSyncEngine()).render('Comp', {}, { status: 400 })
    expect(res.status).toBe(400)
  })

  test('status 403', async () => {
    const res = await createView(makeSyncEngine()).render('Comp', {}, { status: 403 })
    expect(res.status).toBe(403)
  })

  test('status 503', async () => {
    const res = await createView(makeSyncEngine()).render('Comp', {}, { status: 503 })
    expect(res.status).toBe(503)
  })

  test('status 204', async () => {
    const res = await createView(makeSyncEngine()).render('Comp', {}, { status: 204 })
    expect(res.status).toBe(204)
  })

  test('status 302', async () => {
    const res = await createView(makeSyncEngine()).render('Comp', {}, { status: 302 })
    expect(res.status).toBe(302)
  })
})

describe('View.render — headers combinations', () => {
  test('multiple custom headers', async () => {
    const res = await createView(makeSyncEngine()).render('Comp', {}, {
      headers: { 'X-One': '1', 'X-Two': '2', 'X-Three': '3' }
    })
    expect(res.headers.get('x-one')).toBe('1')
    expect(res.headers.get('x-two')).toBe('2')
    expect(res.headers.get('x-three')).toBe('3')
  })

  test('Cache-Control header', async () => {
    const res = await createView(makeSyncEngine()).render('Comp', {}, {
      headers: { 'Cache-Control': 'no-store' }
    })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  test('custom status + custom headers together', async () => {
    const res = await createView(makeSyncEngine()).render('Comp', {}, {
      status: 201, headers: { 'X-Created': 'true' }
    })
    expect(res.status).toBe(201)
    expect(res.headers.get('x-created')).toBe('true')
  })
})

describe('View.render — engine with various HTML', () => {
  test('renders empty HTML', async () => {
    const res = await createView(makeSyncEngine('')).render('Comp', {}, { stream: false })
    expect(await res.text()).toBe('')
  })

  test('renders large HTML', async () => {
    const html = '<div>' + 'x'.repeat(10000) + '</div>'
    const res = await createView(makeSyncEngine(html)).render('Comp', {}, { stream: false })
    expect(await res.text()).toBe(html)
  })

  test('renders HTML with unicode', async () => {
    const html = '<p>こんにちは世界</p>'
    const res = await createView(makeSyncEngine(html)).render('Comp', {}, { stream: false })
    expect(await res.text()).toBe(html)
  })

  test('renders HTML with entities', async () => {
    const html = '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>'
    const res = await createView(makeSyncEngine(html)).render('Comp', {}, { stream: false })
    expect(await res.text()).toBe(html)
  })
})

describe('View.renderToHTML — additional', () => {
  test('returns empty string from empty engine', async () => {
    const html = await createView(makeSyncEngine('')).renderToHTML('Comp')
    expect(html).toBe('')
  })

  test('passes complex props', async () => {
    let received: any
    const engine: ViewEngine = { render: (_c, props) => { received = props; return '' } }
    await createView(engine).renderToHTML('Comp', { nested: { arr: [1, 2, 3] }, flag: true })
    expect(received.nested.arr).toEqual([1, 2, 3])
    expect(received.flag).toBe(true)
  })

  test('component name is passed to engine', async () => {
    let receivedComponent: any
    const engine: ViewEngine = { render: (comp) => { receivedComponent = comp; return '' } }
    await createView(engine).renderToHTML('MyComponent')
    expect(receivedComponent).toBe('MyComponent')
  })
})

describe('View — stream engine additional', () => {
  test('stream engine with props', async () => {
    let receivedProps: any
    const engine: ViewEngine = {
      render: () => '',
      renderStream: (_c, props) => {
        receivedProps = props
        return Promise.resolve(new ReadableStream({ start(c) { c.close() } }))
      },
    }
    await createView(engine).render('Comp', { key: 'val' })
    expect(receivedProps).toEqual({ key: 'val' })
  })

  test('stream engine component name is passed', async () => {
    let receivedComp: any
    const engine: ViewEngine = {
      render: () => '',
      renderStream: (comp) => {
        receivedComp = comp
        return Promise.resolve(new ReadableStream({ start(c) { c.close() } }))
      },
    }
    await createView(engine).render('StreamComp')
    expect(receivedComp).toBe('StreamComp')
  })
})

describe('ViewProvider — additional', () => {
  test('has boot method', () => {
    expect(typeof new ViewProvider().register).toBe('function')
  })

  test('multiple ViewProvider instances are independent', () => {
    const p1 = new ViewProvider()
    const p2 = new ViewProvider()
    expect(p1).not.toBe(p2)
  })

  test('register with custom dir from config', async () => {
    const engine = makeSyncEngine()
    let registeredValue: any = null
    const mockApp = {
      use: () => (k: string) => {
        if (k === 'view') return { engine }
        if (k === 'view.engine') return engine
        if (k === 'view.dir') return '/custom/dir'
        return null
      },
      instance: (key: string, val: any) => { registeredValue = val },
    }
    await new ViewProvider().register(mockApp as any)
    expect(registeredValue).toBeInstanceOf(View)
    expect(registeredValue.getDir()).toBe('/custom/dir')
  })
})


describe('View — multiple renders with varying props', () => {
  test('render with different props each time', async () => {
    let lastProps: any
    const engine: ViewEngine = { render: (_c, props) => { lastProps = props; return '<p>ok</p>' } }
    const v = createView(engine)
    await v.render('Comp', { a: 1 }, { stream: false })
    expect(lastProps).toEqual({ a: 1 })
    await v.render('Comp', { b: 2 }, { stream: false })
    expect(lastProps).toEqual({ b: 2 })
    await v.render('Comp', { c: 3 }, { stream: false })
    expect(lastProps).toEqual({ c: 3 })
  })

  test('render with no props then with props', async () => {
    let lastProps: any = 'initial'
    const engine: ViewEngine = { render: (_c, props) => { lastProps = props; return '' } }
    const v = createView(engine)
    await v.render('Comp', undefined, { stream: false })
    expect(lastProps).toBeUndefined()
    await v.render('Comp', { key: 'val' }, { stream: false })
    expect(lastProps).toEqual({ key: 'val' })
  })

  test('renderToHTML called multiple times', async () => {
    let count = 0
    const engine: ViewEngine = { render: () => { count++; return `<p>${count}</p>` } }
    const v = createView(engine)
    const h1 = await v.renderToHTML('Comp')
    const h2 = await v.renderToHTML('Comp')
    const h3 = await v.renderToHTML('Comp')
    expect(h1).toBe('<p>1</p>')
    expect(h2).toBe('<p>2</p>')
    expect(h3).toBe('<p>3</p>')
  })

  test('render returns Response with correct body for each call', async () => {
    let call = 0
    const engine: ViewEngine = { render: () => { call++; return `<h${call}>` } }
    const v = createView(engine)
    const r1 = await v.render('C', {}, { stream: false })
    const r2 = await v.render('C', {}, { stream: false })
    expect(await r1.text()).toBe('<h1>')
    expect(await r2.text()).toBe('<h2>')
  })

  test('render with empty props object', async () => {
    let received: any
    const engine: ViewEngine = { render: (_c, props) => { received = props; return '' } }
    const v = createView(engine)
    await v.render('Comp', {}, { stream: false })
    expect(received).toEqual({})
  })

  test('render different component names', async () => {
    const names: string[] = []
    const engine: ViewEngine = { render: (comp) => { names.push(comp as string); return '' } }
    const v = createView(engine)
    await v.render('Header', {}, { stream: false })
    await v.render('Footer', {}, { stream: false })
    await v.render('Sidebar', {}, { stream: false })
    expect(names).toEqual(['Header', 'Footer', 'Sidebar'])
  })

  test('View can be used as a value', () => {
    const v = new View()
    expect(v).toBeDefined()
    expect(typeof v.configure).toBe('function')
    expect(typeof v.render).toBe('function')
    expect(typeof v.renderToHTML).toBe('function')
    expect(typeof v.getEngine).toBe('function')
    expect(typeof v.getDir).toBe('function')
  })
})

// Additional edge-case tests

describe('View — engine that throws during render', () => {
  test('render rejects when sync engine throws', async () => {
    const engine: ViewEngine = { render: () => { throw new Error('render failed') } }
    const v = createView(engine)
    await expect(v.render('Comp', {}, { stream: false })).rejects.toThrow('render failed')
  })

  test('render rejects when async engine rejects', async () => {
    const engine: ViewEngine = { render: () => Promise.reject(new Error('async fail')) }
    const v = createView(engine)
    await expect(v.render('Comp', {}, { stream: false })).rejects.toThrow('async fail')
  })

  test('renderToHTML rejects when engine throws', async () => {
    const engine: ViewEngine = { render: () => { throw new Error('html fail') } }
    const v = createView(engine)
    await expect(v.renderToHTML('Comp')).rejects.toThrow('html fail')
  })

  test('render rejects when renderStream throws', async () => {
    const engine: ViewEngine = {
      render: () => '<p>fallback</p>',
      renderStream: () => { throw new Error('stream fail') },
    }
    const v = createView(engine)
    await expect(v.render('Comp')).rejects.toThrow('stream fail')
  })
})

describe('View — different engine types swapped at runtime', () => {
  test('swap from sync engine to stream engine', async () => {
    const v = new View()
    v.configure(makeSyncEngine('<p>sync</p>'))
    const html1 = await v.renderToHTML('Comp')
    expect(html1).toBe('<p>sync</p>')

    v.configure(makeStreamEngine('<p>streamed</p>'))
    const html2 = await v.renderToHTML('Comp')
    expect(html2).toBe('<p>streamed</p>')
  })

  test('swap from async engine to sync engine', async () => {
    const v = new View()
    v.configure(makeAsyncEngine('<p>async</p>'))
    const html1 = await v.renderToHTML('Comp')
    expect(html1).toBe('<p>async</p>')

    v.configure(makeSyncEngine('<p>sync now</p>'))
    const html2 = await v.renderToHTML('Comp')
    expect(html2).toBe('<p>sync now</p>')
  })
})

describe('View.render — response body for stream engine with stream: false', () => {
  test('stream engine with stream: false uses sync render path', async () => {
    const engine: ViewEngine = {
      render: () => '<p>sync path</p>',
      renderStream: () => Promise.resolve(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('<p>stream path</p>')); c.close() } })),
    }
    const v = createView(engine)
    const res = await v.render('Comp', {}, { stream: false })
    expect(await res.text()).toBe('<p>sync path</p>')
  })
})

describe('View.render — default stream behavior with no renderStream', () => {
  test('engine without renderStream falls back to sync even when stream not specified', async () => {
    const engine: ViewEngine = { render: () => '<p>only sync</p>' }
    const v = createView(engine)
    const res = await v.render('Comp')
    expect(await res.text()).toBe('<p>only sync</p>')
  })
})

describe('View.render — Content-Type header variations', () => {
  test('default Content-Type includes charset=utf-8', async () => {
    const res = await createView(makeSyncEngine()).render('Comp', {}, { stream: false })
    expect(res.headers.get('content-type')).toContain('charset=utf-8')
  })

  test('custom application/json Content-Type overrides default', async () => {
    const res = await createView(makeSyncEngine()).render('Comp', {}, {
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.headers.get('content-type')).toBe('application/json')
  })
})

describe('View — rendering with null and undefined props', () => {
  test('render with null props passes null to engine', async () => {
    let received: any = 'not set'
    const engine: ViewEngine = { render: (_c, props) => { received = props; return '' } }
    await createView(engine).render('Comp', null, { stream: false })
    expect(received).toBeNull()
  })

  test('renderToHTML with null props passes null to engine', async () => {
    let received: any = 'not set'
    const engine: ViewEngine = { render: (_c, props) => { received = props; return '' } }
    await createView(engine).renderToHTML('Comp', null)
    expect(received).toBeNull()
  })
})

describe('View — multiple headers plus status', () => {
  test('multiple headers with 500 status', async () => {
    const res = await createView(makeSyncEngine('<p>error</p>')).render('Comp', {}, {
      status: 500,
      headers: { 'X-Error': 'true', 'Retry-After': '30' },
    })
    expect(res.status).toBe(500)
    expect(res.headers.get('x-error')).toBe('true')
    expect(res.headers.get('retry-after')).toBe('30')
    expect(res.headers.get('content-type')).toContain('text/html')
  })
})

describe('View.render — X-Content-Type-Options default', () => {
  test('sets nosniff by default (sync path)', async () => {
    const res = await createView(makeSyncEngine()).render('Comp', {}, { stream: false })
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  test('sets nosniff by default (stream path)', async () => {
    const res = await createView(makeStreamEngine()).render('Comp')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  test('caller can override nosniff via extra headers', async () => {
    const res = await createView(makeSyncEngine()).render('Comp', {}, {
      stream: false,
      headers: { 'X-Content-Type-Options': '' },
    })
    expect(res.headers.get('x-content-type-options')).toBe('')
  })
})

describe('View — renderToHTML with async engine and props', () => {
  test('async engine receives and uses props', async () => {
    let capturedProps: any
    const engine: ViewEngine = {
      render: (_c, props) => {
        capturedProps = props
        return Promise.resolve(`<p>${props?.name}</p>`)
      },
    }
    const html = await createView(engine).renderToHTML('Comp', { name: 'Test' })
    expect(html).toBe('<p>Test</p>')
    expect(capturedProps).toEqual({ name: 'Test' })
  })
})
