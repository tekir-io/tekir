import type { LogTransport } from './types'
import { Logger } from './logger'
import { ConsoleTransport } from './logger'
import { FileTransport } from './file_transport'

interface LoggerHostApp {
  use: (name: string) => any
  instance: (name: string, value: unknown) => void
}

const optionalImport = (name: string): Promise<any> => import(name)

/**
 * Service provider that reads the `logger` configuration and registers
 * a fully configured {@link Logger} instance in the application container.
 *
 * Supports the following channel drivers: `console`, `file`, `datadog`, `loki`, `pino`.
 */
export class LoggerProvider {
  /**
   * Register the logger service into the application container.
   * @param app - The Tekir application instance.
   */
  async register(app: LoggerHostApp) {
    const config = app.use('config')
    const loggerConfig = config('logger', {}) as Record<string, any>

    const transports: LogTransport[] = []
    const channelsConfig = loggerConfig.channels ?? {}

    for (const [name, channelConfig] of Object.entries(channelsConfig) as [string, any][]) {
      const driver = channelConfig?.driver ?? name

      if (driver === 'console') {
        transports.push(new ConsoleTransport(channelConfig?.pretty))

      } else if (driver === 'file') {
        if (!channelConfig?.path) {
          throw new Error(
            `[@tekir/logger] Channel "${name}" uses the file driver but no path is configured.`
          )
        }
        transports.push(new FileTransport({
          path: channelConfig.path,
          maxSize: channelConfig.maxSize,
          maxFiles: channelConfig.maxFiles,
          prefix: channelConfig.prefix,
          suffix: channelConfig.suffix,
          maxQueueSize: channelConfig.maxQueueSize,
          onError: channelConfig.onError,
        }))

      } else if (driver === 'datadog') {
        let DatadogTransport: any
        try {
          DatadogTransport = (await optionalImport('@tekir/logger-datadog')).DatadogTransport
        } catch {
          throw new Error(
            `[@tekir/logger] Channel "${name}" uses the datadog driver but @tekir/logger-datadog is not installed. ` +
            'Run: bun add @tekir/logger-datadog'
          )
        }
        transports.push(new DatadogTransport(channelConfig))

      } else if (driver === 'loki') {
        let LokiTransport: any
        try {
          LokiTransport = (await optionalImport('@tekir/logger-loki')).LokiTransport
        } catch {
          throw new Error(
            `[@tekir/logger] Channel "${name}" uses the loki driver but @tekir/logger-loki is not installed. ` +
            'Run: bun add @tekir/logger-loki'
          )
        }
        transports.push(new LokiTransport(channelConfig))

      } else if (driver === 'pino') {
        let PinoTransport: any
        try {
          PinoTransport = (await optionalImport('@tekir/logger-pino')).PinoTransport
        } catch {
          throw new Error(
            `[@tekir/logger] Channel "${name}" uses the pino driver but @tekir/logger-pino is not installed. ` +
            'Run: bun add @tekir/logger-pino'
          )
        }
        transports.push(new PinoTransport(channelConfig))

      } else {
        throw new Error(
          `[@tekir/logger] Unknown driver "${driver}" for channel "${name}". ` +
          'Supported drivers: console, file, datadog, loki, pino'
        )
      }
    }

    // Default to console if no channels configured
    if (transports.length === 0) {
      transports.push(new ConsoleTransport(loggerConfig.pretty))
    }

    const logger = new Logger({
      level: loggerConfig.level,
      enabled: loggerConfig.enabled,
      name: loggerConfig.name,
      timestamp: loggerConfig.timestamp,
      redact: loggerConfig.redact,
      transports,
    })

    app.instance('logger', logger)
  }
}
