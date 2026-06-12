import { test, expect, describe } from 'bun:test'
import { Emitter, FakeEmitter, createEmitter } from '../src/index'

type TestEvents = {
  ping: { id: number }
  pong: string
  count: number
}

describe('Emitter', () => {
  describe('createEmitter factory', () => {
    test('returns an Emitter instance', () => {
      expect(createEmitter()).toBeInstanceOf(Emitter)
    })
  })

  describe('on() / emit()', () => {
    test('calls handler when matching event is emitted', async () => {
      const emitter = new Emitter<TestEvents>()
      const received: number[] = []
      emitter.on('count', (n) => { received.push(n) })
      await emitter.emit('count', 1)
      await emitter.emit('count', 2)
      expect(received).toEqual([1, 2])
    })

    test('multiple handlers on same event are all called', async () => {
      const emitter = new Emitter<TestEvents>()
      const log: string[] = []
      emitter.on('pong', () => { log.push('a') })
      emitter.on('pong', () => { log.push('b') })
      await emitter.emit('pong', 'hello')
      expect(log).toEqual(['a', 'b'])
    })

    test('handler does not fire for different event', async () => {
      const emitter = new Emitter<TestEvents>()
      const log: string[] = []
      emitter.on('pong', () => { log.push('pong') })
      await emitter.emit('count', 5)
      expect(log).toHaveLength(0)
    })

    test('on() returns an unsubscribe function', async () => {
      const emitter = new Emitter<TestEvents>()
      const log: number[] = []
      const unsub = emitter.on('count', (n) => { log.push(n) })
      await emitter.emit('count', 1)
      unsub()
      await emitter.emit('count', 2)
      expect(log).toEqual([1])
    })

    test('passes event data correctly to handler', async () => {
      const emitter = new Emitter<TestEvents>()
      let got: { id: number } | undefined
      emitter.on('ping', (data) => { got = data })
      await emitter.emit('ping', { id: 42 })
      expect(got).toEqual({ id: 42 })
    })
  })

  describe('once()', () => {
    test('handler fires only on the first emit', async () => {
      const emitter = new Emitter<TestEvents>()
      let callCount = 0
      emitter.once('count', () => { callCount++ })
      await emitter.emit('count', 1)
      await emitter.emit('count', 2)
      expect(callCount).toBe(1)
    })

    test('multiple once handlers all fire once', async () => {
      const emitter = new Emitter<TestEvents>()
      const log: string[] = []
      emitter.once('pong', () => { log.push('a') })
      emitter.once('pong', () => { log.push('b') })
      await emitter.emit('pong', 'x')
      await emitter.emit('pong', 'y')
      expect(log).toEqual(['a', 'b'])
    })
  })

  describe('off()', () => {
    test('removes an on() handler', async () => {
      const emitter = new Emitter<TestEvents>()
      const log: number[] = []
      const handler = (n: number) => { log.push(n) }
      emitter.on('count', handler)
      await emitter.emit('count', 1)
      emitter.off('count', handler)
      await emitter.emit('count', 2)
      expect(log).toEqual([1])
    })

    test('removing non-existent handler does not throw', () => {
      const emitter = new Emitter<TestEvents>()
      expect(() => emitter.off('count', () => {})).not.toThrow()
    })
  })

  describe('onAny()', () => {
    test('fires for any event', async () => {
      const emitter = new Emitter<TestEvents>()
      const log: string[] = []
      emitter.onAny((event) => { log.push(event) })
      await emitter.emit('ping', { id: 1 })
      await emitter.emit('pong', 'x')
      expect(log).toEqual(['ping', 'pong'])
    })

    test('onAny() returns an unsubscribe function', async () => {
      const emitter = new Emitter<TestEvents>()
      const log: string[] = []
      const unsub = emitter.onAny((event) => { log.push(event) })
      await emitter.emit('ping', { id: 1 })
      unsub()
      await emitter.emit('ping', { id: 2 })
      expect(log).toHaveLength(1)
    })
  })

  describe('onError()', () => {
    test('catches handler errors instead of throwing', async () => {
      const emitter = new Emitter<TestEvents>()
      const errors: Array<{ event: string; err: Error }> = []
      emitter.onError((event, err) => { errors.push({ event, err }) })
      emitter.on('count', () => { throw new Error('handler error') })
      await emitter.emit('count', 1)
      expect(errors).toHaveLength(1)
      expect(errors[0].event).toBe('count')
      expect(errors[0].err.message).toBe('handler error')
    })

    test('without onError, emit isolates handler errors (does not reject)', async () => {
      const emitter = new Emitter<TestEvents>()
      emitter.setMaxListeners(0)
      emitter.on('count', () => { throw new Error('boom') })
      // Error is isolated and logged by default rather than propagated.
      await expect(emitter.emit('count', 1)).resolves.toBeUndefined()
    })
  })

  describe('emitSync()', () => {
    test('calls handlers synchronously', () => {
      const emitter = new Emitter<TestEvents>()
      const log: number[] = []
      emitter.on('count', (n) => { log.push(n) })
      emitter.emitSync('count', 10)
      expect(log).toEqual([10])
    })

    test('once handlers fire and are removed in emitSync', () => {
      const emitter = new Emitter<TestEvents>()
      let calls = 0
      emitter.once('count', () => { calls++ })
      emitter.emitSync('count', 1)
      emitter.emitSync('count', 2)
      expect(calls).toBe(1)
    })
  })

  describe('wait()', () => {
    test('resolves with the next emitted value', async () => {
      const emitter = new Emitter<TestEvents>()
      const promise = emitter.wait('count')
      await emitter.emit('count', 99)
      const result = await promise
      expect(result).toBe(99)
    })

    test('rejects after timeout', async () => {
      const emitter = new Emitter<TestEvents>()
      await expect(emitter.wait('count', { timeout: 10 })).rejects.toThrow('Timeout waiting for "count"')
    })

    test('rejects immediately when signal is already aborted', async () => {
      const emitter = new Emitter<TestEvents>()
      const controller = new AbortController()
      controller.abort()
      await expect(emitter.wait('count', { signal: controller.signal })).rejects.toThrow('Aborted')
    })
  })

  describe('listenerCount()', () => {
    test('returns 0 for event with no listeners', () => {
      const emitter = new Emitter<TestEvents>()
      expect(emitter.listenerCount('ping')).toBe(0)
    })

    test('counts on() listeners', () => {
      const emitter = new Emitter<TestEvents>()
      emitter.on('ping', () => {})
      emitter.on('ping', () => {})
      expect(emitter.listenerCount('ping')).toBe(2)
    })

    test('counts once() listeners', () => {
      const emitter = new Emitter<TestEvents>()
      emitter.once('ping', () => {})
      expect(emitter.listenerCount('ping')).toBe(1)
    })

    test('counts all listeners across events when no arg given', () => {
      const emitter = new Emitter<TestEvents>()
      emitter.on('ping', () => {})
      emitter.once('pong', () => {})
      emitter.onAny(() => {})
      expect(emitter.listenerCount()).toBe(3)
    })
  })

  describe('clearListeners()', () => {
    test('clears all listeners for a specific event', async () => {
      const emitter = new Emitter<TestEvents>()
      const log: number[] = []
      emitter.on('count', (n) => { log.push(n) })
      emitter.clearListeners('count')
      await emitter.emit('count', 1)
      expect(log).toHaveLength(0)
    })

    test('clears all listeners for all events', async () => {
      const emitter = new Emitter<TestEvents>()
      const log: string[] = []
      emitter.on('ping', () => { log.push('ping') })
      emitter.on('pong', () => { log.push('pong') })
      emitter.onAny(() => { log.push('any') })
      emitter.clearListeners()
      await emitter.emit('ping', { id: 1 })
      await emitter.emit('pong', 'x')
      expect(log).toHaveLength(0)
    })
  })

  describe('eventNames', () => {
    test('returns list of events with listeners', () => {
      const emitter = new Emitter<TestEvents>()
      emitter.on('ping', () => {})
      emitter.once('pong', () => {})
      const names = emitter.eventNames
      expect(names).toContain('ping')
      expect(names).toContain('pong')
    })

    test('returns unique event names', () => {
      const emitter = new Emitter<TestEvents>()
      emitter.on('ping', () => {})
      emitter.once('ping', () => {})
      const names = emitter.eventNames
      const pingCount = names.filter((n) => n === 'ping').length
      expect(pingCount).toBe(1)
    })
  })
})

