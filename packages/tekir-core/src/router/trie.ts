import type { MiddlewareFunction, RouteHandler } from '../http/types'

export interface RouteNode {
  children: Map<string, RouteNode>
  paramChild?: { node: RouteNode; paramName: string }
  wildcardChild?: { node: RouteNode }
  handlers: Map<string, RegisteredRoute>
}

export interface RegisteredRoute {
  handler: RouteHandler
  originalHandler?: RouteHandler
  middlewares: MiddlewareFunction[]
  pattern: string
  name?: string
  paramNames: string[]
  meta: Record<string, unknown>
}

export interface MatchResult {
  route: RegisteredRoute
  params: Record<string, string>
}

function createNode(): RouteNode {
  return {
    children: new Map(),
    handlers: new Map(),
  }
}

// Decode a path segment without throwing on malformed `%` escapes (e.g.
// `/%E0%A4%A`). A bare `decodeURIComponent` raises `URIError` very early in
// the request lifecycle, surfacing as an uncaught 500; falling back to the raw
// segment keeps matching deterministic.
function safeDecodeURIComponent(segment: string): string {
  try { return decodeURIComponent(segment) } catch { return segment }
}

export class RouteTrie {
  root = createNode()
  namedRoutes = new Map<string, { pattern: string; paramNames: string[] }>()

  add(
    method: string,
    path: string,
    handler: RouteHandler,
    middlewares: MiddlewareFunction[] = [],
    name?: string,
    meta: Record<string, unknown> = {}
  ): void {
    let normalizedPath = path === '' ? '/' : path.startsWith('/') ? path : `/${path}`
    // Strip trailing slash (except root)
    if (normalizedPath.length > 1 && normalizedPath.endsWith('/')) {
      normalizedPath = normalizedPath.slice(0, -1)
    }
    const segments = normalizedPath === '/' ? [] : normalizedPath.slice(1).split('/')
    const paramNames: string[] = []
    let node = this.root

    for (const segment of segments) {
      if (segment.startsWith(':')) {
        const paramName = segment.endsWith('?') ? segment.slice(1, -1) : segment.slice(1)
        paramNames.push(paramName)

        if (!node.paramChild) {
          node.paramChild = { node: createNode(), paramName }
        }
        node.paramChild.paramName = paramName
        node = node.paramChild.node

        // If optional param, also register handler on parent
        if (segment.endsWith('?')) {
          node.handlers.set(method, {
            handler,
            middlewares,
            pattern: normalizedPath,
            name,
            paramNames: [...paramNames],
            meta,
          })
        }
      } else if (segment === '*') {
        if (!node.wildcardChild) {
          node.wildcardChild = { node: createNode() }
        }
        node = node.wildcardChild.node
        paramNames.push('*')
      } else {
        if (!node.children.has(segment)) {
          node.children.set(segment, createNode())
        }
        node = node.children.get(segment) as RouteNode
      }
    }

    const route: RegisteredRoute = {
      handler,
      middlewares,
      pattern: normalizedPath,
      name,
      paramNames,
      meta,
    }

    node.handlers.set(method, route)

    if (name) {
      this.namedRoutes.set(name, { pattern: normalizedPath, paramNames })
    }
  }

  match(method: string, path: string): MatchResult | null {
    let normalizedPath = path === '' ? '/' : path
    if (normalizedPath.length > 1 && normalizedPath.endsWith('/')) {
      normalizedPath = normalizedPath.slice(0, -1)
    }
    const segments = normalizedPath === '/' ? [] : normalizedPath.slice(1).split('/')
    const params: Record<string, string> = {}

    const result = this._match(this.root, segments, 0, method, params)
    return result
  }

  private _match(
    node: RouteNode,
    segments: string[],
    index: number,
    method: string,
    params: Record<string, string>
  ): MatchResult | null {
    // Reached end of segments
    if (index === segments.length) {
      const route = node.handlers.get(method) || node.handlers.get('ANY')
      if (route) {
        return { route, params: { ...params } }
      }
      return null
    }

    const segment = segments[index]

    // 1. Try exact match first (static routes are fastest)
    if (node.children.has(segment)) {
      const result = this._match(node.children.get(segment) as RouteNode, segments, index + 1, method, params)
      if (result) return result
    }

    // 2. Try parameter match
    if (node.paramChild) {
      params[node.paramChild.paramName] = safeDecodeURIComponent(segment)
      const result = this._match(node.paramChild.node, segments, index + 1, method, params)
      if (result) return result
      delete params[node.paramChild.paramName]
    }

    // 3. Try wildcard match
    if (node.wildcardChild) {
      params['*'] = segments.slice(index).map(safeDecodeURIComponent).join('/')
      const route =
        node.wildcardChild.node.handlers.get(method) || node.wildcardChild.node.handlers.get('ANY')
      if (route) {
        return { route, params: { ...params } }
      }
      delete params['*']
    }

    return null
  }

  makeUrl(name: string, params: Record<string, string> = {}, qs?: Record<string, string>): string {
    const route = this.namedRoutes.get(name)
    if (!route) throw new Error(`Route "${name}" not found`)

    // Substitute per-segment so repeated params all fill, `:id` never partially
    // matches `:id?`, and a missing required param fails loudly instead of
    // leaving a literal `:param` in the URL.
    const segments = route.pattern === '/' ? [] : route.pattern.slice(1).split('/')
    const out: string[] = []
    for (const seg of segments) {
      if (seg.startsWith(':')) {
        const optional = seg.endsWith('?')
        const key = optional ? seg.slice(1, -1) : seg.slice(1)
        const value = params[key]
        if (value === undefined || value === null) {
          if (optional) continue
          throw new Error(`makeUrl("${name}"): missing required param "${key}"`)
        }
        out.push(encodeURIComponent(value))
      } else {
        out.push(seg)
      }
    }
    let url = '/' + out.join('/')

    if (qs && Object.keys(qs).length > 0) {
      const search = new URLSearchParams(qs).toString()
      url += `?${search}`
    }

    return url
  }
}
