import { test, expect, describe } from 'bun:test'
import { Listener, On, Once } from '../src/index'

describe('Listener + On', () => {
  test('collects listener metadata from decorated methods', () => {
    @Listener()
    class Events {
      @On('user.created')
      handleCreated() {}

      @On('user.deleted')
      handleDeleted() {}
    }

    const listeners = (Events as any).__listeners
    expect(listeners).toHaveLength(2)
    expect(listeners[0]).toEqual({ event: 'user.created', method: 'handleCreated', once: false })
    expect(listeners[1]).toEqual({ event: 'user.deleted', method: 'handleDeleted', once: false })
  })

  test('empty class has no listeners', () => {
    @Listener()
    class Empty {}

    expect((Empty as any).__listeners).toEqual([])
  })

  test('only decorated methods are collected', () => {
    @Listener()
    class Events {
      @On('task.done')
      onDone() {}

      helper() {}
    }

    expect((Events as any).__listeners).toHaveLength(1)
  })
})

describe('Once', () => {
  test('marks listener as once', () => {
    @Listener()
    class Events {
      @Once('app.booted')
      init() {}
    }

    const listeners = (Events as any).__listeners
    expect(listeners[0].once).toBe(true)
  })

  test('On and Once can coexist', () => {
    @Listener()
    class Events {
      @On('message')
      onMessage() {}

      @Once('init')
      onInit() {}
    }

    const listeners = (Events as any).__listeners
    expect(listeners[0]).toEqual({ event: 'message', method: 'onMessage', once: false })
    expect(listeners[1]).toEqual({ event: 'init', method: 'onInit', once: true })
  })
})

describe('Multiple listener classes', () => {
  test('each class has independent listeners', () => {
    @Listener()
    class UserEvents {
      @On('user.created')
      handle() {}
    }

    @Listener()
    class TaskEvents {
      @On('task.created')
      handle() {}

      @On('task.completed')
      handleDone() {}
    }

    expect((UserEvents as any).__listeners).toHaveLength(1)
    expect((TaskEvents as any).__listeners).toHaveLength(2)
  })
})

describe('Integration with Emitter.register()', () => {
  test('emitter.register() hooks up decorated listeners', async () => {
    const { Emitter } = await import('@tekir/emitter')

    @Listener()
    class Events {
      received: string[] = []

      @On('ping')
      onPing(data: any) {
        this.received.push(data.msg)
      }
    }

    const emitter = new Emitter()
    emitter.register(Events)

    await emitter.emit('ping', { msg: 'hello' })
    await emitter.emit('ping', { msg: 'world' })

    // Can't access instance directly, but event fired without error
    expect(emitter.listenerCount('ping')).toBe(1)
  })

  test('Once listener fires only once', async () => {
    const { Emitter } = await import('@tekir/emitter')
    let count = 0

    @Listener()
    class Events {
      @Once('boot')
      onBoot() { count++ }
    }

    const emitter = new Emitter()
    emitter.register(Events)

    await emitter.emit('boot', {})
    await emitter.emit('boot', {})
    await emitter.emit('boot', {})

    expect(count).toBe(1)
  })

  test('register multiple classes', async () => {
    const { Emitter } = await import('@tekir/emitter')

    @Listener()
    class A {
      @On('event')
      handle() {}
    }

    @Listener()
    class B {
      @On('event')
      handle() {}
    }

    const emitter = new Emitter()
    emitter.register(A, B)

    expect(emitter.listenerCount('event')).toBe(2)
  })
})


describe('Listener metadata shape', () => {
  test('listener entry has event, method, and once properties', () => {
    @Listener()
    class Events { @On('test') handle() {} }
    const entry = (Events as any).__listeners[0]
    expect(entry).toHaveProperty('event')
    expect(entry).toHaveProperty('method')
    expect(entry).toHaveProperty('once')
  })

  test('__listeners is an array', () => {
    @Listener()
    class Events { @On('x') handle() {} }
    expect(Array.isArray((Events as any).__listeners)).toBe(true)
  })

  test('method name matches the decorated method', () => {
    @Listener()
    class Events { @On('foo') myHandler() {} }
    expect((Events as any).__listeners[0].method).toBe('myHandler')
  })
})