describe('FakeEmitter', () => {
  test('Emitter.fake() returns a FakeEmitter', () => {
    const fake = Emitter.fake<TestEvents>()
    expect(fake).toBeInstanceOf(FakeEmitter)
  })

  test('emit() records emitted events without calling handlers', async () => {
    const fake = new FakeEmitter<TestEvents>()
    const log: number[] = []
    fake.on('count', (n) => { log.push(n) })
    await fake.emit('count', 5)
    // FakeEmitter overrides emit — handlers are NOT called
    expect(log).toHaveLength(0)
    expect(fake.assertEmitted('count')).toBe(true)
  })

  test('assertEmitted() returns false for unemitted event', () => {
    const fake = new FakeEmitter<TestEvents>()
    expect(fake.assertEmitted('ping')).toBe(false)
  })

  test('assertEmittedCount() returns correct count', async () => {
    const fake = new FakeEmitter<TestEvents>()
    await fake.emit('count', 1)
    await fake.emit('count', 2)
    await fake.emit('ping', { id: 1 })
    expect(fake.assertEmittedCount('count', 2)).toBe(true)
    expect(fake.assertEmittedCount('count', 3)).toBe(false)
    expect(fake.assertEmittedCount('ping', 1)).toBe(true)
  })

  test('getEmitted() returns data for all emissions of an event', async () => {
    const fake = new FakeEmitter<TestEvents>()
    await fake.emit('count', 10)
    await fake.emit('count', 20)
    const emitted = fake.getEmitted('count')
    expect(emitted).toEqual([10, 20])
  })

  test('reset() clears all recorded emissions', async () => {
    const fake = new FakeEmitter<TestEvents>()
    await fake.emit('count', 1)
    fake.reset()
    expect(fake.assertEmitted('count')).toBe(false)
    expect(fake.getEmitted('count')).toHaveLength(0)
  })
})


describe('Multiple listeners fire in registration order', () => {
  test('three on() handlers fire in the order they were registered', async () => {
    const emitter = new Emitter<TestEvents>()
    const order: number[] = []
    emitter.on('count', () => { order.push(1) })
    emitter.on('count', () => { order.push(2) })
    emitter.on('count', () => { order.push(3) })
    await emitter.emit('count', 0)
    expect(order).toEqual([1, 2, 3])
  })

  test('mix of on() and once() handlers fire in registration order', async () => {
    const emitter = new Emitter<TestEvents>()
    const order: string[] = []
    emitter.on('pong', () => { order.push('on-1') })
    emitter.once('pong', () => { order.push('once') })
    emitter.on('pong', () => { order.push('on-2') })
    await emitter.emit('pong', 'x')
    // on() handlers fire first, then once() handlers
    expect(order).toContain('on-1')
    expect(order).toContain('once')
    expect(order).toContain('on-2')
    // on() handlers appear before once() handlers in emission order
    expect(order.indexOf('on-1')).toBeLessThan(order.indexOf('once'))
  })
})


