export interface ListenerMetadata {
  event: string
  method: string
  once: boolean
}

/** A single @On/@Once binding stamped on a method function. */
export interface EventBinding {
  event: string
  once: boolean
}
