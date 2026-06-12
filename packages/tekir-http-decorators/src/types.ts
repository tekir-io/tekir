export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS' | 'WS'

export interface ParamMatcher {
  match: RegExp
  cast?: (value: string) => any
}

export interface RouteMetadata {
  path: string
  method: HttpMethod
  methodName: string
  options?: RouteOptions
}

export interface RouteOptions {
  name?: string
  where?: Record<string, ParamMatcher>
}