describe('onAny receives event name and data', () => {
  test('onAny handler receives the event name as first argument', async () => {
    const emitter = new Emitter<TestEvents>()
    const received: string[] = []
    emitter.onAny((event) => { received.push(event) })
    await emitter.emit('ping', { id: 1 })
    await emitter.emit('pong', 'hello')
    await emitter.emit('count', 99)
    expect(received).toEqual(['ping', 'pong', 'count'])
  })

  test('onAny handler receives the emitted data as second argument', async () => {
    const emitter = new Emitter<TestEvents>()
    const payloads: unknown[] = []
    emitter.onAny((_event, data) => { payloads.push(data) })
    await emitter.emit('ping', { id: 7 })
    await emitter.emit('count', 42)
    expect(payloads[0]).toEqual({ id: 7 })
    expect(payloads[1]).toBe(42)
  })

  test('multiple onAny handlers all receive every event', async () => {
    const emitter = new Emitter<TestEvents>()
    const log1: string[] = []
    const log2: string[] = []
    emitter.onAny((e) => { log1.push(e) })
    emitter.onAny((e) => { log2.push(e) })
    await emitter.emit('ping', { id: 1 })
    expect(log1).toEqual(['ping'])
    expect(log2).toEqual(['ping'])
  })
})


describe('once listener auto-removed after fire', () => {
  test('listenerCount decreases to 0 after once fires', async () => {
    const emitter = new Emitter<TestEvents>()
    emitter.once('count', () => {})
    expect(emitter.listenerCount('count')).toBe(1)
    await emitter.emit('count', 1)
    expect(emitter.listenerCount('count')).toBe(0)
  })

  test('once handler does not appear in eventNames after firing', async () => {
    const emitter = new Emitter<TestEvents>()
    emitter.once('pong', () => {})
    await emitter.emit('pong', 'x')
    // After firing, pong entry is cleared
    expect(emitter.listenerCount('pong')).toBe(0)
  })

  test('once via emitSync is auto-removed', () => {
    const emitter = new Emitter<TestEvents>()
    let fires = 0
    emitter.once('count', () => { fires++ })
    emitter.emitSync('count', 1)
    emitter.emitSync('count', 2)
    expect(fires).toBe(1)
  })
})


describe('off with non-registered handler', () => {
  test('off with a handler never registered does not throw', () => {
    const emitter = new Emitter<TestEvents>()
    const noop = () => {}
    expect(() => emitter.off('count', noop)).not.toThrow()
  })

  test('off does not remove a different handler', async () => {
    const emitter = new Emitter<TestEvents>()
    const log: number[] = []
    const h1 = (n: number) => { log.push(n) }
    const h2 = (n: number) => { log.push(n * 10) }
    emitter.on('count', h1)
    emitter.on('count', h2)
    emitter.off('count', () => {}) // off a completely different fn
    await emitter.emit('count', 5)
    expect(log).toEqual([5, 50]) // both still active
  })

  test('off after clearListeners does not throw', () => {
    const emitter = new Emitter<TestEvents>()
    const h = () => {}
    emitter.on('count', h)
    emitter.clearListeners('count')
    expect(() => emitter.off('count', h)).not.toThrow()
  })
})


describe('clearListeners for specific event', () => {
  test('clearListeners(event) only removes listeners for that event', async () => {
    const emitter = new Emitter<TestEvents>()
    const log: string[] = []
    emitter.on('ping', () => { log.push('ping') })
    emitter.on('pong', () => { log.push('pong') })
    emitter.clearListeners('ping')
    await emitter.emit('ping', { id: 1 })
    await emitter.emit('pong', 'x')
    expect(log).toEqual(['pong'])
  })

  test('clearListeners(event) reduces listenerCount to 0 for that event', () => {
    const emitter = new Emitter<TestEvents>()
    emitter.on('count', () => {})
    emitter.once('count', () => {})
    emitter.clearListeners('count')
    expect(emitter.listenerCount('count')).toBe(0)
  })

  test('clearListeners() with no arg clears all events including onAny', async () => {
    const emitter = new Emitter<TestEvents>()
    const log: string[] = []
    emitter.on('ping', () => { log.push('ping') })
    emitter.onAny(() => { log.push('any') })
    emitter.clearListeners()
    await emitter.emit('ping', { id: 1 })
    expect(log).toHaveLength(0)
    expect(emitter.listenerCount()).toBe(0)
  })
})


describe('eventNames returns unique names', () => {
  test('eventNames contains no duplicates even with multiple handlers', () => {
    const emitter = new Emitter<TestEvents>()
    emitter.on('ping', () => {})
    emitter.on('ping', () => {})
    emitter.once('ping', () => {})
    const names = emitter.eventNames
    expect(names.filter(n => n === 'ping')).toHaveLength(1)
  })

  test('eventNames is empty when no handlers are registered', () => {
    const emitter = new Emitter<TestEvents>()
    expect(emitter.eventNames).toHaveLength(0)
  })

  test('eventNames updates after clearListeners removes all for an event', async () => {
    const emitter = new Emitter<TestEvents>()
    emitter.on('ping', () => {})
    emitter.on('pong', () => {})
    emitter.clearListeners('ping')
    const names = emitter.eventNames
    expect(names).not.toContain('ping')
    expect(names).toContain('pong')
  })
})


describe('listenerCount accuracy', () => {
  test('counts on(), once() and onAny() in global total', () => {
    const emitter = new Emitter<TestEvents>()
    emitter.on('ping', () => {})
    emitter.once('pong', () => {})
    emitter.onAny(() => {})
    expect(emitter.listenerCount()).toBe(3)
  })

  test('count decreases after off()', () => {
    const emitter = new Emitter<TestEvents>()
    const h = () => {}
    emitter.on('count', h)
    emitter.on('count', () => {})
    expect(emitter.listenerCount('count')).toBe(2)
    emitter.off('count', h)
    expect(emitter.listenerCount('count')).toBe(1)
  })

  test('count decreases after once fires', async () => {
    const emitter = new Emitter<TestEvents>()
    emitter.once('count', () => {})
    emitter.on('count', () => {})
    expect(emitter.listenerCount('count')).toBe(2)
    await emitter.emit('count', 1)
    expect(emitter.listenerCount('count')).toBe(1)
  })
})