describe('Multiple events on same method pattern', () => {
  test('three On decorators on different methods', () => {
    @Listener()
    class Events {
      @On('a') handleA() {}
      @On('b') handleB() {}
      @On('c') handleC() {}
    }
    expect((Events as any).__listeners).toHaveLength(3)
  })

  test('five listeners collected in order', () => {
    @Listener()
    class BigEvents {
      @On('e1') h1() {}
      @On('e2') h2() {}
      @On('e3') h3() {}
      @Once('e4') h4() {}
      @Once('e5') h5() {}
    }
    expect((BigEvents as any).__listeners).toHaveLength(5)
    expect((BigEvents as any).__listeners[3].once).toBe(true)
    expect((BigEvents as any).__listeners[4].once).toBe(true)
  })

  test('same event name on different methods creates separate entries', () => {
    @Listener()
    class Events {
      @On('user.created') sendEmail() {}
      @On('user.created') logEvent() {}
    }
    const listeners = (Events as any).__listeners
    expect(listeners).toHaveLength(2)
    expect(listeners[0].event).toBe('user.created')
    expect(listeners[1].event).toBe('user.created')
    expect(listeners[0].method).not.toBe(listeners[1].method)
  })
})

describe('Event decorator edge cases', () => {
  test('event name with dots', () => {
    @Listener()
    class Events { @On('order.item.added') handle() {} }
    expect((Events as any).__listeners[0].event).toBe('order.item.added')
  })

  test('event name with colons', () => {
    @Listener()
    class Events { @On('cache:invalidated') handle() {} }
    expect((Events as any).__listeners[0].event).toBe('cache:invalidated')
  })

  test('event name with wildcard characters', () => {
    @Listener()
    class Events { @On('user.*') handle() {} }
    expect((Events as any).__listeners[0].event).toBe('user.*')
  })

  test('On sets once to false', () => {
    @Listener()
    class Events { @On('test') handle() {} }
    expect((Events as any).__listeners[0].once).toBe(false)
  })

  test('Once sets once to true', () => {
    @Listener()
    class Events { @Once('test') handle() {} }
    expect((Events as any).__listeners[0].once).toBe(true)
  })

  test('classes with same method names are independent', () => {
    @Listener()
    class A { @On('eventA') handle() {} }
    @Listener()
    class B { @On('eventB') handle() {} }
    expect((A as any).__listeners[0].event).toBe('eventA')
    expect((B as any).__listeners[0].event).toBe('eventB')
  })

  test('undecorated methods not in __listeners', () => {
    @Listener()
    class Events {
      @On('x') decorated() {}
      plain() {}
      anotherPlain() {}
    }
    expect((Events as any).__listeners).toHaveLength(1)
  })

  test('event name with hyphens', () => {
    @Listener()
    class Events { @On('user-created') handle() {} }
    expect((Events as any).__listeners[0].event).toBe('user-created')
  })

  test('event name with underscores', () => {
    @Listener()
    class Events { @On('user_created') handle() {} }
    expect((Events as any).__listeners[0].event).toBe('user_created')
  })

  test('event name with numbers', () => {
    @Listener()
    class Events { @On('event123') handle() {} }
    expect((Events as any).__listeners[0].event).toBe('event123')
  })

  test('Once with dotted event name', () => {
    @Listener()
    class Events { @Once('app.ready') handle() {} }
    expect((Events as any).__listeners[0].event).toBe('app.ready')
    expect((Events as any).__listeners[0].once).toBe(true)
  })

  test('10 listeners in one class', () => {
    @Listener()
    class BigEvents {
      @On('e1') h1() {}
      @On('e2') h2() {}
      @On('e3') h3() {}
      @On('e4') h4() {}
      @On('e5') h5() {}
      @On('e6') h6() {}
      @On('e7') h7() {}
      @On('e8') h8() {}
      @On('e9') h9() {}
      @On('e10') h10() {}
    }
    expect((BigEvents as any).__listeners).toHaveLength(10)
  })
})


describe('Listener decorator return value', () => {
  test('Listener() returns the class constructor unchanged', () => {
    @Listener()
    class Events {
      @On('test') handle() {}
    }
    const instance = new (Events as any)()
    expect(instance).toBeDefined()
    expect(typeof instance.handle).toBe('function')
  })

  test('decorated methods are still callable on instances', () => {
    @Listener()
    class Events {
      result = ''
      @On('ping') handle() { this.result = 'pong' }
    }
    const instance = new (Events as any)()
    instance.handle()
    expect(instance.result).toBe('pong')
  })

  test('decorated methods can accept arguments', () => {
    @Listener()
    class Events {
      captured: any = null
      @On('data') handle(payload: any) { this.captured = payload }
    }
    const instance = new (Events as any)()
    instance.handle({ foo: 'bar' })
    expect(instance.captured).toEqual({ foo: 'bar' })
  })
})

describe('Listener with empty event names', () => {
  test('empty string event name throws early', () => {
    expect(() => On('')).toThrow(/non-empty/)
  })

  test('whitespace-only event name throws early', () => {
    expect(() => On('   ')).toThrow(/non-empty/)
  })

  test('Once with empty string event name throws early', () => {
    expect(() => Once('')).toThrow(/non-empty/)
  })
})

