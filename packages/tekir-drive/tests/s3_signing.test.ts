import { afterEach, describe, expect, test } from 'bun:test'
import { S3Driver } from '../src/drivers/s3'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

function driver() {
  return new S3Driver({
    driver: 's3', bucket: 'test-bucket', region: 'us-east-1',
    accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret',
    endpoint: 'https://storage.example.com/', forcePathStyle: true,
  })
}

describe('S3Driver SigV4 request construction', () => {
  test('object URLs encode every key segment without changing slash structure', async () => {
    let requested = ''
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requested = String(input)
      return new Response('ok')
    }) as typeof fetch
    await driver().get('folder/a b#?.txt')
    expect(requested).toBe('https://storage.example.com/test-bucket/folder/a%20b%23%3F.txt')
  })

  test('list signs the actual query string and paginates encoded prefixes', async () => {
    const requests: Array<{ url: string; authorization: string }> = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      requests.push({ url: String(input), authorization: headers.get('authorization') ?? '' })
      return new Response('<ListBucketResult><Key>a&amp;b.txt</Key><IsTruncated>false</IsTruncated></ListBucketResult>')
    }) as typeof fetch
    expect(await driver().list('a folder/')).toEqual(['a&b.txt'])
    expect(await driver().list('other/')).toEqual(['a&b.txt'])
    expect(requests[0].url).toContain('prefix=a%20folder%2F')
    expect(requests[0].authorization).not.toBe(requests[1].authorization)
  })

  test('delete surfaces remote failures', async () => {
    globalThis.fetch = (async () => new Response('denied', { status: 403 })) as unknown as typeof fetch
    await expect(driver().delete('private.txt')).rejects.toThrow('S3 DELETE failed: 403')
  })

  test('exists returns false only for 404 and surfaces outages/authorization errors', async () => {
    globalThis.fetch = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch
    expect(await driver().exists('missing.txt')).toBe(false)

    globalThis.fetch = (async () => new Response(null, { status: 403 })) as unknown as typeof fetch
    await expect(driver().exists('private.txt')).rejects.toThrow('S3 HEAD failed')

    globalThis.fetch = (async () => { throw new Error('network down') }) as unknown as typeof fetch
    await expect(driver().exists('x')).rejects.toThrow('network down')
  })

  test('list surfaces remote failures instead of returning a misleading partial result', async () => {
    globalThis.fetch = (async () => new Response('denied', { status: 403 })) as unknown as typeof fetch
    await expect(driver().list()).rejects.toThrow('S3 LIST failed: 403')
  })

  test('moving an object onto itself is a no-op', async () => {
    let calls = 0
    globalThis.fetch = (async () => { calls++; return new Response() }) as unknown as typeof fetch
    await driver().move('same.txt', 'same.txt')
    expect(calls).toBe(0)
  })

  test('signed URLs encode keys and reject expiry values AWS will not accept', async () => {
    const s3 = driver()
    const url = await s3.getSignedUrl('reports/a #1.pdf', { expiresIn: 60 })
    expect(url).toContain('/reports/a%20%231.pdf?')
    await expect(s3.getSignedUrl('x', { expiresIn: 0 })).rejects.toThrow('between 1 and 604800')
    await expect(s3.getSignedUrl('x', { expiresIn: 604801 })).rejects.toThrow('between 1 and 604800')
  })
})
