import type { MailMessage } from './types'

// Centralized header sanitization. Every outbound message passes through
// `sanitizeMessage` at the dispatch boundary so header-injection protection no
// longer depends solely on the MailBuilder. Any code path that reaches a
// transport (Mail.dispatch, the notification mail channel, direct MailMessage
// construction) is covered.

/** Strip CR/LF (and bare CR/LF) so a value cannot inject extra headers. */
export function stripCrlf(value: string): string {
  return String(value).replace(/[\r\n]+/g, '')
}

function sanitizeAddress(addr: string | string[] | undefined): string | string[] | undefined {
  if (addr === undefined) return undefined
  if (Array.isArray(addr)) return addr.map(stripCrlf)
  return stripCrlf(addr)
}

/**
 * Return a copy of the message with every header-bearing field stripped of CRLF.
 * Bodies (html/text) are left intact: they are not headers and stripping them
 * would corrupt content. Attachment `filename` values are sanitized because they
 * end up in a Content-Disposition header.
 */
export function sanitizeMessage(message: MailMessage): MailMessage {
  const headers = message.headers
    ? Object.fromEntries(
        Object.entries(message.headers).map(([k, v]) => [stripCrlf(k), stripCrlf(String(v))])
      )
    : undefined

  return {
    ...message,
    from: message.from !== undefined ? stripCrlf(message.from) : undefined,
    to: sanitizeAddress(message.to) as string | string[],
    cc: sanitizeAddress(message.cc),
    bcc: sanitizeAddress(message.bcc),
    replyTo: message.replyTo !== undefined ? stripCrlf(message.replyTo) : undefined,
    subject: stripCrlf(message.subject),
    attachments: message.attachments
      ? message.attachments.map((a) => ({ ...a, filename: stripCrlf(a.filename) }))
      : undefined,
    headers,
  }
}
