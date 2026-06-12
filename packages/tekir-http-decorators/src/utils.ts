/**
 * Check if a decorator context is a TC39 (stage 3) decorator.
 * @param {any} context - The decorator context argument
 * @returns {boolean} True if the context is a TC39 decorator context object
 */
export function isTC39Decorator(context: any): boolean {
  return context && typeof context === 'object' && 'kind' in context
}

/**
 * Get or initialize an array property on the target object.
 * @param {any} target - The target object
 * @param {string} key - The property key
 * @returns {any[]} The existing or newly created array
 */
export function getOrInitArray(target: any, key: string): any[] {
  if (!target[key]) {
    target[key] = []
  }
  return target[key]
}

/**
 * Get or initialize an object (map) property on the target object.
 * @param {any} target - The target object
 * @param {string} key - The property key
 * @returns {Record<string, any>} The existing or newly created object
 */
export function getOrInitMap(target: any, key: string): Record<string, any> {
  if (!target[key]) {
    target[key] = {}
  }
  return target[key]
}

export type { HttpMethod, ParamMatcher, RouteMetadata, RouteOptions } from './types'