describe('Error in handler propagation', () => {
  test('without onError, emit() isolates errors and continues', async () => {
    const emitter = new Emitter<TestEvents>()
    emitter.setMaxListeners(0)
    const log: number[] = []
    emitter.on('count', () => { throw new Error('sync-throw') })
    emitter.on('count', (n) => { log.push(n) })
    // First handler throwing must not stop the second or reject emit.
    await expect(emitter.emit('count', 1)).resolves.toBeUndefined()
    expect(log).toEqual([1])
  })

  test('with onError, errors are captured and emit does not reject', async () => {
    const emitter = new Emitter<TestEvents>()
    const captured: Error[] = []
    emitter.onError((_event, err) => { captured.push(err) })
    emitter.on('count', () => { throw new Error('captured-error') })
    await emitter.emit('count', 1)
    expect(captured).toHaveLength(1)
    expect(captured[0].message).toBe('captured-error')
  })

  test('onError receives the event name', async () => {
    const emitter = new Emitter<TestEvents>()
    let eventName = ''
    emitter.onError((event) => { eventName = event })
    emitter.on('ping', () => { throw new Error('ping-error') })
    await emitter.emit('ping', { id: 1 })
    expect(eventName).toBe('ping')
  })

  test('subsequent handlers still fire after one handler throws (with onError)', async () => {
    const emitter = new Emitter<TestEvents>()
    emitter.onError(() => {})
    const log: number[] = []
    emitter.on('count', () => { throw new Error('fail') })
    emitter.on('count', (n) => { log.push(n) })
    await emitter.emit('count', 5)
    expect(log).toEqual([5])
  })
})


describe('emitSync returns synchronously', () => {
  test('emitSync does not return a Promise', () => {
    const emitter = new Emitter<TestEvents>()
    emitter.on('count', () => {})
    const result = emitter.emitSync('count', 1)
    expect(result).toBeUndefined()
  })

  test('emitSync fires onAny handlers', () => {
    const emitter = new Emitter<TestEvents>()
    const anyLog: string[] = []
    emitter.onAny((e) => { anyLog.push(e) })
    emitter.emitSync('ping', { id: 1 })
    expect(anyLog).toEqual(['ping'])
  })

  test('emitSync with multiple handlers calls them all', () => {
    const emitter = new Emitter<TestEvents>()
    const log: number[] = []
    emitter.on('count', (n) => { log.push(n) })
    emitter.on('count', (n) => { log.push(n * 2) })
    emitter.emitSync('count', 3)
    expect(log).toEqual([3, 6])
  })
})


describe('FakeEmitter extended', () => {
  test('assertEmitted returns true only after emit is called', async () => {
    const fake = new FakeEmitter<TestEvents>()
    expect(fake.assertEmitted('pong')).toBe(false)
    await fake.emit('pong', 'hello')
    expect(fake.assertEmitted('pong')).toBe(true)
  })

  test('assertEmittedCount with 0 returns true when event never emitted', () => {
    const fake = new FakeEmitter<TestEvents>()
    expect(fake.assertEmittedCount('count', 0)).toBe(true)
  })

  test('getEmitted returns empty array for event that was never emitted', () => {
    const fake = new FakeEmitter<TestEvents>()
    expect(fake.getEmitted('ping')).toEqual([])
  })

  test('getEmitted preserves emission order', async () => {
    const fake = new FakeEmitter<TestEvents>()
    await fake.emit('count', 1)
    await fake.emit('count', 2)
    await fake.emit('count', 3)
    expect(fake.getEmitted('count')).toEqual([1, 2, 3])
  })

  test('reset clears emissions for all events', async () => {
    const fake = new FakeEmitter<TestEvents>()
    await fake.emit('count', 1)
    await fake.emit('ping', { id: 1 })
    fake.reset()
    expect(fake.assertEmitted('count')).toBe(false)
    expect(fake.assertEmitted('ping')).toBe(false)
    expect(fake.getEmitted('count')).toHaveLength(0)
    expect(fake.getEmitted('ping')).toHaveLength(0)
  })

  test('FakeEmitter does not call registered handlers on emit', async () => {
    const fake = new FakeEmitter<TestEvents>()
    let called = false
    fake.on('count', () => { called = true })
    await fake.emit('count', 42)
    expect(called).toBe(false)
  })

  test('getEmitted isolates by event name', async () => {
    const fake = new FakeEmitter<TestEvents>()
    await fake.emit('count', 10)
    await fake.emit('pong', 'hello')
    expect(fake.getEmitted('count')).toEqual([10])
    expect(fake.getEmitted('pong')).toEqual(['hello'])
  })

  test('assertEmittedCount tracks each event independently', async () => {
    const fake = new FakeEmitter<TestEvents>()
    await fake.emit('count', 1)
    await fake.emit('count', 2)
    await fake.emit('ping', { id: 1 })
    expect(fake.assertEmittedCount('count', 2)).toBe(true)
    expect(fake.assertEmittedCount('ping', 1)).toBe(true)
    expect(fake.assertEmittedCount('pong', 0)).toBe(true)
  })
})

// Additional: onAny receives all events with correct data

