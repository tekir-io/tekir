import type { SSEEvent } from './types'

// SSE helper. Format and shape adapted from Elysia (`elysia/src/handler.ts`,
// MIT, Copyright 2022 saltyAom). See `packages/tekir-core/NOTICE.md`.
export function sse(data: SSEEvent | string): string {
  const strip = (v: string) => String(v).replace(/[\r\n]/g, '')
  if (typeof data === 'string') return `data: ${strip(data)}\n\n`

  let result = ''
  if (data.event) result += `event: ${strip(data.event)}\n`
  if (data.id) result += `id: ${strip(data.id)}\n`
  if (data.retry !== undefined) result += `retry: ${strip(String(data.retry))}\n`
  const payload = typeof data.data === 'object' ? JSON.stringify(data.data) : strip(String(data.data))
  result += `data: ${payload}\n\n`
  return result
}
