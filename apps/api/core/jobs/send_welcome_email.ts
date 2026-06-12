import { BaseJob } from '@tekir/queue'

export class SendWelcomeEmail extends BaseJob {
  constructor(public userId: number, public email: string) { super() }

  async handle() {
    // In production: await mail.to(this.email).subject('Welcome!').html('...').send()
    console.log(`[job] Welcome email sent to ${this.email}`)
  }
}