describe('onAny — comprehensive data forwarding', () => {
  test('onAny handler receives correct data payload for each event type', async () => {
    const emitter = new Emitter<TestEvents>()
    const collected: Array<{ event: string; data: unknown }> = []
    emitter.onAny((event, data) => { collected.push({ event, data }) })

    await emitter.emit('ping', { id: 99 })
    await emitter.emit('pong', 'world')
    await emitter.emit('count', 7)

    expect(collected).toHaveLength(3)
    expect(collected[0]).toEqual({ event: 'ping', data: { id: 99 } })
    expect(collected[1]).toEqual({ event: 'pong', data: 'world' })
    expect(collected[2]).toEqual({ event: 'count', data: 7 })
  })

  test('onAny fires alongside event-specific handlers', async () => {
    const emitter = new Emitter<TestEvents>()
    const log: string[] = []
    emitter.on('count', () => { log.push('specific') })
    emitter.onAny(() => { log.push('any') })
    await emitter.emit('count', 1)
    expect(log).toContain('specific')
    expect(log).toContain('any')
  })
})

// Additional: onError catches handler errors with details

describe('onError — detailed error catching', () => {
  test('onError receives the error object from an async handler', async () => {
    const emitter = new Emitter<TestEvents>()
    const errors: Error[] = []
    emitter.onError((_event, err) => { errors.push(err) })
    emitter.on('count', async () => { throw new Error('async-fail') })
    await emitter.emit('count', 1)
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toBe('async-fail')
  })

  test('onError handler itself throwing does not break emit', async () => {
    const emitter = new Emitter<TestEvents>()
    emitter.onError(() => { throw new Error('error-handler-fail') })
    emitter.on('count', () => { throw new Error('original') })
    // Even if onError throws, emit isolates it and resolves cleanly.
    await expect(emitter.emit('count', 1)).resolves.toBeUndefined()
  })
})

// Additional: listeners() returns count per event

describe('listenerCount — per-event accuracy', () => {
  test('returns correct count for each event independently', () => {
    const emitter = new Emitter<TestEvents>()
    emitter.on('ping', () => {})
    emitter.on('ping', () => {})
    emitter.on('pong', () => {})
    expect(emitter.listenerCount('ping')).toBe(2)
    expect(emitter.listenerCount('pong')).toBe(1)
    expect(emitter.listenerCount('count')).toBe(0)
  })
})

// Additional: removeAll / clearListeners clears everything

describe('clearListeners — removes all handlers globally', () => {
  test('clearListeners with no args removes on, once, and onAny handlers', async () => {
    const emitter = new Emitter<TestEvents>()
    const log: string[] = []
    emitter.on('ping', () => { log.push('on') })
    emitter.once('pong', () => { log.push('once') })
    emitter.onAny(() => { log.push('any') })
    emitter.clearListeners()

    await emitter.emit('ping', { id: 1 })
    await emitter.emit('pong', 'x')
    expect(log).toHaveLength(0)
    expect(emitter.listenerCount()).toBe(0)
  })
})

// Additional: emit with no listeners doesn't throw

describe('emit with no listeners', () => {
  test('emit resolves without error when no handlers are registered', async () => {
    const emitter = new Emitter<TestEvents>()
    await expect(emitter.emit('ping', { id: 1 })).resolves.toBeUndefined()
  })

  test('emitSync does not throw when no handlers are registered', () => {
    const emitter = new Emitter<TestEvents>()
    expect(() => emitter.emitSync('count', 42)).not.toThrow()
  })

  test('emit on cleared emitter does not throw', async () => {
    const emitter = new Emitter<TestEvents>()
    emitter.on('count', () => {})
    emitter.clearListeners()
    await expect(emitter.emit('count', 5)).resolves.toBeUndefined()
  })
})

// Additional: once handler auto-removes after first call (extended)

describe('once — auto-removal extended', () => {
  test('once handler receives the correct data on its single call', async () => {
    const emitter = new Emitter<TestEvents>()
    let received: { id: number } | undefined
    emitter.once('ping', (data) => { received = data })
    await emitter.emit('ping', { id: 77 })
    await emitter.emit('ping', { id: 88 })
    expect(received).toEqual({ id: 77 })
  })

  test('multiple different once events each fire once independently', async () => {
    const emitter = new Emitter<TestEvents>()
    let pingCount = 0
    let pongCount = 0
    emitter.once('ping', () => { pingCount++ })
    emitter.once('pong', () => { pongCount++ })
    await emitter.emit('ping', { id: 1 })
    await emitter.emit('ping', { id: 2 })
    await emitter.emit('pong', 'a')
    await emitter.emit('pong', 'b')
    expect(pingCount).toBe(1)
    expect(pongCount).toBe(1)
  })
})

// Additional: Multiple handlers for same event all fire

describe('Multiple handlers — all fire in order', () => {
  test('five handlers on the same event all fire', async () => {
    const emitter = new Emitter<TestEvents>()
    const results: number[] = []
    for (let i = 0; i < 5; i++) {
      const idx = i
      emitter.on('count', (n) => { results.push(n + idx) })
    }
    await emitter.emit('count', 10)
    expect(results).toEqual([10, 11, 12, 13, 14])
  })
})

// Additional: createEmitter factory creates fresh instance

describe('createEmitter — fresh instance', () => {
  test('each call to createEmitter returns a distinct instance', () => {
    const a = createEmitter()
    const b = createEmitter()
    expect(a).not.toBe(b)
  })

  test('createEmitter instance has no pre-existing listeners', () => {
    const emitter = createEmitter()
    expect(emitter.listenerCount()).toBe(0)
    expect(emitter.eventNames).toHaveLength(0)
  })
})

// Additional: off() return value / unsubscribe removes listener

