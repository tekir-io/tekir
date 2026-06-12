import { test, expect, describe } from 'bun:test'
import { Drive } from '../src/index'

describe('MemoryDriver — security', () => {
  test('put and get roundtrip', async () => {
    const d = new Drive({ default: 'mem', disks: { mem: { driver: 'memory' } } })
    await d.put('test.txt', 'content')
    expect(await d.getString('test.txt')).toBe('content')
  })

  test('delete removes file', async () => {
    const d = new Drive({ default: 'mem', disks: { mem: { driver: 'memory' } } })
    await d.put('del.txt', 'x')
    await d.delete('del.txt')
    expect(await d.exists('del.txt')).toBe(false)
  })

  test('copy preserves source', async () => {
    const d = new Drive({ default: 'mem', disks: { mem: { driver: 'memory' } } })
    await d.put('src.txt', 'data')
    await d.copy('src.txt', 'dst.txt')
    expect(await d.exists('src.txt')).toBe(true)
    expect(await d.getString('dst.txt')).toBe('data')
  })

  test('move removes source', async () => {
    const d = new Drive({ default: 'mem', disks: { mem: { driver: 'memory' } } })
    await d.put('mv.txt', 'data')
    await d.move('mv.txt', 'moved.txt')
    expect(await d.exists('mv.txt')).toBe(false)
    expect(await d.getString('moved.txt')).toBe('data')
  })

  test('overwrite replaces content', async () => {
    const d = new Drive({ default: 'mem', disks: { mem: { driver: 'memory' } } })
    await d.put('ow.txt', 'v1')
    await d.put('ow.txt', 'v2')
    expect(await d.getString('ow.txt')).toBe('v2')
  })

  test('list returns all files', async () => {
    const d = new Drive({ default: 'mem', disks: { mem: { driver: 'memory' } } })
    await d.put('a.txt', '1')
    await d.put('b.txt', '2')
    const files = await d.list()
    expect(files).toContain('a.txt')
    expect(files).toContain('b.txt')
  })

  test('list with prefix filters', async () => {
    const d = new Drive({ default: 'mem', disks: { mem: { driver: 'memory' } } })
    await d.put('img/a.png', '1')
    await d.put('doc/b.pdf', '2')
    const files = await d.list('img/')
    expect(files).toContain('img/a.png')
    expect(files).not.toContain('doc/b.pdf')
  })

  test('exists false for missing', async () => {
    const d = new Drive({ default: 'mem', disks: { mem: { driver: 'memory' } } })
    expect(await d.exists('nope.txt')).toBe(false)
  })

  test('get throws for missing', async () => {
    const d = new Drive({ default: 'mem', disks: { mem: { driver: 'memory' } } })
    await expect(d.get('nope.txt')).rejects.toThrow()
  })

  test('getMetadata returns size', async () => {
    const d = new Drive({ default: 'mem', disks: { mem: { driver: 'memory' } } })
    await d.put('m.txt', 'hello')
    const meta = await d.getMetadata('m.txt')
    expect(meta.size).toBe(5)
  })

  test('getUrl returns path', () => {
    const d = new Drive({ default: 'mem', disks: { mem: { driver: 'memory' } } })
    expect(d.getUrl('file.txt')).toBe('/memory/file.txt')
  })

  test('fake replaces disk', async () => {
    const d = new Drive({ default: 'mem', disks: { mem: { driver: 'memory' } } })
    await d.put('real.txt', 'real')
    const restore = d.fake()
    expect(await d.exists('real.txt')).toBe(false)
    restore()
    expect(await d.getString('real.txt')).toBe('real')
  })

  test('use() returns same instance', () => {
    const d = new Drive({ default: 'mem', disks: { mem: { driver: 'memory' } } })
    expect(d.use('mem')).toBe(d.use('mem'))
  })

  test('use() unknown disk throws', () => {
    const d = new Drive({ default: 'mem', disks: { mem: { driver: 'memory' } } })
    expect(() => d.use('unknown')).toThrow()
  })

  test('buffer content roundtrip', async () => {
    const d = new Drive({ default: 'mem', disks: { mem: { driver: 'memory' } } })
    await d.put('bin.dat', Buffer.from([0xFF, 0x00, 0xAB]))
    const buf = await d.get('bin.dat')
    expect(buf[0]).toBe(0xFF)
  })

  test('nested key paths work', async () => {
    const d = new Drive({ default: 'mem', disks: { mem: { driver: 'memory' } } })
    await d.put('a/b/c/deep.txt', 'deep')
    expect(await d.getString('a/b/c/deep.txt')).toBe('deep')
  })

  test('empty string content', async () => {
    const d = new Drive({ default: 'mem', disks: { mem: { driver: 'memory' } } })
    await d.put('empty.txt', '')
    expect(await d.getString('empty.txt')).toBe('')
  })

  test('large content', async () => {
    const d = new Drive({ default: 'mem', disks: { mem: { driver: 'memory' } } })
    const big = 'x'.repeat(100000)
    await d.put('big.txt', big)
    expect(await d.getString('big.txt')).toBe(big)
  })
})
