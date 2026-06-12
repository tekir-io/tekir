export interface ValidateOptions {
  body?: any
  params?: any
  query?: any
  headers?: any
}

export type ValidateMiddleware = (ctx: any, next: () => Promise<void>) => Promise<void>