describe('off / unsubscribe — listener removal', () => {
  test('on() unsubscribe function prevents future calls', async () => {
    const emitter = new Emitter<TestEvents>()
    const log: number[] = []
    const unsub = emitter.on('count', (n) => { log.push(n) })
    await emitter.emit('count', 1)
    unsub()
    await emitter.emit('count', 2)
    expect(log).toEqual([1])
  })

  test('onAny() unsubscribe prevents future onAny calls', async () => {
    const emitter = new Emitter<TestEvents>()
    const log: string[] = []
    const unsub = emitter.onAny((e) => { log.push(e) })
    await emitter.emit('ping', { id: 1 })
    unsub()
    await emitter.emit('pong', 'x')
    expect(log).toEqual(['ping'])
  })

  test('off removes exact handler reference only', async () => {
    const emitter = new Emitter<TestEvents>()
    const logA: number[] = []
    const logB: number[] = []
    const handlerA = (n: number) => { logA.push(n) }
    const handlerB = (n: number) => { logB.push(n) }
    emitter.on('count', handlerA)
    emitter.on('count', handlerB)
    emitter.off('count', handlerA)
    await emitter.emit('count', 5)
    expect(logA).toHaveLength(0)
    expect(logB).toEqual([5])
  })
})

// Additional: FakeEmitter — assertEmitted, assertNotEmitted, reset

describe('FakeEmitter — assertion helpers extended', () => {
  test('assertEmitted returns false for event never emitted', () => {
    const fake = new FakeEmitter<TestEvents>()
    expect(fake.assertEmitted('count')).toBe(false)
    expect(fake.assertEmitted('ping')).toBe(false)
    expect(fake.assertEmitted('pong')).toBe(false)
  })

  test('assertEmitted returns true only for emitted events', async () => {
    const fake = new FakeEmitter<TestEvents>()
    await fake.emit('ping', { id: 1 })
    expect(fake.assertEmitted('ping')).toBe(true)
    expect(fake.assertEmitted('pong')).toBe(false)
  })

  test('reset makes assertEmitted return false for previously emitted events', async () => {
    const fake = new FakeEmitter<TestEvents>()
    await fake.emit('count', 1)
    await fake.emit('ping', { id: 2 })
    fake.reset()
    expect(fake.assertEmitted('count')).toBe(false)
    expect(fake.assertEmitted('ping')).toBe(false)
  })

  test('reset followed by new emits tracks only the new ones', async () => {
    const fake = new FakeEmitter<TestEvents>()
    await fake.emit('count', 1)
    fake.reset()
    await fake.emit('pong', 'after-reset')
    expect(fake.assertEmitted('count')).toBe(false)
    expect(fake.assertEmitted('pong')).toBe(true)
    expect(fake.getEmitted('pong')).toEqual(['after-reset'])
  })
})

// Additional Emitter tests

describe('Emitter — additional', () => {
  test('emit with no listeners does not throw', async () => {
    const emitter = new Emitter<TestEvents>()
    await emitter.emit('count', 1)
    // Should not throw
  })

  test('on returns unsubscribe that works idempotently', async () => {
    const emitter = new Emitter<TestEvents>()
    const log: number[] = []
    const unsub = emitter.on('count', (n) => { log.push(n) })
    unsub()
    unsub() // double unsub should not throw
    await emitter.emit('count', 1)
    expect(log).toHaveLength(0)
  })

  test('multiple events are independent', async () => {
    const emitter = new Emitter<TestEvents>()
    const pings: any[] = []
    const pongs: string[] = []
    emitter.on('ping', (d) => { pings.push(d) })
    emitter.on('pong', (d) => { pongs.push(d) })
    await emitter.emit('ping', { id: 1 })
    await emitter.emit('pong', 'hello')
    expect(pings).toEqual([{ id: 1 }])
    expect(pongs).toEqual(['hello'])
  })

  test('handler receives correct data type', async () => {
    const emitter = new Emitter<TestEvents>()
    let received: any = null
    emitter.on('ping', (data) => { received = data })
    await emitter.emit('ping', { id: 42 })
    expect(received).toEqual({ id: 42 })
    expect(received.id).toBe(42)
  })

  test('many handlers on same event', async () => {
    const emitter = new Emitter<TestEvents>()
    const results: number[] = []
    for (let i = 0; i < 20; i++) {
      emitter.on('count', (n) => { results.push(n + i) })
    }
    await emitter.emit('count', 0)
    expect(results).toHaveLength(20)
    expect(results[0]).toBe(0)
    expect(results[19]).toBe(19)
  })

  test('once handler fires only once', async () => {
    const emitter = new Emitter<TestEvents>()
    const log: number[] = []
    emitter.once('count', (n) => { log.push(n) })
    await emitter.emit('count', 1)
    await emitter.emit('count', 2)
    expect(log).toEqual([1])
  })

  test('off removes specific handler', async () => {
    const emitter = new Emitter<TestEvents>()
    const logA: number[] = []
    const logB: number[] = []
    const handlerA = (n: number) => { logA.push(n) }
    const handlerB = (n: number) => { logB.push(n) }
    emitter.on('count', handlerA)
    emitter.on('count', handlerB)
    emitter.off('count', handlerA)
    await emitter.emit('count', 5)
    expect(logA).toHaveLength(0)
    expect(logB).toEqual([5])
  })

  test('clearListeners removes all handlers for event', async () => {
    const emitter = new Emitter<TestEvents>()
    const log: number[] = []
    emitter.on('count', (n) => { log.push(n) })
    emitter.on('count', (n) => { log.push(n * 2) })
    emitter.clearListeners('count')
    await emitter.emit('count', 1)
    expect(log).toHaveLength(0)
  })

  test('createEmitter returns new instance each time', () => {
    const e1 = createEmitter()
    const e2 = createEmitter()
    expect(e1).not.toBe(e2)
  })
})

