import { isTC39Decorator } from './utils'
import type { HttpMethod, RouteMetadata, RouteOptions } from './types'

function addRoute(target: any, metadata: RouteMetadata): void {
  // Use an own-property check so a subclass doesn't push into the parent's
  // inherited __routes array (which would leak the parent's routes into the
  // child and vice-versa). A subclass inherits a copy of the parent's routes.
  if (!Object.hasOwn(target, '__routes')) {
    target.__routes = Array.isArray(target.__routes) ? [...target.__routes] : []
  }
  target.__routes.push(metadata)
}

function getMethodFunction(method: HttpMethod, path: string = '', options?: RouteOptions) {
  return (target: any, context?: any) => {
    if (isTC39Decorator(context)) {
      // TC39 method decorator
      // Store route metadata directly on the function for @Controller to pick up
      const methodName = String(context.name)
      if (!target.__routeMeta) target.__routeMeta = []
      target.__routeMeta.push({ path, method, methodName, options })
      return target
    }

    // Legacy decorator - target is prototype, context is method name
    const methodName = context as string
    const constructor = target.constructor
    addRoute(constructor, { path, method, methodName, options })
    return target[methodName]
  }
}

/**
 * Method decorator that registers an HTTP GET route.
 * @param {string} [path=''] - The route path relative to the controller prefix
 * @param {RouteOptions} [options] - Route options (name, where constraints)
 * @returns {MethodDecorator} A method decorator
 *
 * @example
 * ```ts
 * @Get('/:id')
 * getUser() { ... }
 * ```
 */
export function Get(path: string = '', options?: RouteOptions) {
  return getMethodFunction('GET', path, options)
}

/**
 * Method decorator that registers an HTTP POST route.
 * @param {string} [path=''] - The route path relative to the controller prefix
 * @param {RouteOptions} [options] - Route options (name, where constraints)
 * @returns {MethodDecorator} A method decorator
 *
 * @example
 * ```ts
 * @Post('/')
 * createUser() { ... }
 * ```
 */
export function Post(path: string = '', options?: RouteOptions) {
  return getMethodFunction('POST', path, options)
}

/**
 * Method decorator that registers an HTTP PUT route.
 * @param {string} [path=''] - The route path relative to the controller prefix
 * @param {RouteOptions} [options] - Route options (name, where constraints)
 * @returns {MethodDecorator} A method decorator
 */
export function Put(path: string = '', options?: RouteOptions) {
  return getMethodFunction('PUT', path, options)
}

/**
 * Method decorator that registers an HTTP DELETE route.
 * @param {string} [path=''] - The route path relative to the controller prefix
 * @param {RouteOptions} [options] - Route options (name, where constraints)
 * @returns {MethodDecorator} A method decorator
 */
export function Delete(path: string = '', options?: RouteOptions) {
  return getMethodFunction('DELETE', path, options)
}

/**
 * Method decorator that registers an HTTP PATCH route.
 * @param {string} [path=''] - The route path relative to the controller prefix
 * @param {RouteOptions} [options] - Route options (name, where constraints)
 * @returns {MethodDecorator} A method decorator
 */
export function Patch(path: string = '', options?: RouteOptions) {
  return getMethodFunction('PATCH', path, options)
}

/**
 * Method decorator that registers an HTTP HEAD route.
 * @param {string} [path=''] - The route path relative to the controller prefix
 * @param {RouteOptions} [options] - Route options (name, where constraints)
 * @returns {MethodDecorator} A method decorator
 */
export function Head(path: string = '', options?: RouteOptions) {
  return getMethodFunction('HEAD', path, options)
}

/**
 * Method decorator that registers an HTTP OPTIONS route.
 * @param {string} [path=''] - The route path relative to the controller prefix
 * @param {RouteOptions} [options] - Route options (name, where constraints)
 * @returns {MethodDecorator} A method decorator
 */
export function Options(path: string = '', options?: RouteOptions) {
  return getMethodFunction('OPTIONS', path, options)
}

/**
 * Method decorator that registers a WebSocket route.
 * @param {string} [path=''] - The route path relative to the controller prefix
 * @returns {MethodDecorator} A method decorator
 */
export function Websocket(path: string = '') {
  return getMethodFunction('WS', path)
}
