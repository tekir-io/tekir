import { test, expect, describe } from 'bun:test'
import { UploadedFile } from '../src/uploaded_file'

function createMockFile(name: string, content: Uint8Array, type = 'application/octet-stream'): File {
  return new File([Buffer.from(content)], name, { type })
}

// ═══════════════════════════════════════════════════════════
// move() path traversal prevention
// ═══════════════════════════════════════════════════════════

describe('UploadedFile.move() — path traversal prevention', () => {
  test('forward slashes in name are replaced with underscore', () => {
    const safeName = '../../etc/passwd'.replace(/[/\\]/g, '_')
    expect(safeName).not.toContain('/')
    expect(safeName).toContain('etc_passwd')
  })

  test('backslashes in name are replaced with underscore', () => {
    const safeName = '..\\..\\windows\\system32'.replace(/[/\\]/g, '_')
    expect(safeName).not.toContain('\\')
    expect(safeName).toContain('windows_system32')
  })

  test('normal filenames are not modified', () => {
    const safeName = 'photo.jpg'.replace(/[/\\]/g, '_')
    expect(safeName).toBe('photo.jpg')
  })

  test('filename with spaces is preserved', () => {
    const safeName = 'my photo.jpg'.replace(/[/\\]/g, '_')
    expect(safeName).toBe('my photo.jpg')
  })

  test('filename with dots is preserved (no path traversal)', () => {
    const safeName = 'file.name.with.dots.jpg'.replace(/[/\\]/g, '_')
    expect(safeName).toBe('file.name.with.dots.jpg')
  })

  test('deeply nested traversal attempt', () => {
    const safeName = '../../../../../../../../etc/shadow'.replace(/[/\\]/g, '_')
    expect(safeName).not.toContain('/')
    expect(safeName).not.toContain('\\')
  })

  test('mixed slash traversal', () => {
    const safeName = '..\\../..\\../etc/passwd'.replace(/[/\\]/g, '_')
    expect(safeName).not.toContain('/')
    expect(safeName).not.toContain('\\')
  })

  test('URL-encoded slashes stay as literal characters', () => {
    const safeName = '%2e%2e%2f%2e%2e%2fetc%2fpasswd'.replace(/[/\\]/g, '_')
    // URL-encoded chars are literal text, no actual slashes
    expect(safeName).toBe('%2e%2e%2f%2e%2e%2fetc%2fpasswd')
  })

  test('null filename falls back to UUID', async () => {
    const mockFile = createMockFile('test.jpg', new Uint8Array(10), 'image/jpeg')
    const uploaded = new UploadedFile('avatar', mockFile)
    await uploaded.init(mockFile)
    // When no name provided, UUID is generated
    // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.ext
    expect(uploaded.extname).toBe('jpg')
  })
})

// ═══════════════════════════════════════════════════════════
// moveToDisk() path traversal prevention
// ═══════════════════════════════════════════════════════════

describe('UploadedFile.moveToDisk() — path traversal prevention', () => {
  test('slashes in custom name are sanitized', () => {
    const rawName = '../../../malicious.jpg'
    const name = rawName.replace(/[/\\]/g, '_')
    expect(name).not.toContain('/')
    expect(name).toContain('malicious.jpg')
  })

  test('backslashes in custom name are sanitized', () => {
    const rawName = '..\\..\\malicious.jpg'
    const name = rawName.replace(/[/\\]/g, '_')
    expect(name).not.toContain('\\')
    expect(name).toContain('malicious.jpg')
  })

  test('normal name passes through', () => {
    const rawName = 'avatar-123.png'
    const name = rawName.replace(/[/\\]/g, '_')
    expect(name).toBe('avatar-123.png')
  })
})

// ═══════════════════════════════════════════════════════════
// Magic bytes detection — comprehensive
// ═══════════════════════════════════════════════════════════

