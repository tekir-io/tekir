import type { App } from '@tekir/core'
import { mongo } from './connection'

/**
 * Service provider that reads the `mongodb` (or `mongo`) configuration
 * and registers a connected {@link Mongo} instance in the application container.
 */
export class MongoProvider {
  /**
   * Register the MongoDB connection into the application container.
   *
   * @param app - The Tekir application instance.
   * @returns A promise that resolves once the connection is established and registered.
   */
  async register(app: App) {
    const config = app.use('config')
    const mongoConfig = config('mongodb') || config('mongo')
    if (!mongoConfig?.uri) return

    await mongo.connect(mongoConfig)
    app.instance('mongo', mongo)
  }

  /**
   * Gracefully disconnect from MongoDB when the application shuts down.
   *
   * @returns A promise that resolves once the connection is closed.
   */
  async shutdown() {
    await mongo.disconnect()
  }
}
