export interface TestResponse {
  status: number
  headers: Headers
  body: any
  text: string
  ok: boolean
  /** The raw `Response` object — useful for streaming endpoints. */
  raw: Response

  assertStatus(code: number): TestResponse
  assertOk(): TestResponse
  assertCreated(): TestResponse
  assertNotFound(): TestResponse
  assertUnauthorized(): TestResponse
  assertForbidden(): TestResponse
  assertUnprocessable(): TestResponse
  assertRedirect(to?: string): TestResponse
  assertJson(expected: Record<string, unknown>): TestResponse
  assertJsonContains(subset: Record<string, unknown>): TestResponse
  assertJsonPath(path: string, value: unknown): TestResponse
  assertHeader(name: string, value?: string): TestResponse
  assertHeaderMissing(name: string): TestResponse
  assertCookie(name: string, value?: string): TestResponse
  assertBodyContains(text: string): TestResponse
  /**
   * Assert a subset of an `HttpException` payload, transparently unwrapping
   * tekir's `{ error: { ... } }` envelope so tests can write
   * `assertError({ message: '...', statusCode: 401 })` regardless of the
   * outer shape.
   */
  assertError(expected: Record<string, unknown>): TestResponse
}

export interface RequestOptions {
  headers?: Record<string, string>
  body?: unknown
  query?: Record<string, string>
  cookie?: string
  /**
   * Skip waiting for the response body to flush. Set this on requests that
   * return an open stream (SSE, long-polling, file downloads) so assertions
   * on the status/headers don't hang until the stream closes. The `text` and
   * `body` fields will be empty; pull from `raw.body` if you need to read.
   */
  stream?: boolean
}

export interface TestAppOptions {
  appRoot?: string
  port?: number
  config?: Record<string, any>
  /**
   * Auto-run pending migrations from `<appRoot>/database/migrations` after
   * boot. Defaults to `true` when the directory exists. Pass `false` to skip.
   * Requires `@tekir/db` to be installed.
   */
  migrate?: boolean
  /**
   * When the loaded `database` config uses sqlite, force it to `:memory:` for
   * fully isolated tests. Defaults to `true`. Pass `false` to keep the
   * original config (e.g. when the app already targets a separate test file).
   */
  inMemoryDb?: boolean
  /**
   * Path to the env file (relative to `appRoot`). Defaults to `'env.ts'`
   * when the file exists; pass `false` to skip.
   */
  envFile?: string | false
  /**
   * Directory of config files (relative to `appRoot`). Defaults to
   * `'config'` when the directory exists; pass `false` to skip.
   */
  configDir?: string | false
  /**
   * Directory containing `kernel`, `routes`, `boot`, `commands` files
   * (relative to `appRoot`). Defaults to `'start'` when the directory
   * exists; pass `false` to skip.
   */
  startDir?: string | false
}
