import { join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'

export interface Command {
  name: string
  description: string
  run(args: string[], ctx: any): Promise<void>
}

function validTypeName(name: string, suffix?: string): string | null {
  const className = suffix && !name.endsWith(suffix) ? `${name}${suffix}` : name
  // Generated names become both file paths and executable TypeScript source.
  // Restrict them to identifiers so `../`, quotes, and template expressions
  // cannot escape the target directory or inject code into the scaffold.
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(className) ? className : null
}

function snakeName(name: string, suffix = ''): string {
  const base = suffix && name.endsWith(suffix) ? name.slice(0, -suffix.length) : name
  return base.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')
}


const serveCommand: Command = {
  name: 'serve',
  description: 'Start HTTP server',
  async run(_args, { tekir }) {
    tekir.start()
  },
}

const makeControllerCommand: Command = {
  name: 'make:controller',
  description: 'Create a new controller',
  async run(args, { appRoot, tekir }) {
    const name = args[0]
    if (!name) { tekir.logger.error('Usage: tekir make:controller <Name>'); return }
    const className = validTypeName(name, 'Controller')
    if (!className) { tekir.logger.error('Controller name must be a valid TypeScript identifier'); return }

    const dir = join(appRoot, 'app', 'controllers')
    mkdirSync(dir, { recursive: true })

    const fileName = snakeName(className, 'Controller') + '_controller.ts'
    const path = args[1] || `/${name.replace(/Controller$/, '').toLowerCase()}`

    const content = `import { Controller, Get, Post, Put, Delete } from '@tekir/http-decorators'
import type { HttpContext } from '@tekir/core'

@Controller(${JSON.stringify(path)})
export class ${className} {
  @Get('/')
  index({ response }: HttpContext) {
    return response.ok([])
  }

  @Get('/:id')
  show({ params, response }: HttpContext) {
    return response.ok({ id: params.id })
  }

  @Post('/')
  store({ body, response }: HttpContext) {
    return response.created(body)
  }

  @Put('/:id')
  update({ params, body, response }: HttpContext) {
    return response.ok({ id: params.id, ...body })
  }

  @Delete('/:id')
  destroy({ response }: HttpContext) {
    return response.noContent()
  }
}
`
    writeFileSync(join(dir, fileName), content)
    tekir.logger.info(`Created: src/controllers/${fileName}`)
  },
}

const makeMiddlewareCommand: Command = {
  name: 'make:middleware',
  description: 'Create a new middleware',
  async run(args, { appRoot, tekir }) {
    const name = args[0]
    if (!name) { tekir.logger.error('Usage: make:middleware <name>'); return }
    const typeName = validTypeName(name)
    if (!typeName) { tekir.logger.error('Middleware name must be a valid TypeScript identifier'); return }

    const dir = join(appRoot, 'app', 'middleware')
    mkdirSync(dir, { recursive: true })

    const fileName = snakeName(typeName) + '.ts'
    const fnName = typeName.charAt(0).toLowerCase() + typeName.slice(1)

    const content = `import type { HttpContext } from '@tekir/core'

export default async function ${fnName}({ request, response }: HttpContext, next: () => Promise<void>) {
  await next()
}
`
    writeFileSync(join(dir, fileName), content)
    tekir.logger.info(`Created: app/middleware/${fileName}`)
  },
}

const makeProviderCommand: Command = {
  name: 'make:provider',
  description: 'Create a new service provider',
  async run(args, { appRoot, tekir }) {
    const name = args[0]
    if (!name) { tekir.logger.error('Usage: make:provider <Name>'); return }
    const className = validTypeName(name, 'Provider')
    if (!className) { tekir.logger.error('Provider name must be a valid TypeScript identifier'); return }

    const dir = join(appRoot, 'app', 'providers')
    mkdirSync(dir, { recursive: true })

    const fileName = snakeName(className, 'Provider') + '_provider.ts'

    const content = `import type { App } from '@tekir/core'

export class ${className} {
  async register(app: App) {
  }

  async boot(app: App) {
  }
}
`
    writeFileSync(join(dir, fileName), content)
    tekir.logger.info(`Created: app/providers/${fileName}`)
  },
}

const makeCommandCommand: Command = {
  name: 'make:command',
  description: 'Create a new CLI command',
  async run(args, { appRoot, tekir }) {
    const name = args[0]
    if (!name) { tekir.logger.error('Usage: make:command <Name>'); return }
    const className = validTypeName(name, 'Command')
    if (!className) { tekir.logger.error('Command name must be a valid TypeScript identifier'); return }

    const dir = join(appRoot, 'commands')
    mkdirSync(dir, { recursive: true })

    const fileName = snakeName(className, 'Command') + '.ts'
    const cmdName = name.replace(/Command$/, '').replace(/([A-Z])/g, ':$1').toLowerCase().replace(/^:/, '')

    const content = `import { BaseCommand } from '@tekir/commands'

export default class ${className} extends BaseCommand {
  static commandName = '${cmdName}'
  static description = ''

  static args = {}
  static flags = {}

  async run() {
    this.logger.info('Hello from ${cmdName}!')
  }
}
`
    writeFileSync(join(dir, fileName), content)
    tekir.logger.info(`Created: commands/${fileName}`)
  },
}

const listRoutesCommand: Command = {
  name: 'routes',
  description: 'List all registered routes',
  async run(_args, { tekir }) {
    const trie = tekir.router.getTrie()
    const routes: Array<{ method: string; pattern: string; name?: string }> = []

    const walk = (node: any) => {
      for (const [method, route] of node.handlers) {
        routes.push({ method, pattern: route.pattern, name: route.name })
      }
      for (const [, child] of node.children) walk(child)
      if (node.paramChild) walk(node.paramChild.node)
      if (node.wildcardChild) walk(node.wildcardChild.node)
    }
    walk(trie.root)

    console.log('\n  Method    Path                              Name')
    console.log('  ' + '-'.repeat(60))
    for (const r of routes.sort((a, b) => a.pattern.localeCompare(b.pattern))) {
      console.log(`  ${r.method.padEnd(8)}  ${r.pattern.padEnd(34)}${r.name || ''}`)
    }
    console.log()
  },
}

const replCommand: Command = {
  name: 'repl',
  description: 'Start an interactive REPL session',
  async run(_args, { tekir, appRoot }) {
    const { startRepl } = await import('./repl')
    await startRepl(tekir, appRoot)
  },
}

const helpCommand: Command = {
  name: 'help',
  description: 'Show available commands',
  async run(_args, { commands }) {
    console.log('\n  tekir Framework CLI\n')
    console.log('  Usage: bun tekir <command> [args]\n')
    console.log('  Commands:')
    for (const cmd of commands) {
      console.log(`    ${cmd.name.padEnd(22)} ${cmd.description}`)
    }
    console.log()
  },
}

const generateKeyCommand: Command = {
  name: 'generate:key',
  description: 'Generate a secure APP_KEY and write it to .env',
  async run() { /* handled early in tekir() before providers boot */ },
}

export const builtInCommands: Command[] = [
  serveCommand,
  generateKeyCommand,
  makeControllerCommand,
  makeMiddlewareCommand,
  makeProviderCommand,
  makeCommandCommand,
  listRoutesCommand,
  replCommand,
  helpCommand,
]
