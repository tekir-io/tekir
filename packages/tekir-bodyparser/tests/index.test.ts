import { test, expect, describe, afterEach } from 'bun:test'
import { UploadedFile, MultipartFiles } from '../src/index'
import { existsSync, rmSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Helper to create a File object
function createFile(name: string, content: string, type = 'text/plain'): File {
  return new File([content], name, { type })
}

// Magic-byte fixtures so tests that exercise the strict whitelist mode
// of `validateContent` use real, recognizable file content. The
// `extnames` whitelist now rejects unidentifiable buffers, so a file
// "named" `photo.jpg` with body `'data'` is correctly invalid; tests
// that mean to assert "this whitelist accepts this file" need real
// magic bytes for the format they claim.
const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
const JPEG_MAGIC = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10])
const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31])
function createImageFile(name: string, magic: Uint8Array, type: string, padBytes = 16): File {
  const content = new Uint8Array(magic.length + padBytes)
  content.set(magic, 0)
  return new File([content], name, { type })
}

// re-export parseSize for testing (it's not exported, test via UploadedFile)
describe('UploadedFile', () => {
  test('extracts metadata from File', async () => {
    const file = createFile('photo.jpg', 'fake-image-data', 'image/jpeg')
    const uploaded = new UploadedFile('avatar', file)
    await uploaded.init(file)

    expect(uploaded.fieldName).toBe('avatar')
    expect(uploaded.clientName).toBe('photo.jpg')
    expect(uploaded.extname).toBe('jpg')
    expect(uploaded.type).toBe('image')
    expect(uploaded.subtype).toBe('jpeg')
    expect(uploaded.size).toBe(15)
    expect(uploaded.isValid).toBe(true)
    expect(uploaded.hasErrors).toBe(false)
  })

  test('toBuffer returns file content', async () => {
    const file = createFile('test.txt', 'hello world')
    const uploaded = new UploadedFile('doc', file)
    await uploaded.init(file)

    expect(uploaded.toBuffer().toString()).toBe('hello world')
    expect(uploaded.toString()).toBe('hello world')
  })

  test('validates file size', async () => {
    const content = 'x'.repeat(3000)
    const file = createFile('big.txt', content)
    const uploaded = new UploadedFile('doc', file, { size: '2kb' })
    await uploaded.init(file)

    expect(uploaded.hasErrors).toBe(true)
    expect(uploaded.errors[0].rule).toBe('size')
  })

  test('validates extension', async () => {
    const file = createFile('script.exe', 'data')
    const uploaded = new UploadedFile('file', file, { extnames: ['jpg', 'png', 'pdf'] })
    await uploaded.init(file)

    expect(uploaded.hasErrors).toBe(true)
    expect(uploaded.errors[0].rule).toBe('extname')
    expect(uploaded.errors[0].message).toContain('.exe')
  })

  test('valid extension passes', async () => {
    const file = createImageFile('doc.pdf', PDF_MAGIC, 'application/pdf')
    const uploaded = new UploadedFile('file', file, { extnames: ['jpg', 'png', 'pdf'] })
    await uploaded.init(file)

    expect(uploaded.isValid).toBe(true)
  })

  test('move() writes file to disk', async () => {
    const dir = join(tmpdir(), `tekir-test-upload-${Date.now()}`)
    const file = createFile('test.txt', 'hello')
    const uploaded = new UploadedFile('doc', file)
    await uploaded.init(file)

    await uploaded.move(dir)

    expect(uploaded.filePath).toBeTruthy()
    expect(existsSync(uploaded.filePath!)).toBe(true)
    expect(await Bun.file(uploaded.filePath!).text()).toBe('hello')

    // cleanup
    rmSync(dir, { recursive: true, force: true })
  })

  test('move() with custom name', async () => {
    const dir = join(tmpdir(), `tekir-test-upload-${Date.now()}`)
    const file = createFile('test.txt', 'hello')
    const uploaded = new UploadedFile('doc', file)
    await uploaded.init(file)

    await uploaded.move(dir, 'custom.txt')

    expect(uploaded.fileName).toBe('custom.txt')
    expect(existsSync(join(dir, 'custom.txt'))).toBe(true)

    rmSync(dir, { recursive: true, force: true })
  })

  test('toStream returns ReadableStream', async () => {
    const file = createFile('test.txt', 'stream-data')
    const uploaded = new UploadedFile('doc', file)
    await uploaded.init(file)

    const stream = uploaded.toStream()
    const reader = stream.getReader()
    const { value } = await reader.read()
    expect(Buffer.from(value!).toString()).toBe('stream-data')
  })
})

