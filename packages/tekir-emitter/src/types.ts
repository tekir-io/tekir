export type Handler<T = unknown> = (data: T) => void | Promise<void>
