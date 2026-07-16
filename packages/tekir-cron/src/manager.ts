import { captureCallerFile, loadDirEntries, type LoadDirOptions } from '@tekir/core'
import type { JobInfo } from './types'

export type { JobInfo } from './types'

// Types

interface InternalJob {
  name: string
  pattern: string
  callback: () => void | Promise<void>
  /** croner Cron instance — typed as `any` to avoid a hard peer-dep. */
  handle: any
  paused: boolean
}

// Cron

/**
 * Cron job manager that schedules, pauses, resumes, and removes recurring tasks
 * using cron expressions. Backed by the `croner` library (loaded lazily).
 *
 * @example
 * ```ts
 * const cron = new Cron()
 * await cron.add('cleanup', '0 0 * * *', () => removeOldFiles())
 * cron.stop('cleanup')
 * cron.start('cleanup')
 * cron.remove('cleanup')
 * ```
 */
export class Cron {
  private jobs: Map<string, InternalJob> = new Map()
  private defaultTimezone?: string

  /**
   * @param options.timezone - Default IANA timezone (e.g. `'UTC'`) that every
   *   job's cron pattern is evaluated in. When omitted, patterns fire in the
   *   host's local time (croner default). Can be overridden per-job in
   *   {@link Cron.add} or changed later via {@link Cron.setTimezone}.
   */
  constructor(options?: { timezone?: string }) {
    this.defaultTimezone = options?.timezone
  }

  /**
   * Set the default IANA timezone applied to jobs registered afterwards.
   * Call before {@link Cron.register}/{@link Cron.registerDir} so decorator
   * jobs pick it up. Patterns already scheduled are not retroactively changed.
   *
   * @param timezone - IANA zone name (e.g. `'UTC'`), or `undefined` to fall
   *   back to the host's local time.
   *
   * @example
   * ```ts
   * cron.setTimezone('UTC')
   * await cron.registerDir('./cron')
   * ```
   */
  setTimezone(timezone?: string): void {
    this.defaultTimezone = timezone
  }

  // add

  /**
   * Register and immediately start a cron job.
   *
   * @param name - Unique identifier for the job.
   * @param pattern - Cron expression (e.g. `'0 0 * * *'` for daily at midnight).
   * @param callback - Function to run on each tick. May be async.
   * @param options.timezone - IANA timezone for this job's pattern; falls back
   *   to the manager default (see {@link Cron.setTimezone}) then host local time.
   * @returns A promise that resolves once the job is registered.
   * @throws Error if a job with the same name is already registered.
   *
   * @example
   * ```ts
   * await cron.add('send-digest', '0 9 * * 1', () => sendWeeklyDigest())
   * ```
   */
  async add(
    name: string,
    pattern: string,
    callback: () => void | Promise<void>,
    options?: { timezone?: string },
  ): Promise<void> {
    if (this.jobs.has(name)) {
      throw new Error(`[cron] Job "${name}" is already registered. Remove it first.`)
    }

    // Dynamic import keeps `croner` an optional runtime dependency and avoids
    // bundler issues in environments where it may not be present at build time.
    // @ts-ignore — croner is an optional peer dependency
    const { Cron } = await import('croner')

    // In-flight guard: skip a tick whose callback is still running so a long
    // async job never overlaps with itself. `protect: true` also asks croner to
    // skip overlapping triggers; the explicit flag is belt-and-suspenders and
    // keeps the guarantee even if a croner build ignores the option.
    const timezone = options?.timezone ?? this.defaultTimezone
    let running = false
    let handle: any
    try {
      handle = new Cron(pattern, { paused: false, protect: true, ...(timezone ? { timezone } : {}) }, () => {
        if (running) return
        let result: void | Promise<void>
        try {
          result = callback()
        } catch (err) {
          console.error(`[cron] Unhandled error in job "${name}":`, err)
          return
        }
        if (result && typeof (result as Promise<void>).then === 'function') {
          running = true
          Promise.resolve(result)
            .catch((err) =>
              console.error(`[cron] Unhandled error in job "${name}":`, err),
            )
            .finally(() => { running = false })
        }
      })
    } catch (err) {
      // Surface which job carried the bad pattern; croner's own message omits it.
      const reason = err instanceof Error ? err.message : String(err)
      throw new Error(`[cron] Job "${name}" has an invalid cron pattern "${pattern}": ${reason}`)
    }

    this.jobs.set(name, { name, pattern, callback, handle, paused: false })
  }