describe('MultipartFiles', () => {
  async function makeFile(field: string, name: string, content: string): Promise<UploadedFile> {
    const file = createFile(name, content)
    const uploaded = new UploadedFile(field, file)
    await uploaded.init(file)
    return uploaded
  }

  test('file() returns single file', async () => {
    const files = new MultipartFiles()
    files.add('avatar', await makeFile('avatar', 'pic.jpg', 'data'))

    const avatar = files.file('avatar')
    expect(avatar).toBeTruthy()
    expect(avatar!.clientName).toBe('pic.jpg')
  })

  test('file() returns null for missing field', () => {
    const files = new MultipartFiles()
    expect(files.file('nope')).toBeNull()
  })

  test('file() with inline validation', async () => {
    const files = new MultipartFiles()
    files.add('doc', await makeFile('doc', 'huge.exe', 'x'.repeat(5000)))

    const doc = files.file('doc', { size: '1kb', extnames: ['pdf'] })
    expect(doc!.hasErrors).toBe(true)
    expect(doc!.errors.length).toBe(2)
  })

  test('files() returns array', async () => {
    const files = new MultipartFiles()
    files.add('docs', await makeFile('docs', 'a.pdf', 'aaa'))
    files.add('docs', await makeFile('docs', 'b.pdf', 'bbb'))

    const docs = files.files('docs')
    expect(docs.length).toBe(2)
  })

  test('has() checks field existence', async () => {
    const files = new MultipartFiles()
    files.add('avatar', await makeFile('avatar', 'pic.jpg', 'data'))

    expect(files.has('avatar')).toBe(true)
    expect(files.has('nope')).toBe(false)
  })

  test('all() returns flat array', async () => {
    const files = new MultipartFiles()
    files.add('avatar', await makeFile('avatar', 'pic.jpg', 'data'))
    files.add('docs', await makeFile('docs', 'a.pdf', 'aaa'))
    files.add('docs', await makeFile('docs', 'b.pdf', 'bbb'))

    expect(files.all().length).toBe(3)
    expect(files.count).toBe(3)
  })

  test('fields() returns field names', async () => {
    const files = new MultipartFiles()
    files.add('avatar', await makeFile('avatar', 'pic.jpg', 'data'))
    files.add('docs', await makeFile('docs', 'a.pdf', 'aaa'))

    expect(files.fields().sort()).toEqual(['avatar', 'docs'])
  })
})

// UploadedFile — additional metadata and validation coverage

describe('UploadedFile — additional metadata extraction', () => {
  test('extname is lowercase even when original file has uppercase extension', async () => {
    const file = createFile('IMAGE.JPG', 'data', 'image/jpeg')
    const uploaded = new UploadedFile('photo', file)
    await uploaded.init(file)
    expect(uploaded.extname).toBe('jpg')
  })

  test('extname is empty string when file has no extension', async () => {
    const file = createFile('Makefile', 'rules', 'text/plain')
    const uploaded = new UploadedFile('build', file)
    await uploaded.init(file)
    expect(uploaded.extname).toBe('')
  })

  test('type and subtype are split correctly for application/json', async () => {
    const file = createFile('data.json', '{}', 'application/json')
    const uploaded = new UploadedFile('payload', file)
    await uploaded.init(file)
    expect(uploaded.type).toBe('application')
    // Bun may append ;charset=utf-8 to text-like MIME types
    expect(uploaded.subtype).toContain('json')
  })

  test('size reflects actual byte length of content', async () => {
    const content = 'abcdefghij' // 10 bytes
    const file = createFile('ten.txt', content)
    const uploaded = new UploadedFile('f', file)
    await uploaded.init(file)
    expect(uploaded.size).toBe(10)
  })

  test('fieldName is stored from constructor argument', async () => {
    const file = createFile('x.png', 'px', 'image/png')
    const uploaded = new UploadedFile('profile_picture', file)
    await uploaded.init(file)
    expect(uploaded.fieldName).toBe('profile_picture')
  })

  test('clientName matches the original File name', async () => {
    const file = createFile('original-name.pdf', 'pdf-content', 'application/pdf')
    const uploaded = new UploadedFile('attachment', file)
    await uploaded.init(file)
    expect(uploaded.clientName).toBe('original-name.pdf')
  })
})

describe('UploadedFile — size validation edge cases', () => {
  test('file exactly at size limit is valid', async () => {
    const content = 'x'.repeat(1024) // exactly 1kb
    const file = createFile('exact.txt', content)
    const uploaded = new UploadedFile('doc', file, { size: '1kb' })
    await uploaded.init(file)
    expect(uploaded.isValid).toBe(true)
    expect(uploaded.hasErrors).toBe(false)
  })

  test('file one byte over size limit is invalid', async () => {
    const content = 'x'.repeat(1025) // 1kb + 1 byte
    const file = createFile('over.txt', content)
    const uploaded = new UploadedFile('doc', file, { size: '1kb' })
    await uploaded.init(file)
    expect(uploaded.hasErrors).toBe(true)
    expect(uploaded.errors[0].rule).toBe('size')
  })

  test('numeric byte size works as size option', async () => {
    const content = 'x'.repeat(200)
    const file = createFile('num.txt', content)
    const uploaded = new UploadedFile('doc', file, { size: 100 })
    await uploaded.init(file)
    expect(uploaded.hasErrors).toBe(true)
    expect(uploaded.errors[0].rule).toBe('size')
  })
})

