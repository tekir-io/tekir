// No global state. Use TekirApp instance directly.
// This file only provides the setContainer/getApp for the current tekir context.
// Last tekir() call wins — for convenience imports in single-app scenarios.

import type { App } from './app'
import type { TekirServer } from './server/server'
import type { Logger } from '@tekir/logger'

let _app: App | null = null
let _server: TekirServer | null = null
let _logger: Logger | null = null

/**
 * Store the global app, server, and logger references for the current Tekir context.
 * @param app - The application container
 * @param server - The Tekir HTTP server
 * @param logger - The logger instance
 */
export function setContainer(app: App, server: TekirServer, logger: Logger) {
  _app = app
  _server = server
  _logger = logger
}

/**
 * Retrieve the global App instance. Throws if `tekir()` has not been called.
 * @returns The current App container
 * @throws {Error} If the app has not been initialized
 */
export function getApp(): App {
  if (!_app) throw new Error('App not initialized. Call tekir() first.')
  return _app
}

/**
 * Retrieve the global TekirServer instance. Throws if `tekir()` has not been called.
 * @returns The current TekirServer
 * @throws {Error} If the server has not been initialized
 */
export function getServer(): TekirServer {
  if (!_server) throw new Error('Server not initialized. Call tekir() first.')
  return _server
}

/**
 * Retrieve the global Logger instance. Throws if `tekir()` has not been called.
 * @returns The current Logger
 * @throws {Error} If the logger has not been initialized
 */
export function getLogger(): Logger {
  if (!_logger) throw new Error('Logger not initialized. Call tekir() first.')
  return _logger
}

/**
 * Retrieve the Router from the global server instance.
 * @returns The current Router
 */
export function getRouter() {
  return getServer().getRouter()
}

/**
 * Create a lazy proxy to a named service. The service is resolved from the container
 * on first property access, enabling use before the app is fully booted.
 * @param name - The service identifier registered in the App container
 * @returns A proxy that forwards property access to the resolved service
 *
 * @example
 * const db = service<Database>('db')
 * // Later, when app is booted:
 * db.query('SELECT * FROM users')
 */
export function service<T extends object>(name: string): T {
  let _cached: T
  return new Proxy({} as T, {
    get(_, prop) { return ((_cached ?? (_cached = getApp().use(name))) as any)[prop] },
  })
}
