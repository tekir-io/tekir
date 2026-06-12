/** Minimal subset of a pino logger this transport relies on: one method per level. */
export interface PinoLike {
  trace(obj: unknown, msg?: string): void
  debug(obj: unknown, msg?: string): void
  info(obj: unknown, msg?: string): void
  warn(obj: unknown, msg?: string): void
  error(obj: unknown, msg?: string): void
  fatal(obj: unknown, msg?: string): void
  [key: string]: unknown
}

export interface PinoTransportConfig {
  pino: PinoLike
}
