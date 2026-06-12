/**
 * Self-contained TypeScript types for the test runner surface tekir
 * re-exports. Both Bun's `bun:test` and Vitest implement a Jest-compatible
 * API, so these types describe the shared shape and let consumers get
 * full autocomplete without depending on `@types/bun` or `vitest`'s types.
 */

// ── test / describe ─────────────────────────────────────────────────────

export type TestCallback = (
  done?: (err?: unknown) => void,
) => void | Promise<unknown> | unknown

export interface TestModifier {
  (name: string, fn: TestCallback, timeout?: number): void
  skip: (name: string, fn: TestCallback, timeout?: number) => void
  only: (name: string, fn: TestCallback, timeout?: number) => void
  todo: (name: string, fn?: TestCallback, timeout?: number) => void
  failing: (name: string, fn: TestCallback, timeout?: number) => void
  concurrent: (name: string, fn: TestCallback, timeout?: number) => void
  sequential: (name: string, fn: TestCallback, timeout?: number) => void
  each: <T>(table: readonly T[]) => (
    name: string,
    fn: (row: T) => void | Promise<unknown>,
    timeout?: number,
  ) => void
}

export interface TestFn {
  (name: string, fn: TestCallback, timeout?: number): void

  skip: TestModifier
  only: TestModifier
  todo: (name: string, fn?: TestCallback, timeout?: number) => void
  failing: TestModifier
  concurrent: TestModifier
  sequential: TestModifier

  skipIf: (condition: unknown) => TestModifier
  todoIf: (condition: unknown) => TestModifier
  runIf: (condition: unknown) => TestModifier
  if: (condition: unknown) => TestModifier

  each: <T>(table: readonly T[]) => (
    name: string,
    fn: (row: T) => void | Promise<unknown>,
    timeout?: number,
  ) => void
}

export interface DescribeFn {
  (name: string, fn: () => void): void

  skip: (name: string, fn: () => void) => void
  only: (name: string, fn: () => void) => void
  todo: (name: string, fn?: () => void) => void
  concurrent: (name: string, fn: () => void) => void
  sequential: (name: string, fn: () => void) => void

  skipIf: (condition: unknown) => (name: string, fn: () => void) => void
  todoIf: (condition: unknown) => (name: string, fn: () => void) => void
  runIf: (condition: unknown) => (name: string, fn: () => void) => void
  if: (condition: unknown) => (name: string, fn: () => void) => void

  each: <T>(table: readonly T[]) => (name: string, fn: (row: T) => void) => void
}

// ── lifecycle ───────────────────────────────────────────────────────────

export type LifecycleFn = (
  fn: (done?: (err?: unknown) => void) => void | Promise<unknown>,
  timeout?: number,
) => void

// ── expect / matchers ───────────────────────────────────────────────────

export interface AsymmetricMatchers {
  any(constructor: unknown): unknown
  anything(): unknown
  arrayContaining<T>(items: readonly T[]): unknown
  objectContaining<T extends object>(obj: Partial<T>): unknown
  stringContaining(substring: string): unknown
  stringMatching(pattern: string | RegExp): unknown
  closeTo(expected: number, precision?: number): unknown
}

export interface ExpectStatic extends AsymmetricMatchers {
  <T = unknown>(actual: T): Matchers<T>
  /** Vitest soft mode — assertion failures continue rather than aborting the test. */
  soft<T = unknown>(actual: T): Matchers<T>
  /** Vitest polling — re-evaluates the matcher until it passes or times out. */
  poll<T = unknown>(getter: () => T | Promise<T>, options?: { interval?: number; timeout?: number }): Matchers<T>

