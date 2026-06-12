export type TransportName = 'smtp' | 'resend' | 'mailgun' | 'ses' | 'log' | 'custom'

export interface MailConfig {
  default?: TransportName
  from?: string
  transports?: {
    smtp?: SmtpConfig
    sevk?: SevkConfig
    resend?: ResendConfig
    mailgun?: MailgunConfig
    ses?: SesConfig
    log?: LogConfig
  }
}

export interface SmtpConfig {
  host: string
  port?: number
  /** Use implicit TLS (TLS from the first byte, typically port 465). Default: false. */
  secure?: boolean
  /**
   * Require the connection to be upgraded to TLS via STARTTLS before sending.
   * Defaults to `true` for non-secure connections so credentials and message
   * content are never sent over a plaintext link. Set to `false` only for
   * trusted local relays that do not support TLS.
   */
  requireTLS?: boolean
  /** TLS options forwarded to nodemailer (e.g. `{ rejectUnauthorized, ca }`). */
  tls?: {
    /** Reject connections whose certificate cannot be verified. Default: true. */
    rejectUnauthorized?: boolean
    /** Custom CA certificate(s). */
    ca?: string | string[]
    /** Expected server name for SNI / certificate validation. */
    servername?: string
  }
  auth?: {
    user: string
    pass: string
  }
}

export interface SevkConfig {
  apiKey: string
  baseUrl?: string
}

export interface ResendConfig {
  apiKey: string
  baseUrl?: string
}

export interface MailgunConfig {
  apiKey: string
  domain: string
  region?: 'us' | 'eu'
}

export interface SesConfig {
  accessKeyId: string
  secretAccessKey: string
  region: string
}

export interface LogConfig {
  pretty?: boolean
  /**
   * Redact message bodies and recipient addresses so password-reset tokens,
   * magic links and PII are never written to logs. Defaults to `true`; set to
   * `false` (e.g. in local development) to log full content.
   */
  redact?: boolean
}

export interface MailMessage {
  from?: string
  to: string | string[]
  cc?: string | string[]
  bcc?: string | string[]
  replyTo?: string
  subject: string
  html?: string
  text?: string
  attachments?: MailAttachment[]
  headers?: Record<string, string>
}

export interface MailAttachment {
  filename: string
  content: string | Buffer
  contentType?: string
  encoding?: string
}

export interface SentMail extends MailMessage {
  transport: TransportName | string
  sentAt: Date
}

export type TemplateFn<T = Record<string, unknown>> = (data: T) => string

export interface Transport {
  name: string
  send(message: MailMessage): Promise<void>
}
