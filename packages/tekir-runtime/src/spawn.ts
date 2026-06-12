// Process spawning — Bun.spawn on Bun, child_process on Node.js

import { isBun } from './detect'

export interface SpawnOptions {
  cmd: string[]
  cwd?: string
  env?: Record<string, string>
  stdout?: 'pipe' | 'inherit' | 'ignore'
  stderr?: 'pipe' | 'inherit' | 'ignore'
}

export interface SpawnResult {
  exitCode: number | null
  stdout: string
  stderr: string
  kill(): void
}

/**
 * Spawn a child process and wait for it to finish.
 * Uses Bun.spawn on Bun, child_process.spawn on Node.js.
 *
 * @param {SpawnOptions} options - Spawn configuration (cmd, cwd, env, stdout, stderr)
 * @returns {Promise<SpawnResult>} The process result with exitCode, stdout, stderr, and kill()
 *
 * Security: `cmd` is passed straight to the OS spawn (no shell), so there is
 * no shell-injection vector, but `cmd[0]` is still an arbitrary executable.
 * NEVER build `cmd` from untrusted user input. When `options.env` is set it is
 * merged on top of the parent `process.env`; pass only the variables the child
 * actually needs if the parent process holds secrets.
 *
 * @example
 * ```ts
 * const result = await spawn({ cmd: ['bun', 'build', './src/index.ts'] })
 * console.log(result.stdout)
 * ```
 */
export async function spawn(options: SpawnOptions): Promise<SpawnResult> {
  if (isBun()) {
    return spawnBun(options)
  }
  return spawnNode(options)
}

async function spawnBun(options: SpawnOptions): Promise<SpawnResult> {
  const proc = (globalThis as any).Bun.spawn(options.cmd, {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    stdout: options.stdout || 'pipe',
    stderr: options.stderr || 'pipe',
  })

  const exitCode = await proc.exited
  const stdout = proc.stdout ? await new Response(proc.stdout).text() : ''
  const stderr = proc.stderr ? await new Response(proc.stderr).text() : ''

  return { exitCode, stdout, stderr, kill: () => proc.kill() }
}

async function spawnNode(options: SpawnOptions): Promise<SpawnResult> {
  const { spawn: nodeSpawn } = await import('node:child_process')

  return new Promise((resolve, reject) => {
    const [cmd, ...args] = options.cmd
    const proc: any = nodeSpawn(cmd, args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      stdio: [
        'ignore',
        options.stdout || 'pipe',
        options.stderr || 'pipe',
      ],
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    if (proc.stdout) proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    if (proc.stderr) proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

    // Without an 'error' listener, a failed spawn (ENOENT for a missing
    // binary) would leave this Promise pending forever — Bun's `proc.exited`
    // already rejects in that case, so match it here.
    proc.on('error', (err: Error) => {
      if (settled) return
      settled = true
      reject(err)
    })

    proc.on('close', (exitCode: number | null) => {
      if (settled) return
      settled = true
      resolve({ exitCode, stdout, stderr, kill: () => proc.kill() })
    })
  })
}