  /** Mark that exactly N assertions should run before the test ends. */
  assertions(count: number): void
  /** Mark that at least one assertion should run. */
  hasAssertions(): void
  /** Extend the matcher set globally. */
  extend(matchers: Record<string, (...args: unknown[]) => unknown>): void
  /** Always-fail helper, useful in unreachable branches. */
  unreachable(message?: string): never
  /** Vitest equivalent of `unreachable`. */
  fail(message?: string): never
  /** Add custom equality testers (Vitest). */
  addEqualityTesters?(testers: Array<(...args: unknown[]) => boolean | undefined>): void
  /** Add a snapshot serializer (Vitest). */
  addSnapshotSerializer?(serializer: unknown): void
  /** Read internal expect state (Vitest/Jest). */
  getState?(): Record<string, unknown>
  /** Mutate internal expect state (Vitest/Jest). */
  setState?(state: Record<string, unknown>): void
}

export interface Matchers<T> {
  // Negation / async
  not: Matchers<T>
  resolves: Matchers<Awaited<T>>
  rejects: Matchers<unknown>

  // Equality
  toBe(expected: T): void
  toEqual(expected: unknown): void
  toStrictEqual(expected: unknown): void

  // Truthiness
  toBeTruthy(): void
  toBeFalsy(): void
  toBeNull(): void
  toBeUndefined(): void
  toBeDefined(): void
  toBeNaN(): void
  toBeTrue(): void
  toBeFalse(): void

  // Numeric
  toBeGreaterThan(expected: number | bigint): void
  toBeGreaterThanOrEqual(expected: number | bigint): void
  toBeLessThan(expected: number | bigint): void
  toBeLessThanOrEqual(expected: number | bigint): void
  toBeCloseTo(expected: number, numDigits?: number): void
  toBeFinite(): void
  toBeInteger(): void
  toBeFloat(): void
  toBePositive(): void
  toBeNegative(): void
  toBeEvenNumber(): void
  toBeOddNumber(): void
  toBeWithin(start: number, end: number): void

  // Type checks
  toBeBoolean(): void
  toBeNumber(): void
  toBeString(): void
  toBeArray(): void
  toBeObject(): void
  toBeFunction(): void
  toBeDate(): void
  toBeValidDate(): void
  toBeSymbol(): void
  toBeBigInt(): void
  toBeTypeOf(expected: 'string' | 'number' | 'bigint' | 'boolean' | 'symbol' | 'undefined' | 'object' | 'function'): void
  toBeInstanceOf(expected: new (...args: unknown[]) => unknown): void

  // Strings
  toMatch(expected: string | RegExp): void
  toStartWith(expected: string): void
  toEndWith(expected: string): void
  toInclude(expected: string): void
  toEqualIgnoringWhitespace(expected: string): void

  // Containers
  toContain(expected: unknown): void
  toContainEqual(expected: unknown): void
  toContainKey(key: PropertyKey): void
  toContainKeys(keys: readonly PropertyKey[]): void
  toContainAllKeys(keys: readonly PropertyKey[]): void
  toContainAnyKeys(keys: readonly PropertyKey[]): void
  toContainValue(value: unknown): void
  toContainValues(values: readonly unknown[]): void
  toContainAllValues(values: readonly unknown[]): void
  toContainAnyValues(values: readonly unknown[]): void
  toIncludeSameMembers(members: readonly unknown[]): void
  toIncludeAllMembers(members: readonly unknown[]): void
  toIncludeAnyMembers(members: readonly unknown[]): void
  toBeIn(container: unknown): void
  toBeOneOf(values: readonly unknown[]): void
  toBeEmpty(): void
  toBeEmptyObject(): void
  toHaveLength(length: number): void
  toHaveProperty(path: string | readonly string[], value?: unknown): void
  toMatchObject(expected: object): void

  // Errors
  toThrow(expected?: string | RegExp | Error | (new (...args: unknown[]) => Error)): void
  toThrowError(expected?: string | RegExp | Error | (new (...args: unknown[]) => Error)): void

