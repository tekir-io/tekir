import type { RedisConfig } from './types'
import { Redis } from './redis'

/**
 * Manages multiple named Redis connections with lazy initialization.
 *
 * Provides proxy methods that delegate to the default connection for convenience,
 * while also allowing access to any named connection via {@link RedisManager.connection}.
 *
 * @example
 * ```ts
 * const manager = new RedisManager({
 *   default: 'cache',
 *   connections: {
 *     cache: { url: 'redis://localhost:6379/0' },
 *     session: { url: 'redis://localhost:6379/1' },
 *   },
 * })
 * await manager.set('key', 'value')               // uses 'cache'
 * await manager.connection('session').set('k', 'v') // uses 'session'
 * ```
 */
export class RedisManager {
  private _connections = new Map<string, Redis>()
  private _defaultName: string
  private _config: RedisConfig

  /**
   * Create a new RedisManager.
   *
   * @param config - Redis configuration with optional named connections.
   */
  constructor(config: RedisConfig = {}) {
    this._config = config
    this._defaultName = config.default || 'default'

    // If no connections map, treat the whole config as a single connection
    if (!config.connections) {
      this._connections.set(this._defaultName, new Redis(config))
    }
  }

  /**
   * Get a named Redis connection. The connection is lazy-initialized on first access.
   *
   * @param name - The connection name. Defaults to the configured default connection.
   * @returns The {@link Redis} instance for the named connection.
   * @throws If the named connection is not configured.
   *
   * @example
   * ```ts
   * const cache = manager.connection('cache')
   * await cache.get('key')
   * ```
   */
  connection(name?: string): Redis {
    const connName = name || this._defaultName
    if (!this._connections.has(connName)) {
      const connConfig = this._config.connections?.[connName]
      if (!connConfig) {
        throw new Error(
          `[@tekir/redis] Connection "${connName}" is not configured. ` +
          `Available: ${this.connectionNames.join(', ')}`
        )
      }
      this._connections.set(connName, new Redis(connConfig))
    }
    return this._connections.get(connName)!
  }

  /**
   * List all configured connection names.
   *
   * @returns An array of connection name strings.
   *
   * @example
   * ```ts
   * manager.connectionNames // ['cache', 'session']
   * ```
   */
  get connectionNames(): string[] {
    if (this._config.connections) return Object.keys(this._config.connections)
    return [this._defaultName]
  }

  /**
   * Close a specific named connection, or all connections if no name is given.
   *
   * @param name - The connection name to close. Omit to close all connections.
   *
   * @example
   * ```ts
   * manager.close('session') // close one connection
   * manager.close()          // close all connections
   * ```
   */
  close(name?: string): void {
    if (name) {
      this._connections.get(name)?.close()
      this._connections.delete(name)
    } else {
      for (const [, conn] of this._connections) conn.close()
      this._connections.clear()
    }
  }

  // ─── Proxy methods delegating to the default connection ───

  /** @see {@link Redis.get} */
  get(key: string) { return this.connection().get(key) }
  /** @see {@link Redis.set} */
  set(key: string, value: string | number) { return this.connection().set(key, value) }
  /** @see {@link Redis.del} */
  del(...keys: string[]) { return this.connection().del(...keys) }
  /** @see {@link Redis.exists} */
  exists(key: string) { return this.connection().exists(key) }
  /** @see {@link Redis.incr} */
  incr(key: string) { return this.connection().incr(key) }
  /** @see {@link Redis.decr} */
  decr(key: string) { return this.connection().decr(key) }
  /** @see {@link Redis.expire} */
  expire(key: string, seconds: number) { return this.connection().expire(key, seconds) }
  /** @see {@link Redis.ttl} */
  ttl(key: string) { return this.connection().ttl(key) }
  /** @see {@link Redis.hget} */
  hget(key: string, field: string) { return this.connection().hget(key, field) }
  /** @see {@link Redis.hmset} */
  hmset(key: string, fields: string[]) { return this.connection().hmset(key, fields) }
  /** @see {@link Redis.hmget} */
  hmget(key: string, fields: string[]) { return this.connection().hmget(key, fields) }
  /** @see {@link Redis.hincrby} */
  hincrby(key: string, field: string, increment: number) { return this.connection().hincrby(key, field, increment) }
  /** @see {@link Redis.sadd} */
  sadd(key: string, ...members: string[]) { return this.connection().sadd(key, ...members) }
  /** @see {@link Redis.srem} */
  srem(key: string, ...members: string[]) { return this.connection().srem(key, ...members) }
  /** @see {@link Redis.sismember} */
  sismember(key: string, member: string) { return this.connection().sismember(key, member) }
  /** @see {@link Redis.smembers} */
  smembers(key: string) { return this.connection().smembers(key) }
  /** @see {@link Redis.publish} */
  publish(channel: string, message: string) { return this.connection().publish(channel, message) }
  /** @see {@link Redis.subscribe} */
  subscribe(channel: string, callback: (message: string, channel: string) => void) { return this.connection().subscribe(channel, callback) }
  /** @see {@link Redis.unsubscribe} */
  unsubscribe(channel?: string) { return this.connection().unsubscribe(channel) }
  /** @see {@link Redis.send} */
  send(command: string, args: string[] = []) { return this.connection().send(command, args) }
  /** @see {@link Redis.getJSON} */
  getJSON<T = any>(key: string) { return this.connection().getJSON<T>(key) }
  /** @see {@link Redis.setJSON} */
  setJSON(key: string, value: any, expireSeconds?: number) { return this.connection().setJSON(key, value, expireSeconds) }
  /** @see {@link Redis.remember} */
  remember<T>(key: string, seconds: number, callback: () => Promise<T>) { return this.connection().remember<T>(key, seconds, callback) }
  /** @see {@link Redis.clearPrefix} */
  clearPrefix() { return this.connection().clearPrefix() }
  /** @see {@link Redis.flushdb} */
  flushdb() { return this.connection().flushdb() }
  /** @see {@link Redis.connected} */
  get connected() { return this.connection().connected }
  /** @see {@link Redis.getClient} */
  getClient() { return this.connection().getClient() }
}
