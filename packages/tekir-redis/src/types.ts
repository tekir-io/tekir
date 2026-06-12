/** Configuration for a single Redis connection. */
export interface RedisConnectionConfig {
  /** Redis connection URL (default: `'redis://localhost:6379'`). */
  url?: string
  /** Key prefix applied to all operations (e.g. `'myapp:'`). */
  prefix?: string
  /** Connection timeout in milliseconds. */
  connectionTimeout?: number
  /** Idle timeout in milliseconds before the connection is closed. */
  idleTimeout?: number
  /** Whether to automatically reconnect on connection loss (default: `true`). */
  autoReconnect?: boolean
  /** Maximum number of reconnection attempts (default: `10`). */
  maxRetries?: number
  /** Enable automatic pipelining for improved throughput (default: `true`). */
  enableAutoPipelining?: boolean
  /** Enable TLS, or provide a TLS options object. */
  tls?: boolean | object
}

/**
 * Redis configuration supporting both single-connection and multi-connection setups.
 *
 * For a single connection, specify the connection fields directly.
 * For multiple connections, use the `connections` map and optionally set `default`.
 */
export type RedisConfig = RedisConnectionConfig & {
  /** Name of the default connection (default: `'default'`). */
  default?: string
  /** Named connection configurations. */
  connections?: Record<string, RedisConnectionConfig>
}