  // Mock-related
  toHaveBeenCalled(): void
  toHaveBeenCalledTimes(count: number): void
  toHaveBeenCalledWith(...args: unknown[]): void
  toHaveBeenLastCalledWith(...args: unknown[]): void
  toHaveBeenNthCalledWith(n: number, ...args: unknown[]): void
  toHaveReturned(): void
  toHaveReturnedTimes(count: number): void
  toHaveReturnedWith(value: unknown): void
  toHaveLastReturnedWith(value: unknown): void
  toHaveNthReturnedWith(n: number, value: unknown): void

  // Snapshot
  toMatchSnapshot(name?: string): void
  toMatchInlineSnapshot(snapshot?: string): void
  toThrowErrorMatchingSnapshot(name?: string): void
  toThrowErrorMatchingInlineSnapshot(snapshot?: string): void
}

// ── mock / spyOn ────────────────────────────────────────────────────────

export interface MockResult<TReturn = unknown> {
  type: 'return' | 'throw' | 'incomplete'
  value: TReturn | unknown
}

export interface MockState<TArgs extends readonly unknown[] = readonly unknown[], TReturn = unknown> {
  calls: TArgs[]
  results: MockResult<TReturn>[]
  instances: unknown[]
  contexts: unknown[]
  lastCall?: TArgs
}

export interface MockedFunction<TArgs extends readonly unknown[] = readonly unknown[], TReturn = unknown> {
  (...args: TArgs): TReturn
  mock: MockState<TArgs, TReturn>
  mockClear(): MockedFunction<TArgs, TReturn>
  mockReset(): MockedFunction<TArgs, TReturn>
  mockRestore(): void
  mockImplementation(fn: (...args: TArgs) => TReturn): MockedFunction<TArgs, TReturn>
  mockImplementationOnce(fn: (...args: TArgs) => TReturn): MockedFunction<TArgs, TReturn>
  mockReturnThis(): MockedFunction<TArgs, TReturn>
  mockReturnValue(value: TReturn): MockedFunction<TArgs, TReturn>
  mockReturnValueOnce(value: TReturn): MockedFunction<TArgs, TReturn>
  mockResolvedValue(value: Awaited<TReturn>): MockedFunction<TArgs, TReturn>
  mockResolvedValueOnce(value: Awaited<TReturn>): MockedFunction<TArgs, TReturn>
  mockRejectedValue(reason: unknown): MockedFunction<TArgs, TReturn>
  mockRejectedValueOnce(reason: unknown): MockedFunction<TArgs, TReturn>
  mockName(name: string): MockedFunction<TArgs, TReturn>
  getMockName(): string
  withImplementation(
    fn: (...args: TArgs) => TReturn,
    callback: () => void | Promise<unknown>,
  ): MockedFunction<TArgs, TReturn>
}

export interface MockFn {
  <TArgs extends readonly unknown[] = readonly unknown[], TReturn = unknown>(
    fn?: (...args: TArgs) => TReturn,
  ): MockedFunction<TArgs, TReturn>
  /** Bun-only: replace a module's exports for the duration of the test. */
  module?(modulePath: string, factory: () => unknown): void
  /** Bun-only: clear all mocks created via `mock()`. */
  clearAllMocks?(): void
  /** Bun-only: restore all spied-upon methods. */
  restore?(): void
}

export interface SpyOnFn {
  <T extends object, K extends keyof T>(
    obj: T,
    method: K,
  ): T[K] extends (...args: infer A) => infer R
    ? MockedFunction<A, R>
    : MockedFunction
}

// ── jest / vi namespace ─────────────────────────────────────────────────

export interface JestNamespace {
  // Mock factories
  fn: MockFn
  spyOn: SpyOnFn

  // Module mocking
  mock(modulePath: string, factory?: () => unknown): void
  unmock(modulePath: string): void
  doMock(modulePath: string, factory?: () => unknown): void
  doUnmock(modulePath: string): void
  requireMock<T = unknown>(modulePath: string): T
  requireActual<T = unknown>(modulePath: string): T

