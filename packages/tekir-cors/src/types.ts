export interface CorsConfig {
  enabled?: boolean
  origin?: boolean | string | string[] | ((origin: string) => boolean)
  methods?: string[]
  headers?: boolean | string[]
  exposeHeaders?: string[]
  credentials?: boolean
  maxAge?: number
}