describe('Listener with unicode and special event names', () => {
  test('event name with unicode characters', () => {
    @Listener()
    class Events { @On('evento.creado') handle() {} }
    expect((Events as any).__listeners[0].event).toBe('evento.creado')
  })

  test('event name with slashes', () => {
    @Listener()
    class Events { @On('api/v1/users') handle() {} }
    expect((Events as any).__listeners[0].event).toBe('api/v1/users')
  })

  test('event name with spaces', () => {
    @Listener()
    class Events { @On('my event') handle() {} }
    expect((Events as any).__listeners[0].event).toBe('my event')
  })
})

describe('On and Once do not interfere across classes', () => {
  test('On in one class does not leak to another', () => {
    @Listener()
    class A { @On('shared') handle() {} }

    @Listener()
    class B { @Once('shared') handle() {} }

    expect((A as any).__listeners[0].once).toBe(false)
    expect((B as any).__listeners[0].once).toBe(true)
  })

  test('multiple classes with many listeners remain fully independent', () => {
    @Listener()
    class X {
      @On('x1') a() {}
      @On('x2') b() {}
      @Once('x3') c() {}
    }

    @Listener()
    class Y {
      @Once('y1') a() {}
    }

    expect((X as any).__listeners).toHaveLength(3)
    expect((Y as any).__listeners).toHaveLength(1)
    expect((X as any).__listeners[2].once).toBe(true)
    expect((Y as any).__listeners[0].once).toBe(true)
  })
})

describe('Listener __listeners is always fresh per class', () => {
  test('redefining a class with Listener gives new metadata', () => {
    @Listener()
    class First { @On('a') handle() {} }

    @Listener()
    class Second { @On('b') handle() {} @On('c') other() {} }

    expect((First as any).__listeners).toHaveLength(1)
    expect((Second as any).__listeners).toHaveLength(2)
  })

  test('__listeners array is not shared between classes', () => {
    @Listener()
    class A { @On('ev') handle() {} }

    @Listener()
    class B { @On('ev') handle() {} }

    expect((A as any).__listeners).not.toBe((B as any).__listeners)
  })
})

describe('Mixed On and Once ordering', () => {
  test('alternating On and Once preserves order', () => {
    @Listener()
    class Events {
      @On('a') h1() {}
      @Once('b') h2() {}
      @On('c') h3() {}
      @Once('d') h4() {}
    }
    const l = (Events as any).__listeners
    expect(l[0]).toEqual({ event: 'a', method: 'h1', once: false })
    expect(l[1]).toEqual({ event: 'b', method: 'h2', once: true })
    expect(l[2]).toEqual({ event: 'c', method: 'h3', once: false })
    expect(l[3]).toEqual({ event: 'd', method: 'h4', once: true })
  })
})

describe('Multiple @On / @Once on the same method', () => {
  test('two @On on one method register both events', () => {
    @Listener()
    class Events {
      @On('a')
      @On('b')
      handle() {}
    }
    const listeners = (Events as any).__listeners as any[]
    const events = listeners.filter((l) => l.method === 'handle').map((l) => l.event)
    expect(events).toContain('a')
    expect(events).toContain('b')
    expect(events).toHaveLength(2)
  })

  test('@On and @Once on one method keep distinct once flags', () => {
    @Listener()
    class Events {
      @On('persistent')
      @Once('boot')
      handle() {}
    }
    const listeners = (Events as any).__listeners as any[]
    const persistent = listeners.find((l) => l.event === 'persistent')
    const boot = listeners.find((l) => l.event === 'boot')
    expect(persistent.once).toBe(false)
    expect(boot.once).toBe(true)
  })

  test('three @On on one method register all three', () => {
    @Listener()
    class Events {
      @On('x')
      @On('y')
      @On('z')
      handle() {}
    }
    const events = ((Events as any).__listeners as any[]).map((l) => l.event)
    expect(events.sort()).toEqual(['x', 'y', 'z'])
  })
})

describe('Inherited listener methods are collected', () => {
  test('base class @On methods are picked up by a decorated subclass', () => {
    class BaseEvents {
      @On('base.event') onBase() {}
    }
    @Listener()
    class ChildEvents extends BaseEvents {
      @On('child.event') onChild() {}
    }
    const events = ((ChildEvents as any).__listeners as any[]).map((l) => l.event)
    expect(events).toContain('base.event')
    expect(events).toContain('child.event')
  })

  test('overridden listener method is collected once', () => {
    class BaseEvents {
      @On('base') handle() {}
    }
    @Listener()
    class ChildEvents extends BaseEvents {
      @On('child') handle() {}
    }
    const handleEntries = ((ChildEvents as any).__listeners as any[]).filter((l) => l.method === 'handle')
    expect(handleEntries).toHaveLength(1)
    expect(handleEntries[0].event).toBe('child')
  })
})