  // Mock state management
  clearAllMocks(): void
  resetAllMocks(): void
  restoreAllMocks(): void

  // Timers
  useFakeTimers(): void
  useRealTimers(): void
  clearAllTimers(): void
  advanceTimersByTime(ms: number): void
  advanceTimersByTimeAsync(ms: number): Promise<void>
  advanceTimersToNextTimer(): void
  advanceTimersToNextTimerAsync(): Promise<void>
  runAllTimers(): void
  runAllTimersAsync(): Promise<void>
  runOnlyPendingTimers(): void
  runOnlyPendingTimersAsync(): Promise<void>
  runAllTicks(): void
  getTimerCount(): number

  // System time
  setSystemTime(date?: number | Date): void
  getRealSystemTime(): number

  // Vitest extras (no-op on Bun, available on Vitest)
  hoisted?<T>(factory: () => T): T
  importActual?<T = unknown>(modulePath: string): Promise<T>
  importMock?<T = unknown>(modulePath: string): Promise<T>
  stubGlobal?(name: string | symbol, value: unknown): void
  stubEnv?(name: string, value: string | undefined): void
  unstubAllGlobals?(): void
  unstubAllEnvs?(): void
  waitFor?<T>(callback: () => T | Promise<T>, options?: { interval?: number; timeout?: number }): Promise<T>
  waitUntil?<T>(callback: () => T | Promise<T>, options?: { interval?: number; timeout?: number }): Promise<T>
  dynamicImportSettled?(): Promise<void>

  /** Allow access to runner-specific extras not typed above. */
  [key: string]: unknown
}

// ── vitest-specific extras (no-op on Bun) ───────────────────────────────

export interface BenchFn {
  (name: string, fn: () => void | Promise<unknown>, options?: { time?: number; iterations?: number }): void
  skip: (name: string, fn: () => void | Promise<unknown>) => void
  only: (name: string, fn: () => void | Promise<unknown>) => void
  todo: (name: string) => void
}

export interface ExpectTypeOfMatchers<T> {
  toEqualTypeOf<U>(value?: U): void
  toMatchTypeOf<U>(value?: U): void
  toBeAny(): void
  toBeUnknown(): void
  toBeNever(): void
  toBeFunction(): void
  toBeObject(): void
  toBeArray(): void
  toBeString(): void
  toBeNumber(): void
  toBeBoolean(): void
  toBeNull(): void
  toBeUndefined(): void
  toBeNullable(): void
  not: ExpectTypeOfMatchers<T>
}

export interface ExpectTypeOfFn {
  <T>(value?: T): ExpectTypeOfMatchers<T>
}

// ── full runner shape ───────────────────────────────────────────────────

export interface TestRunner {
  test: TestFn
  /** `it` is a published alias for `test` in both Bun and Vitest. */
  it: TestFn
  describe: DescribeFn
  /** Vitest alias for `describe` (no-op on Bun). */
  suite?: DescribeFn
  expect: ExpectStatic
  beforeAll: LifecycleFn
  afterAll: LifecycleFn
  beforeEach: LifecycleFn
  afterEach: LifecycleFn
  mock: MockFn
  spyOn: SpyOnFn
  jest: JestNamespace
  /** Vitest-only benchmarking. Undefined on Bun. */
  bench?: BenchFn
  /** Vitest-only type-level assertions. Undefined on Bun. */
  expectTypeOf?: ExpectTypeOfFn
  /** Vitest-only — register a cleanup that runs after the current test ends. */
  onTestFinished?(fn: () => void | Promise<unknown>): void
  /** Vitest-only — register a callback that runs only when the test fails. */
  onTestFailed?(fn: (error: unknown) => void | Promise<unknown>): void
  /** Vitest-only — runtime assertion helpers (node:assert-style). */
  assert?: Record<string, (...args: unknown[]) => void>
  /** Vitest-only — type-only assertion helper. */
  assertType?<T>(value: T): void
}
