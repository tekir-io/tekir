import type { NextConfig as NextJsConfig } from 'next'

export interface NextConfig {
  dir?: string
  dev?: boolean
  turbopack?: boolean
  conf?: NextJsConfig
}