  // remove

  /**
   * Stop and unregister a cron job. The job is permanently removed and must
   * be re-added with {@link add} to run again.
   *
   * @param name - The unique identifier of the job to remove.
   * @throws Error if no job with the given name is registered.
   *
   * @example
   * ```ts
   * cron.remove('cleanup')
   * ```
   */
  remove(name: string): void {
    const job = this.requireJob(name)
    job.handle.stop()
    this.jobs.delete(name)
  }

  // stop / start individual jobs

  /**
   * Pause a running cron job. The schedule is kept and can be resumed
   * with {@link start}. If already paused, this is a no-op.
   *
   * @param name - The unique identifier of the job to pause.
   * @throws Error if no job with the given name is registered.
   *
   * @example
   * ```ts
   * cron.stop('send-digest')
   * ```
   */
  stop(name: string): void {
    const job = this.requireJob(name)
    if (job.paused) return
    job.handle.pause()
    job.paused = true
  }

  /**
   * Resume a paused cron job. If the job is already running, this is a no-op.
   *
   * @param name - The unique identifier of the job to resume.
   * @throws Error if no job with the given name is registered.
   *
   * @example
   * ```ts
   * cron.start('send-digest')
   * ```
   */
  start(name: string): void {
    const job = this.requireJob(name)
    if (!job.paused) return
    job.handle.resume()
    job.paused = false
  }

  // bulk operations

  /**
   * Pause every registered job.
   *
   * @example
   * ```ts
   * cron.stopAll()
   * ```
   */
  stopAll(): void {
    for (const name of this.jobs.keys()) {
      this.stop(name)
    }
  }

  /**
   * Resume every registered job.
   *
   * @example
   * ```ts
   * cron.startAll()
   * ```
   */
  startAll(): void {
    for (const name of this.jobs.keys()) {
      this.start(name)
    }
  }

  /**
   * Stop and unregister every job for a graceful shutdown. Each job's croner
   * handle is stopped (timers cleared) and the registry is emptied, so no new
   * ticks fire after this resolves.
   *
   * Note: this clears the schedule but does not block on a tick that is already
   * mid-flight; awaiting it lets any synchronous teardown settle.
   *
   * @example
   * ```ts
   * process.on('SIGTERM', () => cron.shutdown())
   * ```
   */
  async shutdown(): Promise<void> {
    for (const job of this.jobs.values()) {
      try {
        job.handle.stop()
      } catch {
        // A handle may already be stopped; ignore so shutdown always completes.
      }
    }
    this.jobs.clear()
  }

  // introspection

  /**
   * Return a snapshot of all registered jobs and their current status.
   *
   * @returns An array of {@link JobInfo} objects describing each registered job.
   *
   * @example
   * ```ts
   * const jobs = cron.list()
   * // [{ name: 'cleanup', pattern: '0 0 * * *', running: true }]
   * ```
   */
  list(): JobInfo[] {
    return Array.from(this.jobs.values()).map((job) => ({
      name: job.name,
      pattern: job.pattern,
      running: !job.paused,
    }))
  }

  /**
   * Return `true` if the named job exists and is not paused.
   *
   * @param name - The unique identifier of the job to check.
   * @returns `true` if the job is registered and currently running.
   *
   * @example
   * ```ts
   * if (cron.isRunning('cleanup')) { ... }
   * ```
   */
  isRunning(name: string): boolean {
    const job = this.jobs.get(name)
    if (!job) return false
    return !job.paused
  }

  // register decorator-based job classes

  /**
   * Register one or more decorator-based job classes. Each class should have
   * a static `__schedules` array populated by schedule decorators.
   *
   * @param classes - Job classes or instances to register.
   * @returns A promise that resolves once all jobs are registered.
   *
   * @example
   * ```ts
   * await cron.register(CleanupJob, ReportJob)
   * ```
   */
  async register(...classes: any[]): Promise<void> {
    for (const JobClass of classes) {
      const instance = typeof JobClass === 'function' ? new JobClass() : JobClass
      const proto = Object.getPrototypeOf(instance)
      const schedules: { name: string; pattern: string; method: string }[] = JobClass.__schedules || proto.constructor.__schedules || []

      for (const schedule of schedules) {
        await this.add(schedule.name, schedule.pattern, () => instance[schedule.method]())
      }
    }
  }

