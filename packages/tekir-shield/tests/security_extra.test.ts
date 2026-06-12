import { test, expect, describe } from 'bun:test'
import { sanitize, escapeHtml, unescapeHtml } from '../src/index'

describe('sanitize — advanced payloads', () => {
  test('strips iframe', () => { expect(sanitize('<iframe src="evil.com"></iframe>')).toBe('') })
  test('strips object tag', () => { expect(sanitize('<object data="evil.swf"></object>')).toBe('') })
  test('strips embed tag', () => { expect(sanitize('<embed src="evil">')).toBe('') })
  test('strips form tag', () => { expect(sanitize('<form action="evil"><input></form>')).toBe('') })
  test('strips marquee', () => { expect(sanitize('<marquee>text</marquee>')).toBe('text') })
  test('strips meta tag', () => { expect(sanitize('<meta http-equiv="refresh">')).toBe('') })
  test('strips link tag', () => { expect(sanitize('<link rel="stylesheet">')).toBe('') })
  test('strips base tag', () => { expect(sanitize('<base href="evil">')).toBe('') })
  test('preserves text with entities', () => { expect(sanitize('5 &gt; 3')).toBe('5 &gt; 3') })
  test('strips nested tags', () => { expect(sanitize('<div><span><b>text</b></span></div>')).toBe('text') })
  test('handles empty input', () => { expect(sanitize('')).toBe('') })
  test('handles whitespace only', () => { expect(sanitize('   ')).toBe('   ') })
  test('handles multiline script', () => {
    expect(sanitize(`<script>
      var x = 1;
      alert(x);
    </script>safe`)).toBe('safe')
  })
  test('handles multiline style', () => {
    expect(sanitize(`<style>
      body { display: none; }
    </style>visible`)).toBe('visible')
  })
})

describe('escapeHtml — comprehensive', () => {
  test('escapes all OWASP characters', () => {
    const r = escapeHtml('&<>"\'`/=')
    expect(r).not.toContain('<')
    expect(r).not.toContain('>')
    expect(r).not.toContain('"')
    expect(r).not.toContain("'")
    expect(r).not.toContain('`')
    // Contains escaped versions
    expect(r).toContain('&amp;')
    expect(r).toContain('&lt;')
    expect(r).toContain('&gt;')
    expect(r).toContain('&quot;')
  })

  test('preserves normal text', () => {
    expect(escapeHtml('Hello World 123')).toBe('Hello World 123')
  })

  test('preserves unicode', () => {
    expect(escapeHtml('Merhaba dünya 🌍')).toBe('Merhaba dünya 🌍')
  })

  test('handles empty string', () => {
    expect(escapeHtml('')).toBe('')
  })

  test('handles long XSS payload', () => {
    const payload = '<script>'.repeat(100) + 'alert(1)' + '</script>'.repeat(100)
    const escaped = escapeHtml(payload)
    expect(escaped).not.toContain('<')
  })
})

describe('unescapeHtml — comprehensive', () => {
  test('roundtrip with escapeHtml', () => {
    const original = '<div class="test">Hello & goodbye</div>'
    expect(unescapeHtml(escapeHtml(original))).toBe(original)
  })

  test('roundtrip with special chars', () => {
    const original = "It's a `test` = true & false / maybe"
    expect(unescapeHtml(escapeHtml(original))).toBe(original)
  })

  test('handles already unescaped text', () => {
    expect(unescapeHtml('plain text')).toBe('plain text')
  })

  test('handles empty string', () => {
    expect(unescapeHtml('')).toBe('')
  })

  test('leaves unknown entities', () => {
    expect(unescapeHtml('&nbsp;&mdash;')).toContain('&')
  })
})