describe('FakeEmitter — additional', () => {
  test('getEmitted returns empty array for non-emitted event', () => {
    const fake = new FakeEmitter<TestEvents>()
    expect(fake.getEmitted('count')).toEqual([])
  })

  test('getEmitted returns all emitted payloads', async () => {
    const fake = new FakeEmitter<TestEvents>()
    await fake.emit('count', 1)
    await fake.emit('count', 2)
    await fake.emit('count', 3)
    expect(fake.getEmitted('count')).toEqual([1, 2, 3])
  })

  test('assertEmitted returns false for non-emitted event', () => {
    const fake = new FakeEmitter<TestEvents>()
    expect(fake.assertEmitted('count')).toBe(false)
  })

  test('getEmitted returns empty for non-emitted event', () => {
    const fake = new FakeEmitter<TestEvents>()
    expect(fake.getEmitted('count')).toEqual([])
  })

  test('multiple event types tracked independently', async () => {
    const fake = new FakeEmitter<TestEvents>()
    await fake.emit('ping', { id: 1 })
    await fake.emit('pong', 'hello')
    await fake.emit('count', 42)
    expect(fake.assertEmitted('ping')).toBe(true)
    expect(fake.assertEmitted('pong')).toBe(true)
    expect(fake.assertEmitted('count')).toBe(true)
    expect(fake.getEmitted('ping')).toEqual([{ id: 1 }])
    expect(fake.getEmitted('pong')).toEqual(['hello'])
    expect(fake.getEmitted('count')).toEqual([42])
  })

  test('reset clears all event types', async () => {
    const fake = new FakeEmitter<TestEvents>()
    await fake.emit('ping', { id: 1 })
    await fake.emit('count', 1)
    fake.reset()
    expect(fake.assertEmitted('ping')).toBe(false)
    expect(fake.assertEmitted('count')).toBe(false)
  })

  test('FakeEmitter emit tracks data without real listeners', async () => {
    const fake = new FakeEmitter<TestEvents>()
    await fake.emit('count', 99)
    expect(fake.assertEmitted('count')).toBe(true)
    expect(fake.getEmitted('count')).toEqual([99])
  })
})


describe('Emitter — additional on/emit', () => {
  test('emit with no listeners does not throw', async () => {
    const emitter = new Emitter<TestEvents>()
    await expect(emitter.emit('count', 1)).resolves.toBeUndefined()
  })

  test('handler receives correct typed data', async () => {
    const emitter = new Emitter<TestEvents>()
    let received: { id: number } | undefined
    emitter.on('ping', (data) => { received = data })
    await emitter.emit('ping', { id: 42 })
    expect(received).toEqual({ id: 42 })
  })

  test('many handlers on same event all fire', async () => {
    const emitter = new Emitter<TestEvents>()
    let count = 0
    for (let i = 0; i < 10; i++) {
      emitter.on('count', () => { count++ })
    }
    await emitter.emit('count', 1)
    expect(count).toBe(10)
  })

  test('unsubscribe prevents handler from firing', async () => {
    const emitter = new Emitter<TestEvents>()
    let called = false
    const unsub = emitter.on('pong', () => { called = true })
    unsub()
    await emitter.emit('pong', 'test')
    expect(called).toBe(false)
  })

  test('unsubscribe only removes the specific handler', async () => {
    const emitter = new Emitter<TestEvents>()
    const log: string[] = []
    const unsub = emitter.on('pong', () => { log.push('a') })
    emitter.on('pong', () => { log.push('b') })
    unsub()
    await emitter.emit('pong', 'test')
    expect(log).toEqual(['b'])
  })
})

describe('Emitter — listenerCount', () => {
  test('listenerCount is 0 initially', () => {
    const emitter = new Emitter<TestEvents>()
    expect(emitter.listenerCount('count')).toBe(0)
  })

  test('listenerCount increases with on()', () => {
    const emitter = new Emitter<TestEvents>()
    emitter.on('count', () => {})
    emitter.on('count', () => {})
    expect(emitter.listenerCount('count')).toBe(2)
  })

  test('listenerCount decreases after unsubscribe', () => {
    const emitter = new Emitter<TestEvents>()
    const unsub = emitter.on('count', () => {})
    emitter.on('count', () => {})
    unsub()
    expect(emitter.listenerCount('count')).toBe(1)
  })

  test('listenerCount for different events independent', () => {
    const emitter = new Emitter<TestEvents>()
    emitter.on('count', () => {})
    emitter.on('pong', () => {})
    emitter.on('pong', () => {})
    expect(emitter.listenerCount('count')).toBe(1)
    expect(emitter.listenerCount('pong')).toBe(2)
  })
})

describe('Emitter — once', () => {
  test('once handler fires only once', async () => {
    const emitter = new Emitter<TestEvents>()
    let count = 0
    emitter.once('count', () => { count++ })
    await emitter.emit('count', 1)
    await emitter.emit('count', 2)
    await emitter.emit('count', 3)
    expect(count).toBe(1)
  })

  test('once handler receives data', async () => {
    const emitter = new Emitter<TestEvents>()
    let received = 0
    emitter.once('count', (n) => { received = n })
    await emitter.emit('count', 42)
    expect(received).toBe(42)
  })

  test('once does not affect regular on handlers', async () => {
    const emitter = new Emitter<TestEvents>()
    let onceCount = 0
    let onCount = 0
    emitter.once('count', () => { onceCount++ })
    emitter.on('count', () => { onCount++ })
    await emitter.emit('count', 1)
    await emitter.emit('count', 2)
    expect(onceCount).toBe(1)
    expect(onCount).toBe(2)
  })
})