  /**
   * Load every file in a directory and register whatever each module
   * exports as a cron job. Auto-detects three common shapes:
   *
   * 1. **Decorator class** with `__schedules` (the `@Schedule('* * * * *')`
   *    pattern): passed straight to {@link CronManager.register}.
   * 2. **Functional registrar** (`export default (cron) => { ... }`): the
   *    function is invoked with this manager so it can call `cron.add(...)`
   *    directly.
   * 3. **Class with a `register(cron)` method**: a fresh instance is
   *    constructed and its `register` method is invoked.
   *
   * Files whose default export does not match any pattern are skipped
   * with a `console.warn` so misconfigured exports surface during boot.
   *
   * @example
   * ```ts
   * await cron.registerDir('app/jobs')
   * ```
   *
   * @param dir Directory. Absolute paths are used as-is. Relative paths
   *   default to the caller's own directory (file-relative, captured via
   *   stack inspection so `await cron.registerDir('./jobs')` from
   *   `api/index.ts` resolves to `api/jobs` regardless of cwd). Pass
   *   `options.from = import.meta.url` to set the base explicitly, or
   *   `options.from = process.cwd()` to keep the pre-0.1.3 cwd-relative
   *   behavior.
   * @param options Forwarded to `loadDir`. See `LoadDirOptions`.
   *
   * Note: dynamic imports are not statically traced by
   * `bun build --compile`. For single-executable builds keep an explicit
   * `import` list and pass it to {@link CronManager.register}.
   */
  async registerDir(
    dir: string,
    options?: LoadDirOptions,
  ): Promise<void> {
    // Capture the caller SYNCHRONOUSLY before any `await` runs — once
    // this function suspends at an await, the user's call frame is gone
    // and the resumed stack only contains JS engine internals. Static
    // top-level imports for `captureCallerFile`/`loadDirEntries` keep
    // this initial line synchronous.
    const from = options?.from ?? captureCallerFile(this.registerDir)
    const entries = await loadDirEntries<any>(dir, { ...options, from })
    if (entries.length === 0) {
      console.warn(
        `[cron.registerDir] No modules loaded from "${dir}" (resolved against ${from ?? 'cwd: ' + process.cwd()}). ` +
        `If this is a production bundle outside of \`bun build --compile\`, the AST inliner that ` +
        `replaces literal-string \`registerDir\` calls did not run. Add the plugin to your build: ` +
        `\`Bun.build({ plugins: [await (await import('@tekir/core')).createInlinerPlugin()] })\`, ` +
        `or use \`bun build --compile\` so the tekir CLI auto-injects it.`,
      )
    }
    for (const { file, picked: mod } of entries) {
      if (mod && (mod.__schedules !== undefined || (typeof mod === 'function' && mod.prototype && Object.getPrototypeOf(mod.prototype)?.constructor?.__schedules))) {
        await this.register(mod)
        continue
      }
      if (typeof mod === 'function' && (!mod.prototype || Object.getOwnPropertyNames(mod.prototype).length === 1)) {
        await mod(this)
        continue
      }
      if (typeof mod === 'function' && typeof mod.prototype?.register === 'function') {
        const instance = new mod()
        await instance.register(this)
        continue
      }
      if (mod && typeof mod === 'object' && typeof (mod as any).register === 'function') {
        await (mod as any).register(this)
        continue
      }
      const name = mod?.constructor?.name || (typeof mod === 'function' ? mod.name : typeof mod)
      console.warn(`[cron.registerDir] ${file}: skipped (unrecognized export shape: ${name || '<unknown>'})`)
    }
  }

  // internal helpers

  private requireJob(name: string): InternalJob {
    const job = this.jobs.get(name)
    if (!job) {
      throw new Error(`[cron] Job "${name}" is not registered.`)
    }
    return job
  }
}
