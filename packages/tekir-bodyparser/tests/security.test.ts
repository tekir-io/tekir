import { test, expect, describe } from 'bun:test'
import { UploadedFile, parseSize, formatSize } from '../src/uploaded_file'

// Create a mock File
function createMockFile(name: string, content: Uint8Array, type = 'application/octet-stream'): File {
  // Buffer is BlobPart-compatible across TS lib versions; passing the
  // raw Uint8Array fails under newer libs where its generic argument
  // (`Uint8Array<ArrayBufferLike>`) is not assignable to BlobPart's
  // expected `Uint8Array<ArrayBuffer>`.
  return new File([Buffer.from(content)], name, { type })
}

describe('UploadedFile — magic bytes detection', () => {
  test('detects PNG files', () => {
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    const file = new UploadedFile('avatar', createMockFile('test.png', pngHeader), { extnames: ['png'] })
    expect(file.detectExtname(Buffer.from(pngHeader))).toBe('png')
  })

  test('detects JPEG files', () => {
    const jpegHeader = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0])
    const file = new UploadedFile('photo', createMockFile('test.jpg', jpegHeader))
    expect(file.detectExtname(Buffer.from(jpegHeader))).toBe('jpg')
  })

  test('detects GIF files', () => {
    const gifHeader = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    const file = new UploadedFile('gif', createMockFile('test.gif', gifHeader))
    expect(file.detectExtname(Buffer.from(gifHeader))).toBe('gif')
  })

  test('detects PDF files', () => {
    const pdfHeader = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D])
    const file = new UploadedFile('doc', createMockFile('test.pdf', pdfHeader))
    expect(file.detectExtname(Buffer.from(pdfHeader))).toBe('pdf')
  })

  test('detects ZIP files', () => {
    const zipHeader = new Uint8Array([0x50, 0x4B, 0x03, 0x04])
    const file = new UploadedFile('archive', createMockFile('test.zip', zipHeader))
    expect(file.detectExtname(Buffer.from(zipHeader))).toBe('zip')
  })

  test('returns null for unknown file type', () => {
    const unknown = new Uint8Array([0x00, 0x00, 0x00, 0x00])
    const file = new UploadedFile('file', createMockFile('test.bin', unknown))
    expect(file.detectExtname(Buffer.from(unknown))).toBeNull()
  })

  test('returns null for very small files', () => {
    const tiny = new Uint8Array([0x00])
    const file = new UploadedFile('tiny', createMockFile('tiny.txt', tiny))
    expect(file.detectExtname(Buffer.from(tiny))).toBeNull()
  })
})

describe('UploadedFile — extension mismatch detection', () => {
  test('flags extension mismatch after init', async () => {
    // PNG magic bytes but .jpg extension
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...new Array(100).fill(0)])
    const mockFile = createMockFile('fake.jpg', pngHeader, 'image/jpeg')
    const uploaded = new UploadedFile('avatar', mockFile, { extnames: ['jpg', 'png'] })
    await uploaded.init(mockFile)

    expect(uploaded.hasErrors).toBe(true)
    expect(uploaded.errors.some(e => e.message.includes('does not match detected type'))).toBe(true)
  })

  test('no error when extension matches magic bytes', async () => {
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...new Array(100).fill(0)])
    const mockFile = createMockFile('image.png', pngHeader, 'image/png')
    const uploaded = new UploadedFile('avatar', mockFile, { extnames: ['png'] })
    await uploaded.init(mockFile)
    expect(uploaded.errors.filter(e => e.message.includes('does not match')).length).toBe(0)
  })
})

describe('parseSize — size parsing', () => {
  test('parses bytes', () => { expect(parseSize('100b')).toBe(100) })
  test('parses kilobytes', () => { expect(parseSize('10kb')).toBe(10240) })
  test('parses megabytes', () => { expect(parseSize('2mb')).toBe(2097152) })
  test('parses gigabytes', () => { expect(parseSize('1gb')).toBe(1073741824) })
  test('case insensitive', () => { expect(parseSize('5MB')).toBe(5242880) })
  test('decimal values', () => { expect(parseSize('1.5mb')).toBe(1572864) })
  test('number passthrough', () => { expect(parseSize(1024)).toBe(1024) })
  test('throws on invalid format', () => { expect(() => parseSize('abc')).toThrow() })
  test('throws on empty string', () => { expect(() => parseSize('')).toThrow() })
})

