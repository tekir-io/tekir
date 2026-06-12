// @tekir/testing — test utilities for tekir apps.
//
// Re-exports the active test runner so the same import works on both Bun
// and Node:
//   - Bun  → `bun:test` (built-in, zero install)
//   - Node → `vitest`   (peer dependency: `bun add -d vitest`)
//
// The exported names mirror Bun's surface (`test`, `describe`, `expect`,
// `beforeAll`/`afterAll`/`beforeEach`/`afterEach`, `mock`, `spyOn`, `jest`)
// and are mapped onto vitest's `vi.*` equivalents on Node so handler code
// stays identical across runtimes. Types come from `./runner-types` so
// consumers get full autocomplete without depending on either runtime's
// type packages.

export type { TestResponse, RequestOptions } from './client'
export type { TestAppOptions } from './app'
export { client } from './client'
export { createTestApp } from './app'
export { defineFactory } from './factory'
export { fakeTime, assertThrows, assertNotThrows } from './helpers'
export { setupTestDb } from './database'

import type {
  TestRunner,
  TestFn,
  DescribeFn,
  ExpectStatic,
  LifecycleFn,
  MockFn,
  SpyOnFn,
  JestNamespace,
  BenchFn,
  ExpectTypeOfFn,
} from './runner-types'

export type {
  TestRunner,
  TestFn,
  TestModifier,
  TestCallback,
  DescribeFn,
  ExpectStatic,
  AsymmetricMatchers,
  Matchers,
  LifecycleFn,
  MockFn,
  MockedFunction,
  MockedFunction as Mocked,
  MockState,
  MockResult,
  SpyOnFn,
  JestNamespace,
  BenchFn,
  ExpectTypeOfFn,
} from './runner-types'

const isBun = typeof (globalThis as any).Bun !== 'undefined'

async function loadRunner(): Promise<TestRunner> {
  if (isBun) {
    // String cast keeps TS off the module resolver — `bun:test` is a Bun
    // built-in and may not exist in a consumer's typing setup.
    const mod: any = await import('bun:test' as string)
    return {
      test: mod.test,
      it: mod.it ?? mod.test,
      describe: mod.describe,
      suite: mod.suite ?? mod.describe,
      expect: mod.expect,
      beforeAll: mod.beforeAll,
      afterAll: mod.afterAll,
      beforeEach: mod.beforeEach,
      afterEach: mod.afterEach,
      mock: mod.mock,
      spyOn: mod.spyOn,
      jest: mod.jest,
    }
  }

  // Node — vitest is the supported runner. Lazy-loaded so apps that don't
  // run tests on Node never need to install it.
  let mod: any
  try {
    mod = await import('vitest' as string)
  } catch {
    throw new Error(
      "@tekir/testing requires `vitest` when running on Node. " +
      "Install it with `bun add -d vitest` (or your package manager's equivalent).",
    )
  }
  return {
    test: mod.test,
    it: mod.it ?? mod.test,
    describe: mod.describe,
    suite: mod.suite ?? mod.describe,
    expect: mod.expect,
    beforeAll: mod.beforeAll,
    afterAll: mod.afterAll,
    beforeEach: mod.beforeEach,
    afterEach: mod.afterEach,
    // Map bun-style helpers onto vitest's `vi.*` so handler code is identical
    // across runtimes. `mock(fn)` ↔ `vi.fn(fn)`, `spyOn` matches signatures,
    // and `jest` is aliased to `vi` (same shape: `jest.fn`, `jest.spyOn`,
    // `jest.useFakeTimers`, etc.).
    mock: mod.vi.fn,
    spyOn: mod.vi.spyOn,
    jest: mod.vi,
    // Vitest-only extras — undefined on Bun.
    bench: mod.bench,
    expectTypeOf: mod.expectTypeOf,
    onTestFinished: mod.onTestFinished,
    onTestFailed: mod.onTestFailed,
    assert: mod.assert,
    assertType: mod.assertType,
  }
}

const runner = await loadRunner()

export const test: TestFn = runner.test
export const it: TestFn = runner.it
export const describe: DescribeFn = runner.describe
export const suite: DescribeFn = runner.suite ?? runner.describe
export const expect: ExpectStatic = runner.expect
export const beforeAll: LifecycleFn = runner.beforeAll
export const afterAll: LifecycleFn = runner.afterAll
export const beforeEach: LifecycleFn = runner.beforeEach
export const afterEach: LifecycleFn = runner.afterEach
export const mock: MockFn = runner.mock
export const spyOn: SpyOnFn = runner.spyOn
export const jest: JestNamespace = runner.jest

// Vitest-only extras. Undefined on Bun — calling them throws naturally.
export const bench: BenchFn | undefined = runner.bench
export const expectTypeOf: ExpectTypeOfFn | undefined = runner.expectTypeOf
export const onTestFinished = runner.onTestFinished
export const onTestFailed = runner.onTestFailed
export const assert = runner.assert
export const assertType = runner.assertType
