
// tekir REPL — interactive shell with app context
//
// Usage: bun run index.ts repl
//
// Boots the app and drops into a REPL with services, models, and helpers.

import repl from 'repl'
import { existsSync, readdirSync, mkdirSync } from 'fs'
import { join } from 'path'

export async function startRepl(tekirApp: any, appRoot: string) {
  const models: Record<string, any> = {}
  const services: Record<string, any> = {}

  // Pre-load services

  services.app = tekirApp.app
  services.config = tekirApp.config
  services.logger = tekirApp.logger

  const tryService = (name: string) => {
    try {
      const svc = tekirApp.app.use(name)
      if (svc) services[name] = svc
    } catch {}
  }

  for (const name of ['db', 'cache', 'redis', 'auth', 'drive', 'mail', 'emitter', 'queue', 'hash', 'encrypt']) {
    tryService(name)
  }

  // Helper: loadModels()

  async function loadModels() {
    const modelsDir = join(appRoot, 'app', 'models')
    if (!existsSync(modelsDir)) {
      console.log('\x1b[33mNo app/models directory found\x1b[0m')
      return models
    }

    const files = readdirSync(modelsDir).filter(f => /\.(ts|js)$/.test(f))
    for (const file of files) {
      try {
        const mod = await import(join(modelsDir, file).replace(/\\/g, '/'))
        for (const [name, value] of Object.entries(mod)) {
          if (typeof value === 'function' && (value as any).table) {
            const key = name.charAt(0).toLowerCase() + name.slice(1)
            models[key] = value
          }
        }
      } catch {}
    }

    const keys = Object.keys(models)
    if (keys.length > 0) {
      console.log(`\x1b[32mLoaded ${keys.length} model(s):\x1b[0m ${keys.join(', ')}`)
    } else {
      console.log('\x1b[33mNo models found\x1b[0m')
    }

    return models
  }

  // Helper: loadServices()

  async function loadServices() {
    const servicesFile = join(appRoot, 'services.ts')
    if (!existsSync(servicesFile)) {
      const alt = join(appRoot, 'app', 'services.ts')
      if (!existsSync(alt)) {
        console.log('\x1b[33mNo services.ts found\x1b[0m')
        return services
      }
    }

    try {
      const mod = await import((existsSync(join(appRoot, 'services.ts'))
        ? join(appRoot, 'services.ts')
        : join(appRoot, 'app', 'services.ts')
      ).replace(/\\/g, '/'))

      for (const [name, value] of Object.entries(mod)) {
        services[name] = value
      }
      console.log(`\x1b[32mLoaded services:\x1b[0m ${Object.keys(mod).join(', ')}`)
    } catch (e: any) {
      console.log(`\x1b[31mFailed to load services:\x1b[0m ${e.message}`)
    }

    return services
  }

  // Helper: importFile(path)

  async function importFile(filePath: string) {
    const fullPath = join(appRoot, filePath).replace(/\\/g, '/')
    const mod = await import(fullPath)
    const keys = Object.keys(mod)
    console.log(`\x1b[32mImported:\x1b[0m ${keys.join(', ')}`)
    return mod
  }

  // Banner

  console.log()
  console.log('\x1b[1mTekir REPL\x1b[0m v0.1')
  console.log()
  console.log('  \x1b[33mawait loadModels()\x1b[0m    Load app models')
  console.log('  \x1b[33mawait loadServices()\x1b[0m  Load app services')
  console.log('  \x1b[33m.help\x1b[0m                 REPL commands')
  console.log()

  const loadedServices = Object.keys(services).filter(k => !['app', 'config', 'logger'].includes(k))
  if (loadedServices.length > 0) {
    console.log(`\x1b[32mServices:\x1b[0m ${loadedServices.join(', ')}`)
  }
  console.log()

  // Persistent history

  const historyDir = join(appRoot, '.tekir')
  const historyFile = join(historyDir, 'repl_history')
  mkdirSync(historyDir, { recursive: true })

  // Start REPL

  const server = repl.start({
    prompt: '\x1b[36mtekir>\x1b[0m ',
    useGlobal: false,
    breakEvalOnSigint: true,
    preview: true,
  })

  // Inject services into REPL context
  for (const [key, value] of Object.entries(services)) {
    server.context[key] = value
  }

  // Inject helpers
  server.context.models = models
  server.context.loadModels = loadModels
  server.context.loadServices = loadServices
  server.context.importFile = importFile

  // History persistence
  try {
    if (existsSync(historyFile)) {
      const lines = require('fs').readFileSync(historyFile, 'utf-8').split('\n').filter(Boolean)
      for (const line of lines.reverse()) {
        (server as any).history.push(line)
      }
    }
  } catch {}

  server.on('exit', () => {
    try {
      const hist = (server as any).history || []
      require('fs').writeFileSync(historyFile, hist.join('\n'))
    } catch {}
    console.log('Bye!')
    process.exit(0)
  })

  // Custom .models command
  server.defineCommand('models', {
    help: 'List loaded models',
    action() {
      const keys = Object.keys(models)
      if (keys.length === 0) {
        console.log('\x1b[33mNo models loaded. Run: await loadModels()\x1b[0m')
      } else {
        console.log(`\x1b[32mModels:\x1b[0m ${keys.join(', ')}`)
      }
      this.displayPrompt()
    },
  })

  // Custom .services command
  server.defineCommand('services', {
    help: 'List available services',
    action() {
      const keys = Object.keys(services)
      console.log(`\x1b[32mServices:\x1b[0m ${keys.join(', ')}`)
      this.displayPrompt()
    },
  })

  // Custom .load command override — load a project file
  server.defineCommand('import', {
    help: 'Import a project file: .import app/models/user.ts',
    async action(path: string) {
      if (!path.trim()) {
        console.log('Usage: .import <file-path>')
        this.displayPrompt()
        return
      }
      try {
        const mod = await importFile(path.trim())
        for (const [key, value] of Object.entries(mod)) {
          server.context[key] = value
        }
      } catch (e: any) {
        console.error(`\x1b[31mError:\x1b[0m ${e.message}`)
      }
      this.displayPrompt()
    },
  })

  // Keep alive
  return new Promise(() => {})
}