describe('formatSize — size formatting', () => {
  test('formats bytes', () => { expect(formatSize(500)).toBe('500b') })
  test('formats kilobytes', () => { expect(formatSize(2048)).toContain('kb') })
  test('formats megabytes', () => { expect(formatSize(5 * 1024 * 1024)).toContain('mb') })
  test('formats gigabytes', () => { expect(formatSize(2 * 1024 * 1024 * 1024)).toContain('gb') })
})

describe('UploadedFile — constructor', () => {
  test('extracts extension from filename', () => {
    const f = new UploadedFile('img', createMockFile('photo.jpg', new Uint8Array(10)))
    expect(f.extname).toBe('jpg')
  })
  test('extracts lowercase extension', () => {
    const f = new UploadedFile('img', createMockFile('photo.JPG', new Uint8Array(10)))
    expect(f.extname).toBe('jpg')
  })
  test('handles no extension', () => {
    const f = new UploadedFile('img', createMockFile('noext', new Uint8Array(10)))
    expect(f.extname).toBe('')
  })
  test('handles multiple dots', () => {
    const f = new UploadedFile('img', createMockFile('file.tar.gz', new Uint8Array(10)))
    expect(f.extname).toBe('gz')
  })
  test('stores field name', () => {
    const f = new UploadedFile('avatar', createMockFile('test.png', new Uint8Array(10)))
    expect(f.fieldName).toBe('avatar')
  })
  test('stores client name', () => {
    const f = new UploadedFile('avatar', createMockFile('original.png', new Uint8Array(10)))
    expect(f.clientName).toBe('original.png')
  })
  test('stores file size', () => {
    const f = new UploadedFile('f', createMockFile('f.txt', new Uint8Array(42)))
    expect(f.size).toBe(42)
  })
  test('parses MIME type', () => {
    const f = new UploadedFile('f', createMockFile('f.png', new Uint8Array(10), 'image/png'))
    expect(f.type).toBe('image')
    expect(f.subtype).toBe('png')
  })
  test('defaults MIME to application/octet-stream', () => {
    const f = new UploadedFile('f', createMockFile('f.bin', new Uint8Array(10)))
    expect(f.type).toBe('application')
    expect(f.subtype).toBe('octet-stream')
  })
  test('isValid is true when no errors', () => {
    const f = new UploadedFile('f', createMockFile('f.jpg', new Uint8Array(10)), { extnames: ['jpg'] })
    expect(f.isValid).toBe(true)
  })
  test('isValid is false when has errors', () => {
    const f = new UploadedFile('f', createMockFile('f.exe', new Uint8Array(10)), { extnames: ['jpg'] })
    expect(f.isValid).toBe(false)
  })
})

describe('UploadedFile — toBuffer/toString/toStream', () => {
  test('toBuffer returns Buffer after init', async () => {
    const data = new Uint8Array([72, 101, 108, 108, 111])
    const mockFile = createMockFile('f.bin', data)
    const f = new UploadedFile('f', mockFile)
    await f.init(mockFile)
    expect(f.toBuffer()).toBeInstanceOf(Buffer)
    expect(f.toBuffer().length).toBe(5)
  })
  test('toString returns string after init', async () => {
    const data = new TextEncoder().encode('Hello')
    const mockFile = createMockFile('f.txt', data)
    const f = new UploadedFile('f', mockFile)
    await f.init(mockFile)
    expect(f.toString()).toBe('Hello')
  })
  test('toStream returns ReadableStream', async () => {
    const data = new Uint8Array([1, 2, 3])
    const mockFile = createMockFile('f.bin', data)
    const f = new UploadedFile('f', mockFile)
    await f.init(mockFile)
    expect(f.toStream()).toBeInstanceOf(ReadableStream)
  })
})
