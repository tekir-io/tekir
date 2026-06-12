import autocannon from 'autocannon'

const DURATION = 10
const CONNECTIONS = 100
const PIPELINING = 1

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function waitFor(port: number) {
  for (let i = 0; i < 30; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json`); if (r.ok) return true } catch {}
    await sleep(300)
  }
  return false
}

async function warmUp(port: number) {
  return new Promise<void>((resolve) => {
    const i = autocannon({ url: `http://127.0.0.1:${port}/json`, connections: 50, duration: 5, pipelining: 10 })
    i.on('done', () => resolve())
  })
}

async function bench(port: number, path: string) {
  return new Promise<number>((resolve) => {
    const i = autocannon({ url: `http://127.0.0.1:${port}${path}`, connections: CONNECTIONS, duration: DURATION, pipelining: PIPELINING })
    i.on('done', (r: any) => resolve(Math.round(r.requests.average)))
  })
}

function bar(value: number, max: number, w = 25): string {
  const filled = Math.round((value / max) * w)
  return '\u2588'.repeat(filled) + '\u2591'.repeat(w - filled)
}

async function main() {
  const endpoints = ['/json', '/users/42', '/posts/1/comments/5', '/search?q=hello&page=2']
  const servers = [
    { name: 'Raw Bun', script: 'src/bun-raw.ts',  port: 3003 },
    { name: 'tekir',   script: 'src/tekir.ts',    port: 3001 },
    { name: 'Elysia',  script: 'src/elysia.ts',   port: 3002 },
  ]

  console.log()
  console.log('\u2554' + '\u2550'.repeat(70) + '\u2557')
  console.log('\u2551' + `  Raw Bun vs tekir vs Elysia`.padEnd(70) + '\u2551')
  console.log('\u2551' + `  autocannon | ${DURATION}s | ${CONNECTIONS} conn | ${PIPELINING}x pipeline`.padEnd(70) + '\u2551')
  console.log('\u255A' + '\u2550'.repeat(70) + '\u255D')

  // Start all servers
  console.log('\n[*] Starting servers...')
  const procs = servers.map(s =>
    Bun.spawn(['bun', 'run', s.script], {
      cwd: import.meta.dir + '/..',
      env: { ...process.env, PORT: String(s.port) },
      stdout: 'pipe', stderr: 'pipe',
    })
  )

  await Promise.all(servers.map(s => waitFor(s.port)))
  console.log('[*] All servers ready')

  // Warm up all
  console.log('[*] Warming up...')
  await Promise.all(servers.map(s => warmUp(s.port)))
  console.log('[*] Done\n')

  const results: Record<string, Record<string, number>> = {}
  for (const s of servers) results[s.name] = {}

  for (const ep of endpoints) {
    // Bench each server sequentially per endpoint (fair)
    for (const s of servers) {
      results[s.name][ep] = await bench(s.port, ep)
    }

    const max = Math.max(...servers.map(s => results[s.name][ep]))

    console.log(`  ${ep}`)
    for (const s of servers) {
      const v = results[s.name][ep]
      console.log(`    ${s.name.padEnd(10)} ${bar(v, max)} ${v.toLocaleString().padStart(8)}/s`)
    }
    console.log()
  }

  // Summary
  console.log('\u2550'.repeat(72))
  console.log('  ' + 'Endpoint'.padEnd(28) + servers.map(s => s.name.padStart(10)).join(''))
  console.log('\u2500'.repeat(72))

  const totals: Record<string, number> = {}
  for (const s of servers) totals[s.name] = 0

  for (const ep of endpoints) {
    const parts = servers.map(s => {
      totals[s.name] += results[s.name][ep]
      return results[s.name][ep].toLocaleString().padStart(10)
    })
    console.log('  ' + ep.padEnd(28) + parts.join(''))
  }

  console.log('\u2500'.repeat(72))
  const avgParts = servers.map(s => Math.round(totals[s.name] / endpoints.length).toLocaleString().padStart(10))
  console.log('  ' + 'AVERAGE'.padEnd(28) + avgParts.join(''))
  console.log()

  for (const p of procs) p.kill()
  process.exit(0)
}

main()
