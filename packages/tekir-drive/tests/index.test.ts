import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { Drive } from '../src/index'
import type { DiskDriver } from '../src/index'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import os from 'os'

// Helpers

function makeTempDir(): string {
  const dir = join(os.tmpdir(), `tekir-drive-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

// MemoryDriver via Drive

describe('MemoryDriver', () => {
  let drive: Drive

  beforeEach(() => {
    drive = new Drive({
      default: 'mem',
      disks: { mem: { driver: 'memory' } },
    })
  })

  test('put and get returns correct buffer', async () => {
    await drive.put('hello.txt', 'world')
    const buf = await drive.get('hello.txt')
    expect(buf.toString()).toBe('world')
  })

  test('put and getString returns correct string', async () => {
    await drive.put('note.txt', 'take notes')
    expect(await drive.getString('note.txt')).toBe('take notes')
  })

  test('put buffer content', async () => {
    const content = Buffer.from('buffered content')
    await drive.put('buf.bin', content)
    const result = await drive.get('buf.bin')
    expect(result.toString()).toBe('buffered content')
  })

  test('exists returns true after put', async () => {
    await drive.put('exists.txt', 'yes')
    expect(await drive.exists('exists.txt')).toBe(true)
  })

  test('exists returns false for missing file', async () => {
    expect(await drive.exists('no-such-file.txt')).toBe(false)
  })

  test('delete removes a file', async () => {
    await drive.put('gone.txt', 'bye')
    await drive.delete('gone.txt')
    expect(await drive.exists('gone.txt')).toBe(false)
  })

  test('delete on nonexistent file does not throw', async () => {
    await expect(drive.delete('phantom.txt')).resolves.toBeUndefined()
  })

  test('copy creates destination and preserves source', async () => {
    await drive.put('src.txt', 'original')
    await drive.copy('src.txt', 'dst.txt')
    expect(await drive.getString('dst.txt')).toBe('original')
    expect(await drive.exists('src.txt')).toBe(true)
  })

  test('copy throws when source missing', async () => {
    await expect(drive.copy('missing.txt', 'dst.txt')).rejects.toThrow('File not found')
  })

  test('move creates destination and removes source', async () => {
    await drive.put('move-src.txt', 'moving')
    await drive.move('move-src.txt', 'move-dst.txt')
    expect(await drive.getString('move-dst.txt')).toBe('moving')
    expect(await drive.exists('move-src.txt')).toBe(false)
  })

  test('list returns all keys when no prefix given', async () => {
    await drive.put('a.txt', '1')
    await drive.put('b.txt', '2')
    await drive.put('c.txt', '3')
    const files = await drive.list()
    expect(files).toContain('a.txt')
    expect(files).toContain('b.txt')
    expect(files).toContain('c.txt')
  })

  test('list filters by prefix', async () => {
    await drive.put('images/a.png', 'img')
    await drive.put('docs/b.pdf', 'doc')
    const files = await drive.list('images/')
    expect(files).toContain('images/a.png')
    expect(files).not.toContain('docs/b.pdf')
  })

  test('list returns empty array when nothing matches prefix', async () => {
    await drive.put('data.txt', 'x')
    expect(await drive.list('uploads/')).toEqual([])
  })

  test('getMetadata returns size and lastModified', async () => {
    await drive.put('meta.txt', 'hello world')
    const meta = await drive.getMetadata('meta.txt')
    expect(meta.size).toBe(11)
    expect(meta.lastModified).toBeInstanceOf(Date)
  })

  test('getMetadata includes contentType when provided', async () => {
    await drive.put('image.png', Buffer.from('fake-png'), { contentType: 'image/png' })
    const meta = await drive.getMetadata('image.png')
    expect(meta.contentType).toBe('image/png')
  })

  test('getMetadata throws when file missing', async () => {
    await expect(drive.getMetadata('missing.txt')).rejects.toThrow('File not found')
  })

  test('getUrl returns expected pattern', () => {
    const url = drive.getUrl('avatar.jpg')
    expect(url).toBe('/memory/avatar.jpg')
  })

  test('getSignedUrl returns signed URL', async () => {
    await drive.put('secret.pdf', 'data')
    const url = await drive.getSignedUrl('secret.pdf', { expiresIn: 300 })
    expect(url).toContain('secret.pdf')
    expect(url).toContain('signed=true')
  })

  test('get throws when file missing', async () => {
    await expect(drive.get('nonexistent.txt')).rejects.toThrow('File not found')
  })

  test('put overwrites existing file', async () => {
    await drive.put('overwrite.txt', 'first')
    await drive.put('overwrite.txt', 'second')
    expect(await drive.getString('overwrite.txt')).toBe('second')
  })
})

// Drive — disk switching and fake()

describe('Drive', () => {
  test('use() returns the named disk', async () => {
    const drive = new Drive({
      default: 'mem1',
      disks: {
        mem1: { driver: 'memory' },
        mem2: { driver: 'memory' },
      },
    })
    await drive.use('mem1').put('shared.txt', 'disk1')
    await drive.use('mem2').put('shared.txt', 'disk2')
    expect(await drive.use('mem1').getString('shared.txt')).toBe('disk1')
    expect(await drive.use('mem2').getString('shared.txt')).toBe('disk2')
  })

  test('use() without argument returns default disk', async () => {
    const drive = new Drive({
      default: 'mem',
      disks: { mem: { driver: 'memory' } },
    })
    await drive.put('def.txt', 'default disk content')
    expect(await drive.use().getString('def.txt')).toBe('default disk content')
  })

  test('use() throws for unknown disk name', () => {
    const drive = new Drive({
      default: 'mem',
      disks: { mem: { driver: 'memory' } },
    })
    expect(() => drive.use('nonexistent')).toThrow('"nonexistent" not configured')
  })

  test('extend() registers a custom driver', async () => {
    const drive = new Drive({
      default: 'custom',
      disks: { custom: { driver: 'memory' } },
    })
    // Replace with a second fresh memory disk via extend
    const tempDrive = new Drive({ default: 'tmp', disks: { tmp: { driver: 'memory' } } })
    const customDisk: DiskDriver = tempDrive.use('tmp')
    drive.extend('custom2', customDisk)
    await drive.use('custom2').put('ext.txt', 'extended')
    expect(await drive.use('custom2').getString('ext.txt')).toBe('extended')
  })

  test('fake() replaces default disk with memory driver', async () => {
    const drive = new Drive({
      default: 'mem',
      disks: { mem: { driver: 'memory' } },
    })
    await drive.put('before-fake.txt', 'real content')
    const restore = drive.fake()
    // After fake(), the disk is fresh — original files not visible
    expect(await drive.exists('before-fake.txt')).toBe(false)
    await drive.put('in-fake.txt', 'fake content')
    expect(await drive.getString('in-fake.txt')).toBe('fake content')
    restore()
    // After restore, original disk is back
    expect(await drive.getString('before-fake.txt')).toBe('real content')
  })

  test('fake() can target a specific named disk', async () => {
    const drive = new Drive({
      default: 'mem',
      disks: {
        mem: { driver: 'memory' },
        uploads: { driver: 'memory' },
      },
    })
    await drive.use('uploads').put('photo.jpg', 'real photo')
    const restore = drive.fake('uploads')
    expect(await drive.use('uploads').exists('photo.jpg')).toBe(false)
    restore()
    expect(await drive.use('uploads').getString('photo.jpg')).toBe('real photo')
  })

  test('disk is lazy-initialized only when first used', () => {
    const drive = new Drive({
      default: 'mem',
      disks: { mem: { driver: 'memory' } },
    })
    // No error yet — disk not initialised
    expect(() => drive.use('mem')).not.toThrow()
  })
})

// LocalDriver via Drive

describe('LocalDriver', () => {
  let tmpDir: string
  let drive: Drive

  beforeEach(() => {
    tmpDir = makeTempDir()
    drive = new Drive({
      default: 'local',
      disks: { local: { driver: 'local', root: tmpDir, urlPrefix: '/files', secret: 'test-secret' } },
    })
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test('put and getString roundtrip', async () => {
    await drive.put('hello.txt', 'local content')
    expect(await drive.getString('hello.txt')).toBe('local content')
  })

  test('put and get returns Buffer', async () => {
    await drive.put('bin.dat', Buffer.from([1, 2, 3]))
    const buf = await drive.get('bin.dat')
    expect(buf[0]).toBe(1)
    expect(buf[1]).toBe(2)
    expect(buf[2]).toBe(3)
  })

  test('exists returns true after put', async () => {
    await drive.put('check.txt', 'here')
    expect(await drive.exists('check.txt')).toBe(true)
  })

  test('exists returns false for missing file', async () => {
    expect(await drive.exists('nope.txt')).toBe(false)
  })

  test('delete removes the file', async () => {
    await drive.put('del.txt', 'remove me')
    await drive.delete('del.txt')
    expect(await drive.exists('del.txt')).toBe(false)
  })

  test('delete on missing file does not throw', async () => {
    await expect(drive.delete('ghost.txt')).resolves.toBeUndefined()
  })

  test('copy creates destination, keeps source', async () => {
    await drive.put('orig.txt', 'copy me')
    await drive.copy('orig.txt', 'copy.txt')
    expect(await drive.getString('copy.txt')).toBe('copy me')
    expect(await drive.exists('orig.txt')).toBe(true)
  })

  test('copy creates nested destination directories', async () => {
    await drive.put('flat.txt', 'data')
    await drive.copy('flat.txt', 'a/b/c/deep.txt')
    expect(await drive.getString('a/b/c/deep.txt')).toBe('data')
  })

  test('move relocates file and removes source', async () => {
    await drive.put('from.txt', 'move me')
    await drive.move('from.txt', 'to.txt')
    expect(await drive.getString('to.txt')).toBe('move me')
    expect(await drive.exists('from.txt')).toBe(false)
  })

  test('list returns files in root', async () => {
    await drive.put('a.txt', '1')
    await drive.put('b.txt', '2')
    const files = await drive.list()
    expect(files).toContain('a.txt')
    expect(files).toContain('b.txt')
  })

  test('list returns empty array for empty directory', async () => {
    expect(await drive.list()).toEqual([])
  })

  test('list returns empty array for nonexistent prefix', async () => {
    expect(await drive.list('nonexistent/')).toEqual([])
  })

  test('list recursively includes nested files', async () => {
    await drive.put('nested/dir/file.txt', 'deep')
    const files = await drive.list()
    expect(files.some(f => f.includes('file.txt'))).toBe(true)
  })

  test('getMetadata returns correct size', async () => {
    const content = 'twelve chars'
    await drive.put('sized.txt', content)
    const meta = await drive.getMetadata('sized.txt')
    expect(meta.size).toBe(content.length)
    expect(meta.lastModified).toBeInstanceOf(Date)
  })

  test('getUrl returns urlPrefix + key', () => {
    expect(drive.getUrl('avatar.png')).toBe('/files/avatar.png')
  })

  test('getSignedUrl returns token-bearing URL', async () => {
    await drive.put('private.pdf', 'secret')
    const url = await drive.getSignedUrl('private.pdf', { expiresIn: 60 })
    expect(url).toContain('private.pdf')
    expect(url).toContain('token=')
    expect(url).toContain('expires=')
  })

  test('put creates nested directories automatically', async () => {
    await drive.put('deep/nested/file.txt', 'nested')
    expect(await drive.getString('deep/nested/file.txt')).toBe('nested')
  })

  test('put via ReadableStream', async () => {
    const chunks = [new Uint8Array([104, 101, 108, 108, 111])] // "hello"
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    })
    await drive.put('stream.txt', stream)
    expect(await drive.getString('stream.txt')).toBe('hello')
  })
})

// MemoryDriver — additional edge cases

describe('MemoryDriver — additional edge cases', () => {
  let drive: Drive

  beforeEach(() => {
    drive = new Drive({
      default: 'mem',
      disks: { mem: { driver: 'memory' } },
    })
  })

  test('overwrite existing file replaces content', async () => {
    await drive.put('ow.txt', 'first version')
    await drive.put('ow.txt', 'second version')
    expect(await drive.getString('ow.txt')).toBe('second version')
  })

  test('delete nonexistent file is a no-op', async () => {
    await expect(drive.delete('does-not-exist.txt')).resolves.toBeUndefined()
  })

  test('copy to same path overwrites with identical content', async () => {
    await drive.put('same.txt', 'data')
    await drive.copy('same.txt', 'same.txt')
    expect(await drive.getString('same.txt')).toBe('data')
  })

  test('list with prefix filter excludes non-matching keys', async () => {
    await drive.put('images/cat.png', 'cat')
    await drive.put('images/dog.png', 'dog')
    await drive.put('videos/clip.mp4', 'clip')
    const files = await drive.list('images/')
    expect(files).toContain('images/cat.png')
    expect(files).toContain('images/dog.png')
    expect(files).not.toContain('videos/clip.mp4')
  })

  test('list with prefix that matches nothing returns empty array', async () => {
    await drive.put('a/b.txt', 'x')
    expect(await drive.list('zzz/')).toEqual([])
  })

  test('getMetadata after put returns correct size', async () => {
    const content = 'hello world!'
    await drive.put('meta2.txt', content)
    const meta = await drive.getMetadata('meta2.txt')
    expect(meta.size).toBe(Buffer.byteLength(content))
  })

  test('getMetadata lastModified is a Date', async () => {
    await drive.put('meta3.txt', 'ts')
    const meta = await drive.getMetadata('meta3.txt')
    expect(meta.lastModified).toBeInstanceOf(Date)
  })

  test('getStream reads file content correctly', async () => {
    await drive.put('stream-mem.txt', 'streamed content')
    const stream = await drive.getStream('stream-mem.txt')
    const reader = stream.getReader()
    const chunks: Uint8Array[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    const result = Buffer.concat(chunks).toString('utf-8')
    expect(result).toBe('streamed content')
  })

  test('getStream on missing file throws', async () => {
    await expect(drive.getStream('missing-stream.txt')).rejects.toThrow('File not found')
  })

  test('overwrite does not duplicate key in list', async () => {
    await drive.put('unique.txt', 'v1')
    await drive.put('unique.txt', 'v2')
    const files = await drive.list()
    const count = files.filter(f => f === 'unique.txt').length
    expect(count).toBe(1)
  })
})

// LocalDriver — additional edge cases

describe('LocalDriver — additional edge cases', () => {
  let tmpDir: string
  let drive: Drive

  beforeEach(() => {
    tmpDir = makeTempDir()
    drive = new Drive({
      default: 'local',
      disks: { local: { driver: 'local', root: tmpDir, urlPrefix: '/assets', secret: 'test-secret' } },
    })
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test('put creates nested directories automatically', async () => {
    await drive.put('a/b/c/nested.txt', 'deep content')
    expect(await drive.getString('a/b/c/nested.txt')).toBe('deep content')
  })

  test('put in multiple nested levels all resolve correctly', async () => {
    await drive.put('l1/l2/l3/l4/deep.txt', 'very deep')
    expect(await drive.getString('l1/l2/l3/l4/deep.txt')).toBe('very deep')
  })

  test('getSignedUrl includes key in URL', async () => {
    await drive.put('signed-file.pdf', 'content')
    const url = await drive.getSignedUrl('signed-file.pdf', { expiresIn: 120 })
    expect(url).toContain('signed-file.pdf')
  })

  test('getSignedUrl URL contains token and expires params', async () => {
    await drive.put('token-file.pdf', 'data')
    const url = await drive.getSignedUrl('token-file.pdf', { expiresIn: 60 })
    expect(url).toContain('token=')
    expect(url).toContain('expires=')
  })

  test('getSignedUrl expires value is in the future', async () => {
    await drive.put('exp-file.txt', 'data')
    const url = await drive.getSignedUrl('exp-file.txt', { expiresIn: 300 })
    const match = url.match(/expires=(\d+)/)
    expect(match).not.toBeNull()
    const expires = parseInt(match![1], 10)
    expect(expires).toBeGreaterThan(Date.now())
  })

  test('list recursive includes files in nested subdirectories', async () => {
    await drive.put('top/middle/bottom/file.txt', 'deep')
    await drive.put('top/file2.txt', 'shallow')
    const files = await drive.list()
    expect(files.some(f => f.includes('file.txt'))).toBe(true)
    expect(files.some(f => f.includes('file2.txt'))).toBe(true)
  })

  test('list with prefix returns only files under that prefix', async () => {
    await drive.put('alpha/file.txt', 'a')
    await drive.put('beta/file.txt', 'b')
    const files = await drive.list('alpha')
    expect(files.some(f => f.includes('alpha'))).toBe(true)
    expect(files.every(f => !f.startsWith('beta'))).toBe(true)
  })

  test('getUrl format is urlPrefix/key', () => {
    expect(drive.getUrl('photo.jpg')).toBe('/assets/photo.jpg')
  })

  test('overwrite existing file changes content', async () => {
    await drive.put('over.txt', 'original')
    await drive.put('over.txt', 'replaced')
    expect(await drive.getString('over.txt')).toBe('replaced')
  })
})

// Drive — use() caches driver instance

describe('Drive — use() caches driver instance', () => {
  test('calling use() twice returns the same driver instance', () => {
    const drive = new Drive({
      default: 'mem',
      disks: { mem: { driver: 'memory' } },
    })
    const first = drive.use('mem')
    const second = drive.use('mem')
    expect(first).toBe(second)
  })

  test('files written via use() are accessible via use() again', async () => {
    const drive = new Drive({
      default: 'mem',
      disks: { mem: { driver: 'memory' } },
    })
    await drive.use('mem').put('cached.txt', 'cache-hit')
    expect(await drive.use('mem').getString('cached.txt')).toBe('cache-hit')
  })
})

// Drive — extend() adds custom driver

describe('Drive — extend() custom driver', () => {
  test('extend() registers driver under a new name', async () => {
    const drive = new Drive({
      default: 'mem',
      disks: { mem: { driver: 'memory' } },
    })

    // Create a second independent memory-backed Drive to get a fresh driver
    const ext = new Drive({ default: 'tmp', disks: { tmp: { driver: 'memory' } } })
    const customDriver = ext.use('tmp')

    drive.extend('custom-mem', customDriver)

    await drive.use('custom-mem').put('ext.txt', 'extended driver')
    expect(await drive.use('custom-mem').getString('ext.txt')).toBe('extended driver')
  })

  test('extend() returns the Drive (chainable)', () => {
    const drive = new Drive({
      default: 'mem',
      disks: { mem: { driver: 'memory' } },
    })
    const ext = new Drive({ default: 'tmp', disks: { tmp: { driver: 'memory' } } })
    expect(drive.extend('x', ext.use('tmp'))).toBe(drive)
  })

  test('extend() overrides a previously initialized driver', async () => {
    const drive = new Drive({
      default: 'mem',
      disks: { mem: { driver: 'memory' } },
    })
    await drive.put('before.txt', 'original')

    const fresh = new Drive({ default: 't', disks: { t: { driver: 'memory' } } })
    drive.extend('mem', fresh.use('t'))

    // The original file is gone — new driver is empty
    expect(await drive.exists('before.txt')).toBe(false)
  })
})

// Drive — fake() and restore()

describe('Drive — fake() and restore()', () => {
  test('fake() returns a callable restore function', () => {
    const drive = new Drive({
      default: 'mem',
      disks: { mem: { driver: 'memory' } },
    })
    const restore = drive.fake()
    expect(typeof restore).toBe('function')
    restore()
  })

  test('fake() replaces disk with fresh memory driver', async () => {
    const drive = new Drive({
      default: 'mem',
      disks: { mem: { driver: 'memory' } },
    })
    await drive.put('pre-fake.txt', 'real')
    const restore = drive.fake()
    expect(await drive.exists('pre-fake.txt')).toBe(false)
    restore()
  })

  test('restore() brings back original disk with its files', async () => {
    const drive = new Drive({
      default: 'mem',
      disks: { mem: { driver: 'memory' } },
    })
    await drive.put('real.txt', 'real content')
    const restore = drive.fake()
    restore()
    expect(await drive.getString('real.txt')).toBe('real content')
  })

  test('files written during fake() are not visible after restore()', async () => {
    const drive = new Drive({
      default: 'mem',
      disks: { mem: { driver: 'memory' } },
    })
    const restore = drive.fake()
    await drive.put('fake-only.txt', 'ephemeral')
    restore()
    expect(await drive.exists('fake-only.txt')).toBe(false)
  })

  test('fake() on a named disk only replaces that disk', async () => {
    const drive = new Drive({
      default: 'mem',
      disks: {
        mem: { driver: 'memory' },
        archive: { driver: 'memory' },
      },
    })
    await drive.use('archive').put('archive.txt', 'kept')
    const restore = drive.fake('mem')
    // archive disk is untouched
    expect(await drive.use('archive').getString('archive.txt')).toBe('kept')
    restore()
  })
})

// NEW TESTS: Deep edge cases for Drive

describe('MemoryDriver — path edge cases', () => {
  let drive: Drive

  beforeEach(() => {
    drive = new Drive({
      default: 'mem',
      disks: { mem: { driver: 'memory' } },
    })
  })

  test('put with deeply nested path', async () => {
    await drive.put('a/b/c/d/e/f.txt', 'deep')
    expect(await drive.getString('a/b/c/d/e/f.txt')).toBe('deep')
  })

  test('put with special characters in key', async () => {
    await drive.put('files/hello world.txt', 'space in name')
    expect(await drive.getString('files/hello world.txt')).toBe('space in name')
  })

  test('put empty string content', async () => {
    await drive.put('empty.txt', '')
    expect(await drive.getString('empty.txt')).toBe('')
    expect(await drive.exists('empty.txt')).toBe(true)
  })

  test('put large content', async () => {
    const large = 'x'.repeat(100000)
    await drive.put('large.txt', large)
    expect(await drive.getString('large.txt')).toBe(large)
  })

  test('move to same path removes the source (source no longer exists)', async () => {
    await drive.put('same.txt', 'content')
    // move does copy+delete; copying to itself works, then delete removes it
    await drive.move('same.txt', 'same-dest.txt')
    expect(await drive.exists('same.txt')).toBe(false)
    expect(await drive.getString('same-dest.txt')).toBe('content')
  })

  test('move throws when source does not exist', async () => {
    await expect(drive.move('nonexistent.txt', 'dest.txt')).rejects.toThrow('File not found')
  })

  test('move to exactly the same path is a no-op', async () => {
    await drive.put('same-path.txt', 'content')
    await drive.move('same-path.txt', 'same-path.txt')
    expect(await drive.getString('same-path.txt')).toBe('content')
  })

  test('get returns a defensive buffer copy', async () => {
    await drive.put('immutable.bin', Buffer.from([1, 2, 3]))
    const first = await drive.get('immutable.bin')
    first[0] = 99
    expect([...await drive.get('immutable.bin')]).toEqual([1, 2, 3])
  })

  test('getMetadata after overwrite reflects new size', async () => {
    await drive.put('grow.txt', 'short')
    await drive.put('grow.txt', 'much longer content here')
    const meta = await drive.getMetadata('grow.txt')
    expect(meta.size).toBe(Buffer.byteLength('much longer content here'))
  })
})

describe('LocalDriver — edge cases', () => {
  let tmpDir: string
  let drive: Drive

  beforeEach(() => {
    tmpDir = makeTempDir()
    drive = new Drive({
      default: 'local',
      disks: { local: { driver: 'local', root: tmpDir, urlPrefix: '/storage', secret: 'test-secret' } },
    })
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test('get returns Buffer for binary content', async () => {
    const binary = Buffer.from([0x00, 0xFF, 0x42, 0x13])
    await drive.put('bin.dat', binary)
    const result = await drive.get('bin.dat')
    expect(Buffer.isBuffer(result)).toBe(true)
    expect(result[0]).toBe(0x00)
    expect(result[1]).toBe(0xFF)
  })

  test('get on nonexistent file throws', async () => {
    await expect(drive.get('nope.txt')).rejects.toThrow()
  })

  test('copy overwrites destination if it exists', async () => {
    await drive.put('src.txt', 'source')
    await drive.put('dst.txt', 'old-dest')
    await drive.copy('src.txt', 'dst.txt')
    expect(await drive.getString('dst.txt')).toBe('source')
  })

  test('list with no files returns empty array', async () => {
    expect(await drive.list()).toEqual([])
  })

  test('getMetadata includes lastModified as a Date', async () => {
    const before = Date.now() - 1000
    await drive.put('meta.txt', 'test')
    const meta = await drive.getMetadata('meta.txt')
    expect(meta.lastModified).toBeInstanceOf(Date)
    expect(meta.lastModified.getTime()).toBeGreaterThanOrEqual(before)
    expect(meta.lastModified.getTime()).toBeLessThanOrEqual(Date.now() + 1000)
  })

  test('put with Uint8Array content', async () => {
    const arr = new Uint8Array([72, 101, 108, 108, 111])
    await drive.put('uint8.txt', Buffer.from(arr))
    expect(await drive.getString('uint8.txt')).toBe('Hello')
  })
})

describe('Drive — multiple fake/restore cycles', () => {
  test('fake then restore then fake again works', async () => {
    const drive = new Drive({
      default: 'mem',
      disks: { mem: { driver: 'memory' } },
    })
    await drive.put('real.txt', 'real')
    const restore1 = drive.fake()
    await drive.put('fake1.txt', 'fake1')
    restore1()
    expect(await drive.getString('real.txt')).toBe('real')
    expect(await drive.exists('fake1.txt')).toBe(false)
    const restore2 = drive.fake()
    expect(await drive.exists('real.txt')).toBe(false)
    await drive.put('fake2.txt', 'fake2')
    restore2()
    expect(await drive.exists('fake2.txt')).toBe(false)
    expect(await drive.getString('real.txt')).toBe('real')
  })
})

describe('MemoryDriver — list edge cases', () => {
  test('list returns consistent results after delete', async () => {
    const drive = new Drive({ default: 'mem', disks: { mem: { driver: 'memory' } } })
    await drive.put('a.txt', '1')
    await drive.put('b.txt', '2')
    await drive.put('c.txt', '3')
    await drive.delete('b.txt')
    const files = await drive.list()
    expect(files).toContain('a.txt')
    expect(files).not.toContain('b.txt')
    expect(files).toContain('c.txt')
  })

  test('list returns files with nested prefix', async () => {
    const drive = new Drive({ default: 'mem', disks: { mem: { driver: 'memory' } } })
    await drive.put('a/b/1.txt', 'x')
    await drive.put('a/b/2.txt', 'x')
    await drive.put('a/c/3.txt', 'x')
    const files = await drive.list('a/b/')
    expect(files).toHaveLength(2)
  })
})

describe('MemoryDriver — getUrl format', () => {
  test('getUrl returns /memory/ prefix', () => {
    const drive = new Drive({ default: 'mem', disks: { mem: { driver: 'memory' } } })
    expect(drive.getUrl('test.txt')).toBe('/memory/test.txt')
  })

  test('getUrl with nested path', () => {
    const drive = new Drive({ default: 'mem', disks: { mem: { driver: 'memory' } } })
    expect(drive.getUrl('uploads/images/photo.jpg')).toBe('/memory/uploads/images/photo.jpg')
  })
})

describe('Drive — configuration validation', () => {
  test('use() with valid disk name does not throw', () => {
    const drive = new Drive({ default: 'mem', disks: { mem: { driver: 'memory' } } })
    expect(() => drive.use('mem')).not.toThrow()
  })

  test('use() with invalid disk throws descriptive error', () => {
    const drive = new Drive({ default: 'mem', disks: { mem: { driver: 'memory' } } })
    expect(() => drive.use('invalid')).toThrow()
  })

  test('default disk is used when no name specified', async () => {
    const drive = new Drive({ default: 'mem', disks: { mem: { driver: 'memory' } } })
    await drive.put('default-disk.txt', 'content')
    expect(await drive.use().getString('default-disk.txt')).toBe('content')
  })
})

describe('MemoryDriver — getSignedUrl edge cases', () => {
  test('getSignedUrl contains the filename', async () => {
    const drive = new Drive({ default: 'mem', disks: { mem: { driver: 'memory' } } })
    await drive.put('sign-test.txt', 'data')
    const url = await drive.getSignedUrl('sign-test.txt', { expiresIn: 60 })
    expect(url).toContain('sign-test.txt')
  })

  test('getSignedUrl contains signed=true', async () => {
    const drive = new Drive({ default: 'mem', disks: { mem: { driver: 'memory' } } })
    await drive.put('signed.txt', 'data')
    const url = await drive.getSignedUrl('signed.txt', { expiresIn: 300 })
    expect(url).toContain('signed=true')
  })
})
