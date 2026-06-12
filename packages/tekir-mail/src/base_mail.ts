import { getApp } from '@tekir/core'
import { MailBuilder } from './builder'
import { Mail } from './manager'

export abstract class BaseMail {
  protected builder!: MailBuilder

  abstract prepare(): MailBuilder

  async send(manager?: Mail): Promise<void> {
    const mgr = manager ?? getApp().use('mail') as Mail
    this.builder = new MailBuilder(mgr)
    const configured = this.prepare()
    await configured.send()
  }
}