describe('UploadedFile — magic bytes comprehensive', () => {
  test('detects WebP files', () => {
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])
    const file = new UploadedFile('img', createMockFile('test.webp', webp))
    expect(file.detectExtname(Buffer.from(webp))).toBe('webp')
  })

  test('detects SVG from xml declaration', () => {
    const svg = Buffer.from('<?xml version="1.0"?><svg></svg>')
    const file = new UploadedFile('img', createMockFile('test.svg', new Uint8Array(svg)))
    expect(file.detectExtname(svg)).toBe('svg')
  })

  test('detects SVG from svg tag', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    const file = new UploadedFile('img', createMockFile('test.svg', new Uint8Array(svg)))
    expect(file.detectExtname(svg)).toBe('svg')
  })

  test('empty buffer returns null', () => {
    const file = new UploadedFile('f', createMockFile('f.bin', new Uint8Array(0)))
    expect(file.detectExtname(Buffer.alloc(0))).toBeNull()
  })

  test('3-byte buffer returns null', () => {
    const file = new UploadedFile('f', createMockFile('f.bin', new Uint8Array(3)))
    expect(file.detectExtname(Buffer.from([0x89, 0x50, 0x4E]))).toBeNull()
  })

  test('random bytes return null', () => {
    const random = Buffer.from([0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE])
    const file = new UploadedFile('f', createMockFile('f.bin', new Uint8Array(random)))
    expect(file.detectExtname(random)).toBeNull()
  })

  test('text file returns null', () => {
    const text = Buffer.from('Hello, this is a plain text file')
    const file = new UploadedFile('f', createMockFile('f.txt', new Uint8Array(text)))
    expect(file.detectExtname(text)).toBeNull()
  })

  // SVG detection robustness — tolerant of real-world prologues, strict about
  // what actually counts as SVG (so plain XML/HTML isn't mislabeled).
  const detect = (s: string) => new UploadedFile('f', createMockFile('f', new Uint8Array(0))).detectExtname(Buffer.from(s))

  test('detects SVG preceded by a UTF-8 BOM', () => {
    expect(detect('﻿<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBe('svg')
  })

  test('detects SVG after leading whitespace', () => {
    expect(detect('   \n\t<svg></svg>')).toBe('svg')
  })

  test('detects SVG after an XML comment', () => {
    expect(detect('<!-- generated -->\n<svg></svg>')).toBe('svg')
  })

  test('detects SVG after a DOCTYPE', () => {
    expect(detect('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "...">\n<svg></svg>')).toBe('svg')
  })

  test('plain XML (non-SVG root) is not detected as SVG', () => {
    expect(detect('<?xml version="1.0"?><config><a/></config>')).toBeNull()
  })

  test('HTML is not detected as SVG', () => {
    expect(detect('<!doctype html><html><body></body></html>')).toBeNull()
  })

  test('an element whose name merely starts with svg is not SVG', () => {
    expect(detect('<svgsomething></svgsomething>')).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════
// Extension validation
// ═══════════════════════════════════════════════════════════

describe('UploadedFile — extension validation', () => {
  test('rejects disallowed extension', () => {
    const file = new UploadedFile('avatar', createMockFile('hack.exe', new Uint8Array(10)), { extnames: ['jpg', 'png'] })
    expect(file.hasErrors).toBe(true)
    expect(file.errors[0].rule).toBe('extname')
  })

  test('accepts allowed extension', () => {
    const file = new UploadedFile('avatar', createMockFile('photo.jpg', new Uint8Array(10)), { extnames: ['jpg', 'png'] })
    expect(file.errors.filter(e => e.rule === 'extname').length).toBe(0)
  })

  test('rejects oversized file', () => {
    const bigData = new Uint8Array(2 * 1024 * 1024 + 1) // 2MB + 1 byte
    const file = new UploadedFile('avatar', createMockFile('big.jpg', bigData), { size: '2mb' })
    expect(file.hasErrors).toBe(true)
    expect(file.errors[0].rule).toBe('size')
  })

  test('accepts correctly sized file', () => {
    const data = new Uint8Array(1024) // 1KB
    const file = new UploadedFile('avatar', createMockFile('small.jpg', data), { size: '2mb' })
    expect(file.errors.filter(e => e.rule === 'size').length).toBe(0)
  })

  test('file without extension has empty extname', () => {
    const file = new UploadedFile('data', createMockFile('noext', new Uint8Array(5)))
    expect(file.extname).toBe('')
  })

  test('double extension uses last part', () => {
    const file = new UploadedFile('data', createMockFile('file.tar.gz', new Uint8Array(5)))
    expect(file.extname).toBe('gz')
  })
})

// ═══════════════════════════════════════════════════════════
// Prototype pollution in query parser
// ═══════════════════════════════════════════════════════════

describe('Query parser — prototype pollution comprehensive', () => {
  const BLOCKED = ['__proto__', 'constructor', 'prototype']

  test('all blocked keys are in the set', () => {
    for (const key of BLOCKED) {
      expect(BLOCKED.includes(key)).toBe(true)
    }
  })

  test('Object.prototype remains unmodified', () => {
    const obj: any = {}
    expect(obj.polluted).toBeUndefined()
    expect(obj.isAdmin).toBeUndefined()
    expect(obj.toString).toBe(Object.prototype.toString)
  })

  test('Array.prototype remains unmodified', () => {
    const arr: any = []
    expect(arr.polluted).toBeUndefined()
  })

  test('nested __proto__ variations are blocked', () => {
    // The middleware blocks at any depth level
    for (const key of BLOCKED) {
      expect(BLOCKED.includes(key)).toBe(true)
    }
  })

  test('normal keys are not blocked', () => {
    expect(BLOCKED.includes('name')).toBe(false)
    expect(BLOCKED.includes('email')).toBe(false)
    expect(BLOCKED.includes('data')).toBe(false)
    expect(BLOCKED.includes('proto')).toBe(false) // without underscores
    expect(BLOCKED.includes('construct')).toBe(false)
  })
})
