import type { Transport, MailMessage, SesConfig } from '../types'

// SES Transport (HTTP / AWS Signature v4)

/**
 * Mail transport that delivers emails via Amazon SES using AWS Signature v4 authentication.
 * Uses the Web Crypto API for request signing (no AWS SDK dependency required).
 *
 * @example
 * ```ts
 * const transport = new SesTransport({ accessKeyId: 'AKIA...', secretAccessKey: '...', region: 'us-east-1' })
 * await transport.send({ to: 'user@example.com', subject: 'Hello', from: 'noreply@example.com' })
 * ```
 */
export class SesTransport implements Transport {
  readonly name = 'ses'

  constructor(private config: SesConfig) {}

  /**
   * Build a SigV4 `x-amz-date` (`YYYYMMDD'T'HHMMSS'Z'`) deterministically from
   * the UTC components, avoiding any dependence on the millisecond formatting of
   * `Date.toISOString()` which could shift the value and break the signature.
   */
  /**
   * Build a SigV4 canonical query string: parameters sorted by key and
   * RFC 3986 encoded. Currently SES requests carry no query (params go in the
   * body), but this keeps the signature correct if a query is ever added.
   */
  static canonicalQuery(params: URLSearchParams): string {
    const enc = (s: string) =>
      encodeURIComponent(s).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    const pairs: string[] = []
    for (const [k, v] of params) pairs.push(`${enc(k)}=${enc(v)}`)
    return pairs.sort().join('&')
  }

  static amzDate(date: Date): string {
    const p = (n: number, w = 2) => String(n).padStart(w, '0')
    return (
      `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
      `T${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`
    )
  }

  private async sign(
    method: string,
    url: URL,
    body: string,
    date: string
  ): Promise<string> {
    const dateStamp = date.slice(0, 8)
    const service = 'ses'
    const region = this.config.region

    const canonicalHeaders =
      `content-type:application/x-www-form-urlencoded\n` +
      `host:${url.host}\n` +
      `x-amz-date:${date}\n`

    const signedHeaders = 'content-type;host;x-amz-date'

    // SHA-256 hash of the payload
    const payloadHash = await this.sha256Hex(body)

    const canonicalRequest = [
      method,
      url.pathname,
      SesTransport.canonicalQuery(url.searchParams),
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n')

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      date,
      credentialScope,
      await this.sha256Hex(canonicalRequest),
    ].join('\n')

    const signingKey = await this.deriveSigningKey(dateStamp, region, service)
    const signature = await this.hmacHex(signingKey, stringToSign)

    return (
      `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`
    )
  }

  private async sha256Hex(data: string): Promise<string> {
    const encoder = new TextEncoder()
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data))
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  private async hmacRaw(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
    const encoder = new TextEncoder()
    const rawKey = key instanceof Uint8Array ? (key.buffer as ArrayBuffer) : key
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      rawKey,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data).buffer as ArrayBuffer)
  }

  private async hmacHex(key: ArrayBuffer | Uint8Array, data: string): Promise<string> {
    const raw = await this.hmacRaw(key, data)
    return Array.from(new Uint8Array(raw))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  private async deriveSigningKey(
    dateStamp: string,
    region: string,
    service: string
  ): Promise<ArrayBuffer> {
    const encoder = new TextEncoder()
    const kDate = await this.hmacRaw(
      encoder.encode(`AWS4${this.config.secretAccessKey}`),
      dateStamp
    )
    const kRegion = await this.hmacRaw(kDate, region)
    const kService = await this.hmacRaw(kRegion, service)
    return this.hmacRaw(kService, 'aws4_request')
  }

  async send(message: MailMessage): Promise<void> {
    const endpoint = `https://email.${this.config.region}.amazonaws.com/`
    const url = new URL(endpoint)

    const toList = Array.isArray(message.to) ? message.to : [message.to]
    const params = new URLSearchParams()
    params.append('Action', 'SendEmail')
    if (message.from) params.append('Source', message.from)
    toList.forEach((t, i) =>
      params.append(`Destination.ToAddresses.member.${i + 1}`, t)
    )

    if (message.cc) {
      const ccList = Array.isArray(message.cc) ? message.cc : [message.cc]
      ccList.forEach((c, i) =>
        params.append(`Destination.CcAddresses.member.${i + 1}`, c)
      )
    }

    if (message.bcc) {
      const bccList = Array.isArray(message.bcc) ? message.bcc : [message.bcc]
      bccList.forEach((b, i) =>
        params.append(`Destination.BccAddresses.member.${i + 1}`, b)
      )
    }

    params.append('Message.Subject.Data', message.subject)
    if (message.html) params.append('Message.Body.Html.Data', message.html)
    if (message.text) params.append('Message.Body.Text.Data', message.text)
    if (message.replyTo)
      params.append('ReplyToAddresses.member.1', message.replyTo)

    const body = params.toString()
    const amzDate = SesTransport.amzDate(new Date())

    const authHeader = await this.sign('POST', url, body, amzDate)

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Amz-Date': amzDate,
        Authorization: authHeader,
      },
      body,
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`[tekir/mail] SES API error (${response.status}): ${truncate(error)}`)
    }
  }
}

/** Limit provider error bodies so they can't bloat or pollute logs. */
function truncate(s: string, max = 500): string {
  return s.length > max ? s.slice(0, max) + '…(truncated)' : s
}
