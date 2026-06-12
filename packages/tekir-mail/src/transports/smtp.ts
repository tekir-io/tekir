import type { Transport, MailMessage, SmtpConfig } from '../types'

// SMTP Transport (nodemailer — optional peer dependency)

export class SmtpTransport implements Transport {
  readonly name = 'smtp'

  constructor(private config: SmtpConfig) {}

  async send(message: MailMessage): Promise<void> {
    let nodemailer: any
    try {
      // @ts-ignore — nodemailer is an optional peer dependency
      nodemailer = await import('nodemailer')
    } catch {
      throw new Error(
        '[tekir/mail] SMTP transport requires nodemailer. Run: bun add nodemailer'
      )
    }

    const secure = this.config.secure ?? false
    const transporter = nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port ?? 587,
      secure,
      // Secure-by-default: for non-implicit-TLS connections, force a STARTTLS
      // upgrade so credentials and content are never sent in plaintext. Callers
      // can opt out for trusted local relays with requireTLS: false.
      requireTLS: secure ? undefined : (this.config.requireTLS ?? true),
      tls: this.config.tls
        ? { rejectUnauthorized: true, ...this.config.tls }
        : undefined,
      auth: this.config.auth,
    })

    await transporter.sendMail({
      from: message.from,
      to: Array.isArray(message.to) ? message.to.join(', ') : message.to,
      cc: message.cc
        ? Array.isArray(message.cc)
          ? message.cc.join(', ')
          : message.cc
        : undefined,
      bcc: message.bcc
        ? Array.isArray(message.bcc)
          ? message.bcc.join(', ')
          : message.bcc
        : undefined,
      replyTo: message.replyTo,
      subject: message.subject,
      html: message.html,
      text: message.text,
      attachments: message.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
        encoding: a.encoding,
      })),
      headers: message.headers,
    })
  }
}
