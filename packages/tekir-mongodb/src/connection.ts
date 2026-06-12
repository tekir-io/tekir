
import type { MongoConfig } from './types'

let _mongoose: any = null

/**
 * Lazily load and cache the `mongoose` module.
 *
 * @returns The mongoose module instance.
 * @throws If `mongoose` is not installed.
 *
 * @example
 * ```ts
 * const mongoose = loadMongoose()
 * const { Schema } = mongoose
 * ```
 */
export function loadMongoose() {
  if (_mongoose) return _mongoose
  try {
    _mongoose = require('mongoose')
    return _mongoose
  } catch {
    throw new Error('MongoDB requires: bun add mongoose')
  }
}

/**
 * Wrapper around a Mongoose connection that manages a single MongoDB connection.
 *
 * @example
 * ```ts
 * const db = new Mongo()
 * await db.connect({ uri: 'mongodb://localhost:27017/mydb' })
 * const conn = db.connection // use for model registration
 * await db.disconnect()
 * ```
 */
export class Mongo {
  private _connection: any = null

  /**
   * Establish a connection to MongoDB using the provided configuration.
   * If already connected, returns immediately.
   *
   * @param config - MongoDB connection configuration including URI and options.
   * @returns A promise resolving to `this` for chaining.
   *
   * @example
   * ```ts
   * await mongo.connect({ uri: 'mongodb://localhost:27017/mydb', debug: true })
   * ```
   */
  async connect(config: MongoConfig): Promise<this> {
    if (this._connection && this._connection.readyState === 1) return this

    const mongoose = loadMongoose()
    // Debug logs every query (including filter values) — default off, opt-in only.
    mongoose.set('debug', config.debug === true)

    // Apply sensible pool/timeout defaults so a lost connection fails fast
    // instead of hanging requests; callers can override via config.options.
    const options = {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      ...(config.options || {}),
    }

    this._connection = mongoose.createConnection(config.uri, options)
    // Surface connection errors instead of letting them become unhandled rejections.
    this._connection.on('error', (err: unknown) => {
      this._connection?.emit?.('tekir:error', err)
    })
    await this._connection.asPromise()
    return this
  }

  /**
   * Get the active Mongoose connection instance.
   *
   * @returns The underlying Mongoose connection.
   * @throws If no connection has been established yet.
   */
  get connection(): any {
    if (!this._connection || this._connection.readyState !== 1) {
      throw new Error('MongoDB not connected. Call connect() first or use MongoProvider.')
    }
    return this._connection
  }

  /**
   * Get the mongoose module instance.
   *
   * @returns The cached mongoose module.
   */
  get mongoose() {
    return loadMongoose()
  }

  /**
   * Close the MongoDB connection and release resources.
   *
   * @returns A promise that resolves once the connection is closed.
   */
  async disconnect(): Promise<void> {
    if (this._connection) {
      await this._connection.close()
      this._connection = null
    }
  }
}

/** Default singleton Mongo instance shared across the application. */
export const mongo = new Mongo()