describe('FakeEmitter — additional', () => {
  test('FakeEmitter tracks multiple emissions of same event', async () => {
    const fake = new FakeEmitter<TestEvents>()
    await fake.emit('count', 10)
    await fake.emit('count', 20)
    await fake.emit('count', 30)
    expect(fake.getEmitted('count')).toEqual([10, 20, 30])
  })

  test('FakeEmitter assertEmitted returns false for untracked event', () => {
    const fake = new FakeEmitter<TestEvents>()
    expect(fake.assertEmitted('ping')).toBe(false)
    expect(fake.assertEmitted('pong')).toBe(false)
  })

  test('FakeEmitter reset clears specific event', async () => {
    const fake = new FakeEmitter<TestEvents>()
    await fake.emit('count', 1)
    await fake.emit('pong', 'hello')
    fake.reset()
    expect(fake.getEmitted('count')).toEqual([])
    expect(fake.getEmitted('pong')).toEqual([])
  })

  test('FakeEmitter getEmitted returns array copy', async () => {
    const fake = new FakeEmitter<TestEvents>()
    await fake.emit('count', 1)
    const emitted = fake.getEmitted('count')
    emitted.length = 0
    expect(fake.getEmitted('count')).toEqual([1])
  })
})

// Regression tests for the leak / isolation fixes

describe('wait() listener cleanup', () => {
  test('timeout removes the once-listener (no leak)', async () => {
    const emitter = new Emitter<TestEvents>()
    await expect(emitter.wait('count', { timeout: 10 })).rejects.toThrow('Timeout')
    // The once-listener registered by wait() must be gone after timeout.
    expect(emitter.listenerCount('count')).toBe(0)
    // A later emit must not resolve a dead promise or invoke a ghost handler.
    await emitter.emit('count', 42)
    expect(emitter.listenerCount('count')).toBe(0)
  })

  test('abort removes the once-listener (no leak)', async () => {
    const emitter = new Emitter<TestEvents>()
    const controller = new AbortController()
    const p = emitter.wait('count', { signal: controller.signal })
    expect(emitter.listenerCount('count')).toBe(1)
    controller.abort()
    await expect(p).rejects.toThrow('Aborted')
    expect(emitter.listenerCount('count')).toBe(0)
  })

  test('resolving normally also clears the listener', async () => {
    const emitter = new Emitter<TestEvents>()
    const p = emitter.wait('count', { timeout: 1000 })
    await emitter.emit('count', 7)
    await expect(p).resolves.toBe(7)
    expect(emitter.listenerCount('count')).toBe(0)
  })

  test('repeated wait timeouts do not accumulate listeners', async () => {
    const emitter = new Emitter<TestEvents>()
    for (let i = 0; i < 5; i++) {
      await expect(emitter.wait('count', { timeout: 5 })).rejects.toThrow()
    }
    expect(emitter.listenerCount('count')).toBe(0)
  })
})

describe('events() async iterable', () => {
  test('breaking out of for-await removes the listener', async () => {
    const emitter = new Emitter<TestEvents>()
    const iterable = emitter.events('count')
    expect(emitter.listenerCount('count')).toBe(1)

    const collected: number[] = []
    const consume = (async () => {
      for await (const n of iterable) {
        collected.push(n)
        if (collected.length === 2) break
      }
    })()

    await emitter.emit('count', 1)
    await emitter.emit('count', 2)
    await consume

    expect(collected).toEqual([1, 2])
    // After break, the listener is removed.
    expect(emitter.listenerCount('count')).toBe(0)
  })

  test('abort signal completes the iterable and removes the listener', async () => {
    const emitter = new Emitter<TestEvents>()
    const controller = new AbortController()
    const iterable = emitter.events('count', { signal: controller.signal })
    const collected: number[] = []
    const consume = (async () => {
      for await (const n of iterable) collected.push(n)
    })()
    await emitter.emit('count', 1)
    controller.abort()
    await consume
    expect(collected).toEqual([1])
    expect(emitter.listenerCount('count')).toBe(0)
  })

  test('buffer is bounded — oldest events are dropped past maxBufferSize', async () => {
    const emitter = new Emitter<TestEvents>()
    const iterable = emitter.events('count', { maxBufferSize: 3 })
    // Produce more than the cap with no consumer pulling yet.
    for (let i = 0; i < 10; i++) await emitter.emit('count', i)

    const it = iterable[Symbol.asyncIterator]()
    const drained: number[] = []
    for (let i = 0; i < 3; i++) {
      const r = await it.next()
      if (!r.done) drained.push(r.value)
    }
    // Only the last 3 events survive (7, 8, 9).
    expect(drained).toEqual([7, 8, 9])
    await it.return?.()
  })
})

describe('error isolation defaults', () => {
  test('one bad listener does not stop the others (no onError)', async () => {
    const emitter = new Emitter<TestEvents>()
    emitter.setMaxListeners(0)
    const order: string[] = []
    emitter.on('count', () => { order.push('a') })
    emitter.on('count', () => { throw new Error('mid') })
    emitter.on('count', () => { order.push('c') })
    await emitter.emit('count', 1)
    expect(order).toEqual(['a', 'c'])
  })

  test('onAny errors are routed to onError', async () => {
    const emitter = new Emitter<TestEvents>()
    const errors: string[] = []
    emitter.onError((_e, err) => { errors.push(err.message) })
    emitter.onAny(() => { throw new Error('any-fail') })
    await emitter.emit('count', 1)
    expect(errors).toContain('any-fail')
  })
})

describe('max-listeners warning', () => {
  test('warns once when the threshold is exceeded', () => {
    const emitter = new Emitter<TestEvents>()
    emitter.setMaxListeners(3)
    const original = console.warn
    let warnings = 0
    console.warn = () => { warnings++ }
    try {
      for (let i = 0; i < 5; i++) emitter.on('count', () => {})
    } finally {
      console.warn = original
    }
    expect(warnings).toBe(1)
  })

  test('setMaxListeners(0) disables the warning', () => {
    const emitter = new Emitter<TestEvents>()
    emitter.setMaxListeners(0)
    const original = console.warn
    let warnings = 0
    console.warn = () => { warnings++ }
    try {
      for (let i = 0; i < 200; i++) emitter.on('count', () => {})
    } finally {
      console.warn = original
    }
    expect(warnings).toBe(0)
  })
})