describe('UploadedFile — extension validation edge cases', () => {
  test('allowed extension does not produce errors', async () => {
    const file = createImageFile('report.pdf', PDF_MAGIC, 'application/pdf')
    const uploaded = new UploadedFile('file', file, { extnames: ['pdf', 'docx'] })
    await uploaded.init(file)
    expect(uploaded.isValid).toBe(true)
  })

  test('disallowed extension error message lists allowed extensions', async () => {
    const file = createFile('virus.exe', 'data', 'application/octet-stream')
    const uploaded = new UploadedFile('file', file, { extnames: ['jpg', 'png'] })
    await uploaded.init(file)
    expect(uploaded.hasErrors).toBe(true)
    expect(uploaded.errors[0].message).toContain('.jpg')
    expect(uploaded.errors[0].message).toContain('.png')
  })

  test('rejects renamed binary even with whitelisted extension (magic-byte bypass)', async () => {
    // Attacker drops malware.exe and renames it to malware.jpg. The
    // declared extension is in the whitelist, but the magic bytes are
    // not a known image format. The strict whitelist rejects the file
    // on `rule: 'content'` so the executable never reaches storage.
    const exeBytes = new Uint8Array([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]) // PE/MZ header
    const file = new File([exeBytes], 'malware.jpg', { type: 'image/jpeg' })
    const uploaded = new UploadedFile('avatar', file, { extnames: ['jpg', 'png'] })
    await uploaded.init(file)
    expect(uploaded.hasErrors).toBe(true)
    expect(uploaded.errors.find(e => e.rule === 'content')).toBeDefined()
  })

  test('rejects empty file when extnames whitelist is set', async () => {
    const file = new File([], 'photo.jpg', { type: 'image/jpeg' })
    const uploaded = new UploadedFile('avatar', file, { extnames: ['jpg'] })
    await uploaded.init(file)
    expect(uploaded.hasErrors).toBe(true)
    expect(uploaded.errors.find(e => e.rule === 'content' && e.message === 'Empty file')).toBeDefined()
  })

  test('rejects content type that is not in extnames whitelist', async () => {
    // PDF magic bytes uploaded as `report.jpg` with whitelist [jpg]:
    // declared extension is fine but the actual content is not a JPEG,
    // so the content check fires before the extname mismatch.
    const file = createImageFile('report.jpg', PDF_MAGIC, 'application/pdf')
    const uploaded = new UploadedFile('doc', file, { extnames: ['jpg', 'png'] })
    await uploaded.init(file)
    const contentErr = uploaded.errors.find(e => e.rule === 'content')
    expect(contentErr).toBeDefined()
    expect(contentErr!.message).toContain('.pdf')
  })

  test('rejects declared/detected mismatch when both are in whitelist', async () => {
    // PNG content uploaded as `.jpg` with whitelist [jpg, png]: the
    // detected format is in the whitelist (so the content check passes)
    // but the declared extension is misleading — the extname error
    // fires so handlers see the misnaming.
    const file = createImageFile('photo.jpg', PNG_MAGIC, 'image/jpeg')
    const uploaded = new UploadedFile('img', file, { extnames: ['jpg', 'png'] })
    await uploaded.init(file)
    expect(uploaded.errors.find(e => e.rule === 'extname')).toBeDefined()
  })

  test('size, extension, and content violations stack', async () => {
    // Oversized file with a wrong extension and unrecognized magic bytes.
    // All three checks fire: size limit (rule=size), declared `.exe` not
    // in whitelist (rule=extname, from constructor's validate()), and
    // content magic bytes are not a PDF (rule=content, from
    // validateContent() in init).
    const content = 'x'.repeat(5000)
    const file = createFile('bad.exe', content, 'application/octet-stream')
    const uploaded = new UploadedFile('file', file, { size: '1kb', extnames: ['pdf'] })
    await uploaded.init(file)
    const rules = uploaded.errors.map(e => e.rule).sort()
    expect(rules).toEqual(['content', 'extname', 'size'])
  })
})

