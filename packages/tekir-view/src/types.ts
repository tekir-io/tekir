/**
 * Interface that all view engines must implement.
 * A view engine can render templates to HTML strings and optionally to readable streams.
 *
 * @remarks
 * Security contract: `render`/`renderStream` MUST return HTML that is already
 * escaped against the props they were given. `View` writes the engine output
 * to the response body verbatim with `Content-Type: text/html`, so any
 * unescaped, attacker-controlled value the engine emits becomes XSS. The
 * default React engine satisfies this via JSX auto-escaping; a custom or
 * string-concatenation engine is responsible for escaping its own output.
 */
export interface ViewEngine {
  /**
   * Render a template to an HTML string.
   * @param template - The template component or identifier.
   * @param props - Data to pass to the template.
   * @returns The rendered HTML string (may be async).
   */
  render(template: any, props?: any): Promise<string> | string
  /**
   * Render a template to a readable stream for chunked transfer.
   * @param template - The template component or identifier.
   * @param props - Data to pass to the template.
   * @returns A ReadableStream of HTML chunks.
   */
  renderStream?(template: any, props?: any): Promise<ReadableStream>
}

/** Options for customizing the HTTP response returned by {@link View.render}. */
export interface RenderOptions {
  /** Whether to use streaming if available (default: `true`). */
  stream?: boolean
  /** HTTP status code (default: `200`). */
  status?: number
  /** Additional HTTP headers to include in the response. */
  headers?: Record<string, string>
}

/** Configuration for the view service. */
export interface ViewConfig {
  /** The view engine implementation to use. */
  engine: ViewEngine
  /** Absolute path to the views directory. */
  dir?: string
}