describe('UploadedFile — move to disk', () => {
  test('move() creates directory when it does not exist', async () => {
    const dir = join(tmpdir(), `tekir-mkdir-test-${Date.now()}`)
    const file = createFile('hello.txt', 'content')
    const uploaded = new UploadedFile('f', file)
    await uploaded.init(file)
    await uploaded.move(dir)
    expect(existsSync(dir)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test('move() assigns filePath and fileName after move', async () => {
    const dir = join(tmpdir(), `tekir-path-test-${Date.now()}`)
    const file = createFile('doc.pdf', 'pdf-bytes', 'application/pdf')
    const uploaded = new UploadedFile('doc', file)
    await uploaded.init(file)
    await uploaded.move(dir)
    expect(uploaded.filePath).toBeTruthy()
    expect(uploaded.fileName).toBeTruthy()
    rmSync(dir, { recursive: true, force: true })
  })

  test('move() with custom name stores exactly that name', async () => {
    const dir = join(tmpdir(), `tekir-name-test-${Date.now()}`)
    const file = createFile('original.txt', 'body')
    const uploaded = new UploadedFile('f', file)
    await uploaded.init(file)
    await uploaded.move(dir, 'renamed.txt')
    expect(uploaded.fileName).toBe('renamed.txt')
    expect(existsSync(join(dir, 'renamed.txt'))).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test('moved file content matches original buffer', async () => {
    const dir = join(tmpdir(), `tekir-content-test-${Date.now()}`)
    const content = 'exact content check'
    const file = createFile('check.txt', content)
    const uploaded = new UploadedFile('f', file)
    await uploaded.init(file)
    await uploaded.move(dir)
    const written = await Bun.file(uploaded.filePath!).text()
    expect(written).toBe(content)
    rmSync(dir, { recursive: true, force: true })
  })
})

// MultipartFiles — multiple files same field, has/count, files with validation

describe('MultipartFiles — multiple files same field', () => {
  async function makeFile(field: string, name: string, content: string): Promise<UploadedFile> {
    const file = createFile(name, content)
    const uploaded = new UploadedFile(field, file)
    await uploaded.init(file)
    return uploaded
  }

  test('adding three files to same field makes files() return all three', async () => {
    const mf = new MultipartFiles()
    mf.add('docs', await makeFile('docs', 'a.pdf', 'aaa'))
    mf.add('docs', await makeFile('docs', 'b.pdf', 'bbb'))
    mf.add('docs', await makeFile('docs', 'c.pdf', 'ccc'))
    expect(mf.files('docs').length).toBe(3)
  })

  test('file() returns only the first file when multiple are added to same field', async () => {
    const mf = new MultipartFiles()
    mf.add('img', await makeFile('img', 'first.jpg', 'first'))
    mf.add('img', await makeFile('img', 'second.jpg', 'second'))
    const first = mf.file('img')
    expect(first!.clientName).toBe('first.jpg')
  })

  test('has() returns true when multiple files are added to a field', async () => {
    const mf = new MultipartFiles()
    mf.add('multi', await makeFile('multi', 'x.txt', 'x'))
    mf.add('multi', await makeFile('multi', 'y.txt', 'y'))
    expect(mf.has('multi')).toBe(true)
  })

  test('count reflects total number of files across all fields', async () => {
    const mf = new MultipartFiles()
    mf.add('a', await makeFile('a', 'f1.txt', '1'))
    mf.add('a', await makeFile('a', 'f2.txt', '2'))
    mf.add('b', await makeFile('b', 'f3.txt', '3'))
    expect(mf.count).toBe(3)
  })

  test('files() with validation applies rules to all files in the field', async () => {
    const mf = new MultipartFiles()
    mf.add('docs', await makeFile('docs', 'ok.pdf', 'data'))
    mf.add('docs', await makeFile('docs', 'bad.exe', 'data'))
    const results = mf.files('docs', { extnames: ['pdf'] })
    const validCount = results.filter(f => f.isValid).length
    const invalidCount = results.filter(f => f.hasErrors).length
    expect(validCount).toBe(1)
    expect(invalidCount).toBe(1)
  })

  test('files() returns empty array for unknown field', () => {
    const mf = new MultipartFiles()
    expect(mf.files('ghost')).toEqual([])
  })

  test('all() returns files from all fields flat', async () => {
    const mf = new MultipartFiles()
    mf.add('photos', await makeFile('photos', 'p1.jpg', 'p1'))
    mf.add('photos', await makeFile('photos', 'p2.jpg', 'p2'))
    mf.add('docs', await makeFile('docs', 'd1.pdf', 'd1'))
    const all = mf.all()
    expect(all.length).toBe(3)
    const names = all.map(f => f.clientName).sort()
    expect(names).toEqual(['d1.pdf', 'p1.jpg', 'p2.jpg'])
  })
})

// UploadedFile — zero-size, large metadata, special characters

import { bodyParser, BodyParserProvider, parseMultipart } from '../src/index'

describe('UploadedFile — zero-size and special filenames', () => {
  test('zero-size file has size 0 and is valid without size constraint', async () => {
    const file = createFile('empty.txt', '', 'text/plain')
    const uploaded = new UploadedFile('doc', file)
    await uploaded.init(file)
    expect(uploaded.size).toBe(0)
    expect(uploaded.isValid).toBe(true)
    expect(uploaded.hasErrors).toBe(false)
  })

  test('zero-size file passes size validation (0 <= any limit)', async () => {
    const file = createFile('empty.txt', '', 'text/plain')
    const uploaded = new UploadedFile('doc', file, { size: '1kb' })
    await uploaded.init(file)
    expect(uploaded.isValid).toBe(true)
  })

  test('very large file metadata is stored correctly without reading content', async () => {
    // We simulate a "large" file by creating one with known size metadata
    const content = 'x'.repeat(10000)
    const file = createFile('huge-report.csv', content, 'text/csv')
    const uploaded = new UploadedFile('report', file)
    await uploaded.init(file)
    expect(uploaded.size).toBe(10000)
    expect(uploaded.clientName).toBe('huge-report.csv')
    expect(uploaded.extname).toBe('csv')
    expect(uploaded.type).toBe('text')
  })

  test('filename with special characters is preserved in clientName', async () => {
    const file = createFile('my file (1) [final].txt', 'data', 'text/plain')
    const uploaded = new UploadedFile('doc', file)
    await uploaded.init(file)
    expect(uploaded.clientName).toBe('my file (1) [final].txt')
  })

  test('filename with unicode characters is preserved', async () => {
    const file = createFile('日本語ファイル.pdf', 'data', 'application/pdf')
    const uploaded = new UploadedFile('doc', file)
    await uploaded.init(file)
    expect(uploaded.clientName).toBe('日本語ファイル.pdf')
    expect(uploaded.extname).toBe('pdf')
  })

  test('filename with multiple dots extracts last extension', async () => {
    const file = createFile('archive.backup.tar.gz', 'data', 'application/gzip')
    const uploaded = new UploadedFile('file', file)
    await uploaded.init(file)
    expect(uploaded.extname).toBe('gz')
  })
})

// UploadedFile — multiple move() calls, move() with original name

describe('UploadedFile — move() edge cases', () => {
  test('move() without custom name generates a UUID-based filename', async () => {
    const dir = join(tmpdir(), `tekir-uuid-test-${Date.now()}`)
    const file = createFile('test.txt', 'hello')
    const uploaded = new UploadedFile('doc', file)
    await uploaded.init(file)
    await uploaded.move(dir)
    // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.ext
    expect(uploaded.fileName).toMatch(/^[0-9a-f-]+\.txt$/)
    rmSync(dir, { recursive: true, force: true })
  })

  test('second move() overwrites filePath and fileName', async () => {
    const dir1 = join(tmpdir(), `tekir-move1-${Date.now()}`)
    const dir2 = join(tmpdir(), `tekir-move2-${Date.now()}`)
    const file = createFile('test.txt', 'data')
    const uploaded = new UploadedFile('doc', file)
    await uploaded.init(file)

    await uploaded.move(dir1, 'first.txt')
    const firstPath = uploaded.filePath
    expect(existsSync(join(dir1, 'first.txt'))).toBe(true)

    await uploaded.move(dir2, 'second.txt')
    expect(uploaded.fileName).toBe('second.txt')
    expect(uploaded.filePath).toBe(join(dir2, 'second.txt'))
    expect(existsSync(join(dir2, 'second.txt'))).toBe(true)

    rmSync(dir1, { recursive: true, force: true })
    rmSync(dir2, { recursive: true, force: true })
  })

  test('move() with original clientName as custom name', async () => {
    const dir = join(tmpdir(), `tekir-origname-${Date.now()}`)
    const file = createFile('original.pdf', 'pdf-data')
    const uploaded = new UploadedFile('doc', file)
    await uploaded.init(file)
    await uploaded.move(dir, uploaded.clientName)
    expect(uploaded.fileName).toBe('original.pdf')
    expect(existsSync(join(dir, 'original.pdf'))).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})

// UploadedFile — isValid with no validations applied

describe('UploadedFile — isValid without validation options', () => {
  test('isValid is true when no validation options provided', async () => {
    const file = createFile('anything.xyz', 'content', 'application/octet-stream')
    const uploaded = new UploadedFile('field', file)
    await uploaded.init(file)
    expect(uploaded.isValid).toBe(true)
    expect(uploaded.hasErrors).toBe(false)
    expect(uploaded.errors).toEqual([])
  })

  test('errors array is empty by default', async () => {
    const file = createFile('test.bin', 'binary', 'application/octet-stream')
    const uploaded = new UploadedFile('bin', file)
    await uploaded.init(file)
    expect(uploaded.errors.length).toBe(0)
  })
})

// MultipartFiles — empty collection, non-existent field, multiple same field

describe('MultipartFiles — empty and edge cases', () => {
  test('empty files collection has count 0', () => {
    const mf = new MultipartFiles()
    expect(mf.count).toBe(0)
  })

  test('empty files collection all() returns empty array', () => {
    const mf = new MultipartFiles()
    expect(mf.all()).toEqual([])
  })

  test('empty files collection fields() returns empty array', () => {
    const mf = new MultipartFiles()
    expect(mf.fields()).toEqual([])
  })

  test('files() with non-existent field returns empty array', () => {
    const mf = new MultipartFiles()
    expect(mf.files('nonexistent')).toEqual([])
    expect(mf.files('also-missing')).toEqual([])
  })

  test('file() on empty collection returns null', () => {
    const mf = new MultipartFiles()
    expect(mf.file('missing')).toBeNull()
  })

  test('has() on empty collection returns false', () => {
    const mf = new MultipartFiles()
    expect(mf.has('anything')).toBe(false)
  })

  test('multiple files under same field name are all retrievable', async () => {
    const mf = new MultipartFiles()
    const f1 = createFile('a.jpg', 'aaa', 'image/jpeg')
    const f2 = createFile('b.jpg', 'bbb', 'image/jpeg')
    const f3 = createFile('c.jpg', 'ccc', 'image/jpeg')
    const u1 = new UploadedFile('photos', f1); await u1.init(f1)
    const u2 = new UploadedFile('photos', f2); await u2.init(f2)
    const u3 = new UploadedFile('photos', f3); await u3.init(f3)
    mf.add('photos', u1)
    mf.add('photos', u2)
    mf.add('photos', u3)

    expect(mf.files('photos').length).toBe(3)
    expect(mf.file('photos')!.clientName).toBe('a.jpg')
    expect(mf.count).toBe(3)
    expect(mf.fields()).toEqual(['photos'])
  })
})

// BodyParserProvider — existence and boot method

describe('BodyParserProvider', () => {
  test('BodyParserProvider can be instantiated', () => {
    const provider = new BodyParserProvider()
    expect(provider).toBeTruthy()
  })

  test('BodyParserProvider has a boot method', () => {
    const provider = new BodyParserProvider()
    expect(typeof provider.boot).toBe('function')
  })
})

// bodyParser middleware — returns a function

describe('bodyParser middleware', () => {
  test('bodyParser() returns a middleware function', () => {
    const mw = bodyParser()
    expect(typeof mw).toBe('function')
  })

  test('bodyParser() with config returns a middleware function', () => {
    const mw = bodyParser({ multipart: { maxFileSize: '10mb' } })
    expect(typeof mw).toBe('function')
  })

  test('middleware calls next() for GET requests', async () => {
    const mw = bodyParser()
    let nextCalled = false
    const ctx = { request: { method: 'GET', headers: { get: () => '' } } }
    await mw(ctx, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })

  test('middleware calls next() for HEAD requests', async () => {
    const mw = bodyParser()
    let nextCalled = false
    const ctx = { request: { method: 'HEAD', headers: { get: () => '' } } }
    await mw(ctx, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })
})

// FileValidationOptions — size as string and number

describe('FileValidationOptions — size formats', () => {
  test('size as string "2mb" validates correctly', async () => {
    const content = 'x'.repeat(3 * 1024 * 1024) // 3MB
    const file = createFile('big.dat', content)
    const uploaded = new UploadedFile('file', file, { size: '2mb' })
    await uploaded.init(file)
    expect(uploaded.hasErrors).toBe(true)
    expect(uploaded.errors[0].rule).toBe('size')
  })

  test('size as number (bytes) validates correctly', async () => {
    const content = 'x'.repeat(500)
    const file = createFile('small.txt', content)
    const uploaded = new UploadedFile('file', file, { size: 100 })
    await uploaded.init(file)
    expect(uploaded.hasErrors).toBe(true)
  })

  test('size as string "500kb" allows files under limit', async () => {
    const content = 'x'.repeat(100)
    const file = createFile('tiny.txt', content)
    const uploaded = new UploadedFile('file', file, { size: '500kb' })
    await uploaded.init(file)
    expect(uploaded.isValid).toBe(true)
  })
})

// File extension validation — case-insensitive, dot prefix handling

describe('File extension validation — case sensitivity', () => {
  test('extension comparison is case-insensitive (uppercase file, lowercase allow list)', async () => {
    const file = createImageFile('PHOTO.JPG', JPEG_MAGIC, 'image/jpeg')
    const uploaded = new UploadedFile('img', file, { extnames: ['jpg', 'png'] })
    await uploaded.init(file)
    // extname is lowercased in constructor, so 'jpg' matches 'jpg'
    expect(uploaded.isValid).toBe(true)
  })

  test('extname stored is always lowercase regardless of original', async () => {
    const file = createFile('Report.PDF', 'data', 'application/pdf')
    const uploaded = new UploadedFile('doc', file)
    await uploaded.init(file)
    expect(uploaded.extname).toBe('pdf')
  })

  test('extension validation with dot-prefixed extnames in allow list fails (no dot stripping)', async () => {
    // The allow list expects bare extensions like 'jpg', not '.jpg'
    const file = createFile('photo.jpg', 'data', 'image/jpeg')
    const uploaded = new UploadedFile('img', file, { extnames: ['.jpg'] })
    await uploaded.init(file)
    // extname is 'jpg' which does not match '.jpg'
    expect(uploaded.hasErrors).toBe(true)
  })
})

// UploadedFile — toBuffer/toString with various content

describe('UploadedFile — toBuffer and toString with various content', () => {
  test('toBuffer returns correct bytes for binary-like content', async () => {
    const content = '\x00\x01\x02\x03'
    const file = createFile('bin.dat', content, 'application/octet-stream')
    const uploaded = new UploadedFile('bin', file)
    await uploaded.init(file)
    const buf = uploaded.toBuffer()
    expect(buf.length).toBe(4)
    expect(buf[0]).toBe(0)
    expect(buf[3]).toBe(3)
  })

  test('toString returns empty string for empty file', async () => {
    const file = createFile('empty.txt', '', 'text/plain')
    const uploaded = new UploadedFile('doc', file)
    await uploaded.init(file)
    expect(uploaded.toString()).toBe('')
  })

  test('toString with utf-8 encoding returns unicode content', async () => {
    const content = 'Héllo Wörld 日本語'
    const file = createFile('unicode.txt', content, 'text/plain')
    const uploaded = new UploadedFile('doc', file)
    await uploaded.init(file)
    expect(uploaded.toString('utf-8')).toBe(content)
  })

  test('toBuffer length matches file size for ASCII content', async () => {
    const content = 'abcdefghijklmnopqrstuvwxyz'
    const file = createFile('alpha.txt', content)
    const uploaded = new UploadedFile('doc', file)
    await uploaded.init(file)
    expect(uploaded.toBuffer().length).toBe(26)
  })
})

// Additional UploadedFile tests

describe('UploadedFile — additional metadata', () => {
  test('extname for .png file', async () => {
    const file = createFile('image.png', 'data', 'image/png')
    const uploaded = new UploadedFile('img', file)
    await uploaded.init(file)
    expect(uploaded.extname).toBe('png')
  })

  test('extname for .pdf file', async () => {
    const file = createFile('doc.pdf', 'data', 'application/pdf')
    const uploaded = new UploadedFile('doc', file)
    await uploaded.init(file)
    expect(uploaded.extname).toBe('pdf')
  })

  test('extname for .ts file', async () => {
    const file = createFile('app.ts', 'code', 'text/plain')
    const uploaded = new UploadedFile('src', file)
    await uploaded.init(file)
    expect(uploaded.extname).toBe('ts')
  })

  test('type for image/png', async () => {
    const file = createFile('img.png', 'data', 'image/png')
    const uploaded = new UploadedFile('img', file)
    await uploaded.init(file)
    expect(uploaded.type).toBe('image')
    expect(uploaded.subtype).toBe('png')
  })

  test('type for application/json', async () => {
    const file = createFile('data.json', '{}', 'application/json')
    const uploaded = new UploadedFile('data', file)
    await uploaded.init(file)
    expect(uploaded.type).toBe('application')
    expect(uploaded.subtype).toContain('json')
  })

  test('type for text/csv', async () => {
    const file = createFile('data.csv', 'a,b,c', 'text/csv')
    const uploaded = new UploadedFile('csv', file)
    await uploaded.init(file)
    expect(uploaded.type).toBe('text')
    expect(uploaded.subtype).toBe('csv')
  })

  test('size is correct for various content lengths', async () => {
    for (const len of [0, 1, 10, 100, 1000]) {
      const content = 'x'.repeat(len)
      const file = createFile('test.txt', content)
      const uploaded = new UploadedFile('f', file)
      await uploaded.init(file)
      expect(uploaded.size).toBe(len)
    }
  })

  test('clientName preserves original filename', async () => {
    const file = createFile('My Document (v2).pdf', 'data', 'application/pdf')
    const uploaded = new UploadedFile('doc', file)
    await uploaded.init(file)
    expect(uploaded.clientName).toBe('My Document (v2).pdf')
  })

  test('fieldName is preserved', async () => {
    const file = createFile('file.txt', 'data')
    const uploaded = new UploadedFile('custom_field', file)
    await uploaded.init(file)
    expect(uploaded.fieldName).toBe('custom_field')
  })

  test('isValid is true when no constraints', async () => {
    const file = createFile('any.txt', 'data')
    const uploaded = new UploadedFile('f', file)
    await uploaded.init(file)
    expect(uploaded.isValid).toBe(true)
    expect(uploaded.hasErrors).toBe(false)
  })

  test('extension validation allows matching extension', async () => {
    const file = createImageFile('photo.jpg', JPEG_MAGIC, 'image/jpeg')
    const uploaded = new UploadedFile('img', file, { extnames: ['jpg', 'png'] })
    await uploaded.init(file)
    expect(uploaded.isValid).toBe(true)
  })

  test('extension validation rejects non-matching extension', async () => {
    const file = createFile('script.sh', 'data', 'text/plain')
    const uploaded = new UploadedFile('f', file, { extnames: ['jpg', 'png'] })
    await uploaded.init(file)
    expect(uploaded.hasErrors).toBe(true)
  })

  test('size validation passes for small file', async () => {
    const file = createFile('small.txt', 'hi')
    const uploaded = new UploadedFile('f', file, { size: '1mb' })
    await uploaded.init(file)
    expect(uploaded.isValid).toBe(true)
  })

  test('size validation fails for oversized file', async () => {
    const content = 'x'.repeat(2000)
    const file = createFile('big.txt', content)
    const uploaded = new UploadedFile('f', file, { size: '1kb' })
    await uploaded.init(file)
    expect(uploaded.hasErrors).toBe(true)
  })

  test('multiple validation errors', async () => {
    const content = 'x'.repeat(2000)
    const file = createFile('script.exe', content, 'application/octet-stream')
    const uploaded = new UploadedFile('f', file, { size: '1kb', extnames: ['jpg'] })
    await uploaded.init(file)
    expect(uploaded.hasErrors).toBe(true)
    expect(uploaded.errors.length).toBeGreaterThanOrEqual(1)
  })

  test('extname for file with multiple dots', async () => {
    const file = createFile('archive.tar.gz', 'data', 'application/gzip')
    const uploaded = new UploadedFile('f', file)
    await uploaded.init(file)
    expect(uploaded.extname).toBe('gz')
  })

  test('extname for file without extension', async () => {
    const file = createFile('README', 'data', 'text/plain')
    const uploaded = new UploadedFile('f', file)
    await uploaded.init(file)
    expect(uploaded.extname).toBe('')
  })
})


describe('UploadedFile — additional validation', () => {
  test('extension validation accepts matching extension', async () => {
    const file = createImageFile('photo.jpg', JPEG_MAGIC, 'image/jpeg')
    const uploaded = new UploadedFile('f', file, { extnames: ['jpg', 'png'] })
    await uploaded.init(file)
    expect(uploaded.isValid).toBe(true)
  })

  test('extension validation accepts png', async () => {
    const file = createImageFile('image.png', PNG_MAGIC, 'image/png')
    const uploaded = new UploadedFile('f', file, { extnames: ['jpg', 'png'] })
    await uploaded.init(file)
    expect(uploaded.isValid).toBe(true)
  })

  test('file with no validation options is always valid', async () => {
    const file = createFile('anything.xyz', 'data')
    const uploaded = new UploadedFile('f', file)
    await uploaded.init(file)
    expect(uploaded.isValid).toBe(true)
  })

  test('file name is preserved', async () => {
    const file = createFile('document.pdf', 'data', 'application/pdf')
    const uploaded = new UploadedFile('f', file)
    await uploaded.init(file)
    expect(uploaded.clientName).toBe('document.pdf')
  })

  test('file mime type is accessible', async () => {
    const file = createFile('doc.pdf', 'data', 'application/pdf')
    const uploaded = new UploadedFile('f', file)
    await uploaded.init(file)
    // The mime type may be stored in type or mimeType
    const mimeType = (uploaded as any).type || (uploaded as any).mimeType || (uploaded as any).contentType
    expect(mimeType).toBeDefined()
  })

  test('extname for .txt file', async () => {
    const file = createFile('notes.txt', 'hello')
    const uploaded = new UploadedFile('f', file)
    await uploaded.init(file)
    expect(uploaded.extname).toBe('txt')
  })

  test('extname for .json file', async () => {
    const file = createFile('data.json', '{}', 'application/json')
    const uploaded = new UploadedFile('f', file)
    await uploaded.init(file)
    expect(uploaded.extname).toBe('json')
  })

  test('size validation with 10mb limit passes for small file', async () => {
    const file = createFile('small.txt', 'hello')
    const uploaded = new UploadedFile('f', file, { size: '10mb' })
    await uploaded.init(file)
    expect(uploaded.isValid).toBe(true)
  })

  test('errors array is empty for valid file', async () => {
    const file = createFile('valid.txt', 'hello')
    const uploaded = new UploadedFile('f', file)
    await uploaded.init(file)
    expect(uploaded.errors).toHaveLength(0)
  })

  test('fieldName is preserved', async () => {
    const file = createFile('test.txt', 'data')
    const uploaded = new UploadedFile('avatar', file)
    await uploaded.init(file)
    expect(uploaded.fieldName).toBe('avatar')
  })
})
