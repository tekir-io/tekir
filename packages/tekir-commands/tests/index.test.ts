import { test, expect, describe, mock } from 'bun:test'
import { BaseCommand, parse, Kernel, colors, Logger, Table, Sticker, Instructions, Tasks, TerminalUI } from '../src/index'

// Parser — 80 tests

describe('Parser — args', () => {
  test('parses single string arg', () => {
    expect(parse(['hello'], { name: { type: 'string' } }, {}).args.name).toBe('hello')
  })
  test('parses two string args in order', () => {
    const r = parse(['a', 'b'], { x: { type: 'string' }, y: { type: 'string' } }, {})
    expect(r.args.x).toBe('a')
    expect(r.args.y).toBe('b')
  })
  test('parses three string args', () => {
    const r = parse(['1', '2', '3'], { a: { type: 'string' }, b: { type: 'string' }, c: { type: 'string' } }, {})
    expect(r.args.a).toBe('1')
    expect(r.args.b).toBe('2')
    expect(r.args.c).toBe('3')
  })
  test('throws on missing required arg', () => {
    expect(() => parse([], { name: { type: 'string' } }, {})).toThrow('Missing required')
  })
  test('throws on missing second required arg', () => {
    expect(() => parse(['a'], { x: { type: 'string' }, y: { type: 'string' } }, {})).toThrow('Missing required')
  })
  test('optional arg returns undefined when absent and no default', () => {
    const r = parse([], { name: { type: 'string', required: false } }, {})
    expect(r.args.name).toBeUndefined()
  })
  test('optional arg with default', () => {
    expect(parse([], { env: { type: 'string', required: false, default: 'prod' } }, {}).args.env).toBe('prod')
  })
  test('optional arg overridden by value', () => {
    expect(parse(['dev'], { env: { type: 'string', required: false, default: 'prod' } }, {}).args.env).toBe('dev')
  })
  test('parse transform on arg', () => {
    expect(parse(['hello'], { n: { type: 'string', parse: v => v.toUpperCase() } }, {}).args.n).toBe('HELLO')
  })
  test('parse transform on optional arg default', () => {
    expect(parse([], { n: { type: 'string', required: false, default: 'hello', parse: v => v.toUpperCase() } }, {}).args.n).toBe('HELLO')
  })
  test('arg with spaces (quoted)', () => {
    expect(parse(['hello world'], { n: { type: 'string' } }, {}).args.n).toBe('hello world')
  })
  test('arg with special characters', () => {
    expect(parse(['user@example.com'], { e: { type: 'string' } }, {}).args.e).toBe('user@example.com')
  })
  test('empty string arg', () => {
    expect(parse([''], { n: { type: 'string' } }, {}).args.n).toBe('')
  })
  test('arg with numbers', () => {
    expect(parse(['42'], { n: { type: 'string' } }, {}).args.n).toBe('42')
  })
})

describe('Parser — spread args', () => {
  test('spread collects all positionals', () => {
    expect(parse(['a', 'b', 'c'], { names: { type: 'spread' } }, {}).args.names).toEqual(['a', 'b', 'c'])
  })
  test('spread with single value', () => {
    expect(parse(['a'], { names: { type: 'spread' } }, {}).args.names).toEqual(['a'])
  })
  test('spread throws when required and empty', () => {
    expect(() => parse([], { names: { type: 'spread' } }, {})).toThrow('Missing required')
  })
  test('spread optional returns empty array', () => {
    expect(parse([], { names: { type: 'spread', required: false } }, {}).args.names).toEqual([])
  })
  test('spread with parse transform', () => {
    expect(parse(['a', 'b'], { n: { type: 'spread', parse: v => v.toUpperCase() } }, {}).args.n).toEqual(['A', 'B'])
  })
  test('string arg + spread after', () => {
    const r = parse(['cmd', 'a', 'b'], { cmd: { type: 'string' }, rest: { type: 'spread' } }, {})
    expect(r.args.cmd).toBe('cmd')
    expect(r.args.rest).toEqual(['a', 'b'])
  })
})

describe('Parser — boolean flags', () => {
  test('--flag sets true', () => {
    expect(parse(['--verbose'], {}, { verbose: { type: 'boolean' } }).flags.verbose).toBe(true)
  })
  test('--no-flag sets false', () => {
    expect(parse(['--no-verbose'], {}, { verbose: { type: 'boolean' } }).flags.verbose).toBe(false)
  })
  test('absent boolean is undefined', () => {
    expect(parse([], {}, { verbose: { type: 'boolean' } }).flags.verbose).toBeUndefined()
  })
  test('boolean with default true', () => {
    expect(parse([], {}, { minify: { type: 'boolean', default: true } }).flags.minify).toBe(true)
  })
  test('negated overrides default true', () => {
    expect(parse(['--no-minify'], {}, { minify: { type: 'boolean', default: true } }).flags.minify).toBe(false)
  })
  test('multiple boolean flags', () => {
    const r = parse(['--a', '--b'], {}, { a: { type: 'boolean' }, b: { type: 'boolean' } })
    expect(r.flags.a).toBe(true)
    expect(r.flags.b).toBe(true)
  })
})

describe('Parser — string flags', () => {
  test('--name value', () => {
    expect(parse(['--name', 'hello'], {}, { name: { type: 'string' } }).flags.name).toBe('hello')
  })
  test('--name=value', () => {
    expect(parse(['--name=hello'], {}, { name: { type: 'string' } }).flags.name).toBe('hello')
  })
  test('--name=value with spaces in value', () => {
    expect(parse(['--name=hello world'], {}, { name: { type: 'string' } }).flags.name).toBe('hello world')
  })
  test('string flag default', () => {
    expect(parse([], {}, { driver: { type: 'string', default: 'sqlite' } }).flags.driver).toBe('sqlite')
  })
  test('string flag overrides default', () => {
    expect(parse(['--driver', 'mysql'], {}, { driver: { type: 'string', default: 'sqlite' } }).flags.driver).toBe('mysql')
  })
  test('throws on missing string value', () => {
    expect(() => parse(['--name'], {}, { name: { type: 'string' } })).toThrow('Missing value')
  })
  test('string flag with parse transform', () => {
    expect(parse(['--env', 'PROD'], {}, { env: { type: 'string', parse: v => v.toLowerCase() } }).flags.env).toBe('prod')
  })
})

describe('Parser — number flags', () => {
  test('--port 3000', () => {
    expect(parse(['--port', '3000'], {}, { port: { type: 'number' } }).flags.port).toBe(3000)
  })
  test('--port=8080', () => {
    expect(parse(['--port=8080'], {}, { port: { type: 'number' } }).flags.port).toBe(8080)
  })
  test('negative number via equals', () => {
    expect(parse(['--offset=-5'], {}, { offset: { type: 'number' } }).flags.offset).toBe(-5)
  })
  test('zero', () => {
    expect(parse(['--count', '0'], {}, { count: { type: 'number' } }).flags.count).toBe(0)
  })
  test('decimal', () => {
    expect(parse(['--rate', '0.5'], {}, { rate: { type: 'number' } }).flags.rate).toBe(0.5)
  })
  test('throws on invalid number', () => {
    expect(() => parse(['--port', 'abc'], {}, { port: { type: 'number' } })).toThrow('valid number')
  })
  test('number default', () => {
    expect(parse([], {}, { port: { type: 'number', default: 3000 } }).flags.port).toBe(3000)
  })
  test('number with parse transform', () => {
    expect(parse(['--port', '80'], {}, { port: { type: 'number', parse: v => Number(v) * 10 } }).flags.port).toBe(800)
  })
})

describe('Parser — array flags', () => {
  test('single value', () => {
    expect(parse(['--tag', 'a'], {}, { tag: { type: 'array' } }).flags.tag).toEqual(['a'])
  })
  test('multiple values', () => {
    expect(parse(['--tag', 'a', '--tag', 'b', '--tag', 'c'], {}, { tag: { type: 'array' } }).flags.tag).toEqual(['a', 'b', 'c'])
  })
  test('array with parse transform', () => {
    expect(parse(['--t', 'a', '--t', 'b'], {}, { t: { type: 'array', parse: v => v.toUpperCase() } }).flags.t).toEqual(['A', 'B'])
  })
  test('throws on missing array value', () => {
    expect(() => parse(['--tag'], {}, { tag: { type: 'array' } })).toThrow('Missing value')
  })
})

describe('Parser — aliases', () => {
  test('-v for boolean', () => {
    expect(parse(['-v'], {}, { verbose: { type: 'boolean', alias: 'v' } }).flags.verbose).toBe(true)
  })
  test('combined -rs', () => {
    const r = parse(['-rs'], {}, { r: { type: 'boolean', alias: 'r' }, s: { type: 'boolean', alias: 's' } })
    expect(r.flags.r).toBe(true)
    expect(r.flags.s).toBe(true)
  })
  test('-n value for string', () => {
    expect(parse(['-n', 'hello'], {}, { name: { type: 'string', alias: 'n' } }).flags.name).toBe('hello')
  })
  test('combined booleans -abc', () => {
    const r = parse(['-abc'], {}, {
      a: { type: 'boolean', alias: 'a' },
      b: { type: 'boolean', alias: 'b' },
      c: { type: 'boolean', alias: 'c' },
    })
    expect(r.flags.a).toBe(true)
    expect(r.flags.b).toBe(true)
    expect(r.flags.c).toBe(true)
  })
  test('unknown short alias throws', () => {
    expect(() => parse(['-z'], {}, {})).toThrow('Unknown flag')
  })
  test('unknown short alias allowed', () => {
    expect(parse(['-z'], {}, {}, true).unknownFlags).toContain('-z')
  })
})

describe('Parser — kebab-case', () => {
  test('camelCase to kebab-case', () => {
    expect(parse(['--start-server'], {}, { startServer: { type: 'boolean' } }).flags.startServer).toBe(true)
  })
  test('custom flagName is not used — kebab from key', () => {
    expect(parse(['--dry-run'], {}, { dryRun: { type: 'boolean' } }).flags.dryRun).toBe(true)
  })
})

describe('Parser — unknown flags', () => {
  test('throws by default', () => {
    expect(() => parse(['--unknown'], {}, {})).toThrow('Unknown flag')
  })
  test('allows when enabled', () => {
    const r = parse(['--unknown', '--also'], {}, {}, true)
    expect(r.unknownFlags).toContain('--unknown')
    expect(r.unknownFlags).toContain('--also')
  })
  test('unknown negated flag throws', () => {
    expect(() => parse(['--no-fake'], {}, {})).toThrow('Unknown flag')
  })
})

describe('Parser — mixed', () => {
  test('args before flags', () => {
    const r = parse(['hello', '--loud'], { name: { type: 'string' } }, { loud: { type: 'boolean' } })
    expect(r.args.name).toBe('hello')
    expect(r.flags.loud).toBe(true)
  })
  test('flags before args', () => {
    const r = parse(['--loud', 'hello'], { name: { type: 'string' } }, { loud: { type: 'boolean' } })
    expect(r.args.name).toBe('hello')
    expect(r.flags.loud).toBe(true)
  })
  test('interleaved args and flags', () => {
    const r = parse(['a', '--x', 'b'], { p: { type: 'string' }, q: { type: 'string' } }, { x: { type: 'boolean' } })
    expect(r.args.p).toBe('a')
    expect(r.args.q).toBe('b')
    expect(r.flags.x).toBe(true)
  })
  test('empty argv with no defs', () => {
    const r = parse([], {}, {})
    expect(r.args).toEqual({})
    expect(r.flags).toEqual({})
    expect(r.unknownFlags).toEqual([])
  })
  test('only flags no args', () => {
    const r = parse(['--a', '--b', 'val'], {}, { a: { type: 'boolean' }, b: { type: 'string' } })
    expect(r.flags.a).toBe(true)
    expect(r.flags.b).toBe('val')
  })
})

// BaseCommand — 40 tests

describe('BaseCommand — defaults', () => {
  test('exitCode is 0', () => {
    expect(new (class extends BaseCommand { static commandName='t'; async run(){} })().exitCode).toBe(0)
  })
  test('error is null', () => {
    expect(new (class extends BaseCommand { static commandName='t'; async run(){} })().error).toBeNull()
  })
  test('static args default is empty', () => {
    expect(BaseCommand.args).toEqual({})
  })
  test('static flags default is empty', () => {
    expect(BaseCommand.flags).toEqual({})
  })
  test('static aliases default is empty', () => {
    expect(BaseCommand.aliases).toEqual([])
  })
  test('static description default is empty', () => {
    expect(BaseCommand.description).toBe('')
  })
  test('static help default is empty', () => {
    expect(BaseCommand.help).toEqual([])
  })
})

describe('BaseCommand — utilities', () => {
  test('has logger', () => { expect(new (class extends BaseCommand { static commandName='t'; async run(){} })().logger).toBeInstanceOf(Logger) })
  test('has ui', () => { expect(new (class extends BaseCommand { static commandName='t'; async run(){} })().ui).toBeInstanceOf(TerminalUI) })
  test('has colors', () => { expect(new (class extends BaseCommand { static commandName='t'; async run(){} })().colors).toBe(colors) })
  test('has prompt', () => { expect(new (class extends BaseCommand { static commandName='t'; async run(){} })().prompt).toBeDefined() })
})

describe('BaseCommand — lifecycle', () => {
  test('runs in order: prepare → interact → run → completed', async () => {
    const order: string[] = []
    class C extends BaseCommand {
      static commandName = 't'
      async prepare() { order.push('p') }
      async interact() { order.push('i') }
      async run() { order.push('r') }
      async completed() { order.push('c') }
    }
    const c = new C(); c.parsed = { command: 't', args: {}, flags: {}, unknownFlags: [] }
    await c.exec()
    expect(order).toEqual(['p', 'i', 'r', 'c'])
  })
  test('only run is required', async () => {
    let ran = false
    class C extends BaseCommand { static commandName = 't'; async run() { ran = true } }
    const c = new C(); c.parsed = { command: 't', args: {}, flags: {}, unknownFlags: [] }
    await c.exec()
    expect(ran).toBe(true)
  })
  test('prepare sets state for run', async () => {
    class C extends BaseCommand {
      static commandName = 't'
      data = ''
      async prepare() { this.data = 'ready' }
      async run() { this.data += ':done' }
    }
    const c = new C(); c.parsed = { command: 't', args: {}, flags: {}, unknownFlags: [] }
    await c.exec()
    expect(c.data).toBe('ready:done')
  })
  test('interact sets state for run', async () => {
    class C extends BaseCommand {
      static commandName = 't'
      answer = ''
      async interact() { this.answer = 'yes' }
      async run() { expect(this.answer).toBe('yes') }
    }
    const c = new C(); c.parsed = { command: 't', args: {}, flags: {}, unknownFlags: [] }
    await c.exec()
  })
  test('error in run sets exitCode 1', async () => {
    class C extends BaseCommand { static commandName = 't'; async run() { throw new Error('x') } }
    const orig = process.stderr.write; process.stderr.write = mock((..._args: any[]) => true) as any
    const c = new C(); c.parsed = { command: 't', args: {}, flags: {}, unknownFlags: [] }
    await c.exec()
    expect(c.exitCode).toBe(1)
    expect(c.error!.message).toBe('x')
    process.stderr.write = orig
  })
  test('error in prepare sets exitCode 1', async () => {
    class C extends BaseCommand { static commandName = 't'; async prepare() { throw new Error('p') }; async run() {} }
    const orig = process.stderr.write; process.stderr.write = mock((..._args: any[]) => true) as any
    const c = new C(); c.parsed = { command: 't', args: {}, flags: {}, unknownFlags: [] }
    await c.exec()
    expect(c.exitCode).toBe(1)
    process.stderr.write = orig
  })
  test('success keeps exitCode 0 and error null', async () => {
    class C extends BaseCommand { static commandName = 't'; async run() {} }
    const c = new C(); c.parsed = { command: 't', args: {}, flags: {}, unknownFlags: [] }
    await c.exec()
    expect(c.exitCode).toBe(0)
    expect(c.error).toBeNull()
  })
  test('completed receives null error on success', async () => {
    let err: any = 'not-null'
    class C extends BaseCommand {
      static commandName = 't'
      async run() {}
      async completed() { err = this.error }
    }
    const c = new C(); c.parsed = { command: 't', args: {}, flags: {}, unknownFlags: [] }
    await c.exec()
    expect(err).toBeNull()
  })
  test('completed can handle error and return true', async () => {
    let handled = ''
    class C extends BaseCommand {
      static commandName = 't'
      async run() { throw new Error('caught') }
      async completed() { if (this.error) { handled = this.error.message; return true } }
    }
    const c = new C(); c.parsed = { command: 't', args: {}, flags: {}, unknownFlags: [] }
    await c.exec()
    expect(handled).toBe('caught')
  })
  test('completed error in completed itself is logged', async () => {
    class C extends BaseCommand {
      static commandName = 't'
      async run() {}
      async completed() { throw new Error('oops') }
    }
    const orig = process.stderr.write; process.stderr.write = mock((..._args: any[]) => true) as any
    const c = new C(); c.parsed = { command: 't', args: {}, flags: {}, unknownFlags: [] }
    await c.exec()
    expect(c.exitCode).toBe(1)
    process.stderr.write = orig
  })
})

describe('BaseCommand — args/flags getters', () => {
  test('args getter reads from parsed', async () => {
    class C extends BaseCommand {
      static commandName = 'g'
      static args = { name: { type: 'string' as const } }
      result = ''
      async run() { this.result = this.args.name }
    }
    const c = new C(); c.parsed = parse(['Alice'], C.args, C.flags)
    await c.exec()
    expect(c.result).toBe('Alice')
  })
  test('flags getter reads from parsed', async () => {
    class C extends BaseCommand {
      static commandName = 'g'
      static flags = { loud: { type: 'boolean' as const } }
      result = false
      async run() { this.result = this.flags.loud }
    }
    const c = new C(); c.parsed = parse(['--loud'], {}, C.flags)
    await c.exec()
    expect(c.result).toBe(true)
  })
  test('args getter returns empty when no parsed', () => {
    class C extends BaseCommand { static commandName = 'g'; async run() {} }
    const c = new C()
    expect(c.args).toEqual({})
  })
  test('flags getter returns empty when no parsed', () => {
    class C extends BaseCommand { static commandName = 'g'; async run() {} }
    const c = new C()
    expect(c.flags).toEqual({})
  })
})

describe('BaseCommand — static metadata', () => {
  test('commandName', () => {
    class C extends BaseCommand { static commandName = 'deploy'; async run() {} }
    expect(C.commandName).toBe('deploy')
  })
  test('description', () => {
    class C extends BaseCommand { static commandName = 't'; static description = 'Do stuff'; async run() {} }
    expect(C.description).toBe('Do stuff')
  })
  test('aliases', () => {
    class C extends BaseCommand { static commandName = 't'; static aliases = ['x', 'y']; async run() {} }
    expect(C.aliases).toEqual(['x', 'y'])
  })
  test('options', () => {
    class C extends BaseCommand { static commandName = 't'; static options = { startApp: true, staysAlive: true }; async run() {} }
    expect(C.options.startApp).toBe(true)
    expect(C.options.staysAlive).toBe(true)
  })
  test('help', () => {
    class C extends BaseCommand { static commandName = 't'; static help = ['line1', 'line2']; async run() {} }
    expect(C.help).toEqual(['line1', 'line2'])
  })
})

// Kernel — 20 tests

describe('Kernel', () => {
  test('register adds command', () => {
    const k = new Kernel()
    class A extends BaseCommand { static commandName = 'a'; async run() {} }
    k.register(A as any)
  })
  test('registerAll adds multiple', () => {
    class A extends BaseCommand { static commandName = 'a'; async run() {} }
    class B extends BaseCommand { static commandName = 'b'; async run() {} }
    new Kernel().registerAll([A, B] as any[])
  })
  test('registerAll with empty array', () => {
    new Kernel().registerAll([])
  })
  test('throws without commandName', () => {
    class Bad extends BaseCommand { static commandName = ''; async run() {} }
    expect(() => new Kernel().register(Bad as any)).toThrow()
  })
  test('register returns this for chaining', () => {
    class A extends BaseCommand { static commandName = 'a'; async run() {} }
    const k = new Kernel()
    expect(k.register(A as any)).toBe(k)
  })
  test('printHelp outputs commands', () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    class A extends BaseCommand { static commandName = 'test'; static description = 'Test cmd'; async run() {} }
    new Kernel().register(A as any).printHelp()
    const output = spy.mock.calls.map((c: any) => c[0]).join('\n')
    expect(output).toContain('test')
    spy.mockRestore?.()
  })
  test('printHelp groups by namespace', () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    class A extends BaseCommand { static commandName = 'make:model'; async run() {} }
    class B extends BaseCommand { static commandName = 'make:controller'; async run() {} }
    class C extends BaseCommand { static commandName = 'serve'; async run() {} }
    const k = new Kernel()
    k.registerAll([A, B, C] as any[])
    k.printHelp()
    const output = spy.mock.calls.map((c: any) => c[0]).join('\n')
    expect(output).toContain('make')
    expect(output).toContain('general')
    spy.mockRestore?.()
  })
  test('discover with non-existent dir returns this', async () => {
    const k = new Kernel()
    const result = await k.discover('/nonexistent/path')
    expect(result).toBe(k)
  })
  test('constructor accepts app', () => {
    const app = { boot: async () => {} }
    const k = new Kernel(app)
    expect(k).toBeDefined()
  })
  test('constructor without app', () => {
    expect(new Kernel()).toBeDefined()
  })
})

// UI — 40 tests

describe('Colors', () => {
  test('red', () => { expect(colors.red('x')).toContain('\x1b[31m') })
  test('green', () => { expect(colors.green('x')).toContain('\x1b[32m') })
  test('yellow', () => { expect(colors.yellow('x')).toContain('\x1b[33m') })
  test('blue', () => { expect(colors.blue('x')).toContain('\x1b[34m') })
  test('magenta', () => { expect(colors.magenta('x')).toContain('\x1b[35m') })
  test('cyan', () => { expect(colors.cyan('x')).toContain('\x1b[36m') })
  test('gray', () => { expect(colors.gray('x')).toContain('\x1b[90m') })
  test('dim', () => { expect(colors.dim('x')).toContain('\x1b[2m') })
  test('bold', () => { expect(colors.bold('x')).toContain('\x1b[1m') })
  test('underline', () => { expect(colors.underline('x')).toContain('\x1b[4m') })
  test('bgRed', () => { expect(colors.bgRed('x')).toContain('\x1b[41m') })
  test('bgGreen', () => { expect(colors.bgGreen('x')).toContain('\x1b[42m') })
  test('bgYellow', () => { expect(colors.bgYellow('x')).toContain('\x1b[43m') })
  test('bgBlue', () => { expect(colors.bgBlue('x')).toContain('\x1b[44m') })
  test('bgCyan', () => { expect(colors.bgCyan('x')).toContain('\x1b[46m') })
  test('white', () => { expect(colors.white('x')).toContain('\x1b[37m') })
  test('all return original text', () => {
    for (const fn of Object.values(colors)) {
      expect(fn('hello')).toContain('hello')
    }
  })
})

describe('Logger', () => {
  test('debug outputs', () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    new Logger().debug('msg')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore?.()
  })
  test('info outputs', () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    new Logger().info('msg')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore?.()
  })
  test('success outputs', () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    new Logger().success('msg')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore?.()
  })
  test('warning outputs', () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    new Logger().warning('msg')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore?.()
  })
  test('error writes to stderr', () => {
    const orig = process.stderr.write; const spy = mock((..._args: any[]) => true); process.stderr.write = spy as any
    new Logger().error('err')
    expect(spy).toHaveBeenCalled()
    process.stderr.write = orig
  })
  test('error accepts Error object', () => {
    const orig = process.stderr.write; const spy = mock((..._args: any[]) => true); process.stderr.write = spy as any
    new Logger().error(new Error('boom'))
    const output = spy.mock.calls[0][0] as string
    expect(output).toContain('boom')
    process.stderr.write = orig
  })
  test('fatal writes to stderr', () => {
    const orig = process.stderr.write; const spy = mock((..._args: any[]) => true); process.stderr.write = spy as any
    new Logger().fatal(new Error('crash'))
    expect(spy).toHaveBeenCalled()
    process.stderr.write = orig
  })
  test('action succeeded', () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    new Logger().action('f.ts').succeeded()
    expect(spy.mock.calls[0][0]).toContain('CREATE')
    spy.mockRestore?.()
  })
  test('action skipped', () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    new Logger().action('f.ts').skipped('exists')
    expect(spy.mock.calls[0][0]).toContain('SKIP')
    spy.mockRestore?.()
  })
  test('action skipped without reason', () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    new Logger().action('f.ts').skipped()
    expect(spy.mock.calls[0][0]).toContain('SKIP')
    spy.mockRestore?.()
  })
  test('action failed', () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    new Logger().action('f.ts').failed('denied')
    expect(spy.mock.calls[0][0]).toContain('ERROR')
    spy.mockRestore?.()
  })
  test('action failed with Error', () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    new Logger().action('f.ts').failed(new Error('boom'))
    expect(spy.mock.calls[0][0]).toContain('boom')
    spy.mockRestore?.()
  })
  test('action displayDuration', () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    new Logger().action('f.ts').displayDuration().succeeded()
    expect(spy.mock.calls[0][0]).toContain('ms')
    spy.mockRestore?.()
  })
})

describe('Table', () => {
  test('renders header and rows', () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    new Table().head(['A', 'B']).row(['1', '2']).render()
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(3) // header + separator + row + empty
    spy.mockRestore?.()
  })
  test('renders without header', () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    new Table().row(['1', '2']).render()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore?.()
  })
  test('right alignment', () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    new Table().head([{ content: 'X', hAlign: 'right' }]).row([{ content: '99', hAlign: 'right' }]).render()
    spy.mockRestore?.()
  })
  test('many rows', () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    const t = new Table().head(['N'])
    for (let i = 0; i < 20; i++) t.row([String(i)])
    t.render()
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(22)
    spy.mockRestore?.()
  })
  test('fullWidth', () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    new Table().head(['A']).row(['1']).fullWidth().render()
    spy.mockRestore?.()
  })
  test('fluidColumnIndex', () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    new Table().head(['A', 'B']).row(['1', '2']).fullWidth().fluidColumnIndex(1).render()
    spy.mockRestore?.()
  })
})

describe('Sticker', () => {
  test('renders boxed content', () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    new Sticker().add('Hello').render()
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(3)
    spy.mockRestore?.()
  })
  test('single line', () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    new Sticker().add('One').render()
    spy.mockRestore?.()
  })
  test('multiple lines', () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    new Sticker().add('A').add('B').add('C').render()
    spy.mockRestore?.()
  })
})

describe('Instructions', () => {
  test('renders with arrows', () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    new Instructions().add('Step 1').render()
    expect(spy.mock.calls.map((c: any) => c[0]).join('\n')).toContain('>')
    spy.mockRestore?.()
  })
  test('multiple steps', () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    new Instructions().add('A').add('B').add('C').render()
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(4) // blank + 3 lines + blank
    spy.mockRestore?.()
  })
})

describe('Tasks', () => {
  test('runs in order', async () => {
    const orig = process.stdout.write; process.stdout.write = mock((..._args: any[]) => true) as any
    const ran: number[] = []
    await new Tasks().add('t1', async () => { ran.push(1); return 'ok' }).add('t2', async () => { ran.push(2); return 'ok' }).run()
    expect(ran).toEqual([1, 2])
    process.stdout.write = orig
  })
  test('error via ctx.error', async () => {
    const orig = process.stdout.write; process.stdout.write = mock((..._args: any[]) => true) as any
    await new Tasks().add('f', async ctx => ctx.error('broke')).run()
    process.stdout.write = orig
  })
  test('exception in handler', async () => {
    const orig = process.stdout.write; process.stdout.write = mock((..._args: any[]) => true) as any
    await new Tasks().add('f', async () => { throw new Error('crash') }).run()
    process.stdout.write = orig
  })
  test('verbose mode logs updates', async () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    await new Tasks({ verbose: true }).add('v', async ctx => { ctx.update('progress'); return 'done' }).run()
    expect(spy.mock.calls.map((c: any) => c[0]).join('\n')).toContain('progress')
    spy.mockRestore?.()
  })
  test('mixed success and failure', async () => {
    const orig = process.stdout.write; process.stdout.write = mock((..._args: any[]) => true) as any
    await new Tasks()
      .add('ok', async () => 'done')
      .add('fail', async ctx => ctx.error('no'))
      .add('ok2', async () => 'done')
      .run()
    process.stdout.write = orig
  })
})

describe('TerminalUI', () => {
  test('table returns Table', () => { expect(new TerminalUI().table()).toBeInstanceOf(Table) })
  test('sticker returns Sticker', () => { expect(new TerminalUI().sticker()).toBeInstanceOf(Sticker) })
  test('instructions returns Instructions', () => { expect(new TerminalUI().instructions()).toBeInstanceOf(Instructions) })
  test('tasks returns Tasks', () => { expect(new TerminalUI().tasks()).toBeInstanceOf(Tasks) })
  test('tasks with verbose', () => { expect(new TerminalUI().tasks({ verbose: true })).toBeInstanceOf(Tasks) })
})

// Integration — 20 tests

describe('Integration', () => {
  test('command with all flag types', () => {
    const r = parse(
      ['user@tekir.dev', '--verbose', '--driver', 'pg', '--port', '5432', '--tags', 'a', '--tags', 'b'],
      { email: { type: 'string' } },
      { verbose: { type: 'boolean' }, driver: { type: 'string' }, port: { type: 'number' }, tags: { type: 'array' } }
    )
    expect(r.args.email).toBe('user@tekir.dev')
    expect(r.flags.verbose).toBe(true)
    expect(r.flags.driver).toBe('pg')
    expect(r.flags.port).toBe(5432)
    expect(r.flags.tags).toEqual(['a', 'b'])
  })
  test('command with no args or flags', () => {
    const r = parse([], {}, {})
    expect(r.args).toEqual({})
    expect(r.flags).toEqual({})
  })
  test('full lifecycle with args', async () => {
    class C extends BaseCommand {
      static commandName = 'greet'
      static args = { name: { type: 'string' as const } }
      static flags = { loud: { type: 'boolean' as const, alias: 'l' }, times: { type: 'number' as const, default: 1 } }
      result = ''
      async run() {
        const name = this.flags.loud ? this.args.name.toUpperCase() : this.args.name
        this.result = Array(this.flags.times).fill(name).join(' ')
      }
    }
    const c = new C()
    c.parsed = parse(['World', '-l', '--times', '3'], C.args, C.flags)
    await c.exec()
    expect(c.result).toBe('WORLD WORLD WORLD')
  })
  test('optional arg + negated boolean', () => {
    const r = parse(['--no-minify'], { env: { type: 'string', required: false, default: 'prod' } }, { minify: { type: 'boolean', default: true } })
    expect(r.args.env).toBe('prod')
    expect(r.flags.minify).toBe(false)
  })
  test('spread + flags', () => {
    const r = parse(['a', 'b', '--dry'], { files: { type: 'spread' } }, { dry: { type: 'boolean' } })
    expect(r.args.files).toEqual(['a', 'b'])
    expect(r.flags.dry).toBe(true)
  })
  test('array flags with arg', () => {
    const r = parse(['test@tekir.dev', '--groups', 'admin', '--groups', 'mod'], { email: { type: 'string' } }, { groups: { type: 'array' } })
    expect(r.args.email).toBe('test@tekir.dev')
    expect(r.flags.groups).toEqual(['admin', 'mod'])
  })
  test('complex parse transforms', () => {
    const r = parse(['hello', '--env', 'PROD'], {
      name: { type: 'string', parse: v => v.charAt(0).toUpperCase() + v.slice(1) },
    }, {
      env: { type: 'string', parse: v => v.toLowerCase() },
    })
    expect(r.args.name).toBe('Hello')
    expect(r.flags.env).toBe('prod')
  })
  test('kernel aliases resolve', () => {
    class C extends BaseCommand { static commandName = 'deploy'; static aliases = ['d', 'push']; async run() {} }
    const spy = mock((..._args: any[]) => {}); console.log = spy
    const k = new Kernel()
    k.register(C as any)
    k.printHelp()
    spy.mockRestore?.()
    // Just verify registration didn't throw
  })
  test('command with description and help', () => {
    class C extends BaseCommand {
      static commandName = 'setup'
      static description = 'Setup project'
      static help = ['Creates config files', 'Runs migrations']
      async run() {}
    }
    expect(C.description).toBe('Setup project')
    expect(C.help).toHaveLength(2)
  })
  test('string flag with equals containing equals', () => {
    const r = parse(['--conn=host=localhost;port=5432'], {}, { conn: { type: 'string' } })
    expect(r.flags.conn).toBe('host=localhost;port=5432')
  })
  test('boolean defaults all set', () => {
    const r = parse([], {}, {
      a: { type: 'boolean', default: true },
      b: { type: 'boolean', default: false },
      c: { type: 'boolean' },
    })
    expect(r.flags.a).toBe(true)
    expect(r.flags.b).toBe(false)
    expect(r.flags.c).toBeUndefined()
  })
  test('multiple commands in kernel', () => {
    class A extends BaseCommand { static commandName = 'a'; async run() {} }
    class B extends BaseCommand { static commandName = 'b'; async run() {} }
    class C extends BaseCommand { static commandName = 'c'; async run() {} }
    const k = new Kernel()
    k.registerAll([A, B, C] as any[])
  })
  test('kernel printHelp with descriptions', () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    class A extends BaseCommand { static commandName = 'serve'; static description = 'Start server'; async run() {} }
    class B extends BaseCommand { static commandName = 'build'; static description = 'Build app'; async run() {} }
    const k = new Kernel()
    k.registerAll([A, B] as any[])
    k.printHelp()
    const out = spy.mock.calls.map((c: any) => c[0]).join('\n')
    expect(out).toContain('Start server')
    expect(out).toContain('Build app')
    spy.mockRestore?.()
  })
  test('arg parse that throws is propagated', () => {
    expect(() => parse(['bad'], {
      email: { type: 'string', parse: (v) => { if (!v.includes('@')) throw new Error('Invalid email'); return v } },
    }, {})).toThrow('Invalid email')
  })
  test('flag parse that throws is propagated', () => {
    expect(() => parse(['--env', 'bad'], {}, {
      env: { type: 'string', parse: (v) => { if (v === 'bad') throw new Error('Bad env'); return v } },
    })).toThrow('Bad env')
  })
  test('prepare can be async with delay', async () => {
    let prepared = false
    class C extends BaseCommand {
      static commandName = 't'
      async prepare() { await new Promise(r => setTimeout(r, 5)); prepared = true }
      async run() { expect(prepared).toBe(true) }
    }
    const c = new C(); c.parsed = { command: 't', args: {}, flags: {}, unknownFlags: [] }
    await c.exec()
  })
  test('run can use logger without error', async () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    class C extends BaseCommand {
      static commandName = 't'
      async run() { this.logger.info('hello'); this.logger.success('done') }
    }
    const c = new C(); c.parsed = { command: 't', args: {}, flags: {}, unknownFlags: [] }
    await c.exec()
    expect(spy.mock.calls.length).toBe(2)
    spy.mockRestore?.()
  })
  test('run can use ui.table', async () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    class C extends BaseCommand {
      static commandName = 't'
      async run() { this.ui.table().head(['A']).row(['1']).render() }
    }
    const c = new C(); c.parsed = { command: 't', args: {}, flags: {}, unknownFlags: [] }
    await c.exec()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore?.()
  })
  test('run can use colors', async () => {
    class C extends BaseCommand {
      static commandName = 't'
      result = ''
      async run() { this.result = this.colors.red('error') }
    }
    const c = new C(); c.parsed = { command: 't', args: {}, flags: {}, unknownFlags: [] }
    await c.exec()
    expect(c.result).toContain('\x1b[31m')
  })
  test('three args + two flags complex', () => {
    const r = parse(
      ['create', 'users', 'table', '--force', '--driver', 'pg'],
      { action: { type: 'string' }, target: { type: 'string' }, what: { type: 'string' } },
      { force: { type: 'boolean' }, driver: { type: 'string' } }
    )
    expect(r.args.action).toBe('create')
    expect(r.args.target).toBe('users')
    expect(r.args.what).toBe('table')
    expect(r.flags.force).toBe(true)
    expect(r.flags.driver).toBe('pg')
  })
  test('Logger with prefix and suffix', () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    new Logger().info('msg', { prefix: 'PID:1', suffix: 'GET /api' })
    const out = spy.mock.calls[0][0]
    expect(out).toContain('msg')
    spy.mockRestore?.()
  })
  test('Table with mixed cell types', () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    new Table()
      .head(['Name', { content: 'Status', hAlign: 'right' }])
      .row(['Alice', { content: colors.green('OK'), hAlign: 'right' }])
      .row(['Bob', 'PENDING'])
      .render()
    spy.mockRestore?.()
  })
  test('single task success', async () => {
    const orig = process.stdout.write; process.stdout.write = mock((..._args: any[]) => true) as any
    let ran = false
    await new Tasks().add('only', async () => { ran = true; return 'ok' }).run()
    expect(ran).toBe(true)
    process.stdout.write = orig
  })
  test('task update message in verbose', async () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    await new Tasks({ verbose: true })
      .add('t', async (ctx) => { ctx.update('50%'); ctx.update('100%'); return 'done' })
      .run()
    const out = spy.mock.calls.map((c: any) => c[0]).join('\n')
    expect(out).toContain('50%')
    expect(out).toContain('100%')
    spy.mockRestore?.()
  })
  test('empty tasks run does not throw', async () => {
    await new Tasks().run()
  })
  test('Sticker with colored content', () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    new Sticker().add(colors.green('Success!')).add(colors.cyan('http://localhost:3000')).render()
    spy.mockRestore?.()
  })
  test('Instructions with single item', () => {
    const spy = mock((..._args: any[]) => {}); console.log = spy
    new Instructions().add('Do the thing').render()
    spy.mockRestore?.()
  })
  test('parse result has command field empty by default', () => {
    expect(parse([], {}, {}).command).toBe('')
  })
  test('parse result unknownFlags defaults to empty', () => {
    expect(parse([], {}, {}).unknownFlags).toEqual([])
  })
  test('flags interleaved with unknown in allowUnknown', () => {
    const r = parse(['--known', '--unknown', '--also'], {}, { known: { type: 'boolean' } }, true)
    expect(r.flags.known).toBe(true)
    expect(r.unknownFlags).toContain('--unknown')
    expect(r.unknownFlags).toContain('--also')
  })
  test('multiple number defaults', () => {
    const r = parse([], {}, {
      port: { type: 'number', default: 3000 },
      workers: { type: 'number', default: 4 },
    })
    expect(r.flags.port).toBe(3000)
    expect(r.flags.workers).toBe(4)
  })
  test('string flag empty string value via equals', () => {
    const r = parse(['--name='], {}, { name: { type: 'string' } })
    expect(r.flags.name).toBe('')
  })
  test('array flag with parse transform', () => {
    const r = parse(['--t', 'a', '--t', 'b'], {}, { t: { type: 'array', parse: v => v.toUpperCase() } })
    expect(r.flags.t).toEqual(['A', 'B'])
  })
  test('BaseCommand.options defaults', () => {
    expect(BaseCommand.options).toEqual({})
  })
  test('command with options startApp and staysAlive', () => {
    class C extends BaseCommand {
      static commandName = 'worker'
      static options = { startApp: true, staysAlive: true, allowUnknownFlags: true }
      async run() {}
    }
    expect(C.options.startApp).toBe(true)
    expect(C.options.staysAlive).toBe(true)
    expect(C.options.allowUnknownFlags).toBe(true)
  })
  test('kernel register returns this', () => {
    class A extends BaseCommand { static commandName = 'a'; async run() {} }
    const k = new Kernel()
    expect(k.register(A as any)).toBe(k)
  })
  test('kernel registerAll returns this', () => {
    const k = new Kernel()
    expect(k.registerAll([])).toBe(k)
  })
  test('Table head returns this', () => {
    const t = new Table()
    expect(t.head(['A'])).toBe(t)
  })
  test('Table row returns this', () => {
    const t = new Table()
    expect(t.row(['A'])).toBe(t)
  })
  test('Table fullWidth returns this', () => {
    expect(new Table().fullWidth()).toBeInstanceOf(Table)
  })
  test('Sticker add returns this', () => {
    expect(new Sticker().add('x')).toBeInstanceOf(Sticker)
  })
  test('Instructions add returns this', () => {
    expect(new Instructions().add('x')).toBeInstanceOf(Instructions)
  })
  test('Tasks add returns this', () => {
    expect(new Tasks().add('x', async () => 'ok')).toBeInstanceOf(Tasks)
  })
  test('flag with alias and default', () => {
    const r = parse(['-v'], {}, { verbose: { type: 'boolean', alias: 'v', default: false } })
    expect(r.flags.verbose).toBe(true)
  })
  test('string arg with unicode', () => {
    expect(parse(['こんにちは'], { name: { type: 'string' } }, {}).args.name).toBe('こんにちは')
  })
  test('string flag with url value', () => {
    expect(parse(['--url', 'https://tekir.dev/api'], {}, { url: { type: 'string' } }).flags.url).toBe('https://tekir.dev/api')
  })
  test('exec preserves app reference', async () => {
    class C extends BaseCommand {
      static commandName = 't'
      ref: any = null
      async run() { this.ref = this.app }
    }
    const fakeApp = { name: 'test' }
    const c = new C()
    c.app = fakeApp
    c.parsed = { command: 't', args: {}, flags: {}, unknownFlags: [] }
    await c.exec()
    expect(c.ref).toBe(fakeApp)
  })
  test('command exec result accessible after', async () => {
    class C extends BaseCommand {
      static commandName = 'calc'
      static args = { a: { type: 'string' as const }, b: { type: 'string' as const } }
      sum = 0
      async run() { this.sum = Number(this.args.a) + Number(this.args.b) }
    }
    const c = new C()
    c.parsed = parse(['3', '7'], C.args, {})
    await c.exec()
    expect(c.sum).toBe(10)
  })
})

// NEW TESTS: Deep edge cases for Commands

describe('Parser — flag edge cases', () => {
  test('unknown long flag throws by default', () => {
    expect(() => parse(['--unknown-flag'], {}, {})).toThrow('Unknown flag')
  })

  test('unknown long flag allowed when allowUnknown is true', () => {
    const result = parse(['--unknown-flag'], {}, {}, true)
    expect(result.unknownFlags).toContain('--unknown-flag')
  })

  test('string flag with equals and empty value', () => {
    expect(parse(['--name='], {}, { name: { type: 'string' } }).flags.name).toBe('')
  })

  test('number flag with equals and zero', () => {
    expect(parse(['--count=0'], {}, { count: { type: 'number' } }).flags.count).toBe(0)
  })

  test('boolean flag with alias -v sets true', () => {
    expect(parse(['-v'], {}, { verbose: { type: 'boolean', alias: 'v' } }).flags.verbose).toBe(true)
  })

  test('multiple array values with equals syntax', () => {
    const result = parse(['--tag=a', '--tag=b'], {}, { tag: { type: 'array' } })
    expect(result.flags.tag).toEqual(['a', 'b'])
  })
})

describe('Parser — args and flags mixed', () => {
  test('args before flags are parsed correctly', () => {
    const r = parse(['myarg', '--verbose'], { name: { type: 'string' } }, { verbose: { type: 'boolean' } })
    expect(r.args.name).toBe('myarg')
    expect(r.flags.verbose).toBe(true)
  })

  test('flags before args are parsed correctly', () => {
    const r = parse(['--verbose', 'myarg'], { name: { type: 'string' } }, { verbose: { type: 'boolean' } })
    expect(r.args.name).toBe('myarg')
    expect(r.flags.verbose).toBe(true)
  })

  test('spread args with flags interleaved', () => {
    const r = parse(['a', '--verbose', 'b', 'c'], { items: { type: 'spread' } }, { verbose: { type: 'boolean' } })
    expect(r.args.items).toEqual(['a', 'b', 'c'])
    expect(r.flags.verbose).toBe(true)
  })
})

describe('Kernel — command registration', () => {
  test('Kernel can be instantiated', () => {
    const kernel = new Kernel()
    expect(kernel).toBeInstanceOf(Kernel)
  })

  test('Kernel.register returns this for chaining', () => {
    class TestCmd extends BaseCommand {
      static commandName = 'test:chain'
      async run() {}
    }
    const kernel = new Kernel()
    expect(kernel.register(TestCmd)).toBe(kernel)
  })

  test('Kernel.register throws for command without commandName', () => {
    class BadCmd extends BaseCommand {
      static commandName = ''
      async run() {}
    }
    const kernel = new Kernel()
    expect(() => kernel.register(BadCmd as any)).toThrow('must have a static commandName')
  })

  test('Kernel.registerAll registers multiple commands', () => {
    class Cmd1 extends BaseCommand { static commandName = 'reg:one'; async run() {} }
    class Cmd2 extends BaseCommand { static commandName = 'reg:two'; async run() {} }
    const kernel = new Kernel()
    kernel.registerAll([Cmd1, Cmd2])
    // No throw means both registered
    expect(kernel).toBeInstanceOf(Kernel)
  })

  test('Kernel.registerAll returns this for chaining', () => {
    const kernel = new Kernel()
    expect(kernel.registerAll([])).toBe(kernel)
  })
})

describe('BaseCommand — description and args metadata', () => {
  test('static description can be set', () => {
    class HelpCmd extends BaseCommand {
      static commandName = 'help'
      static description = 'Show help'
      async run() {}
    }
    expect(HelpCmd.description).toBe('Show help')
  })

  test('static args and flags are accessible on the class', () => {
    class MakeCmd extends BaseCommand {
      static commandName = 'make:model'
      static args = { name: { type: 'string' as const } }
      static flags = { force: { type: 'boolean' as const, alias: 'f' } }
      async run() {}
    }
    expect(MakeCmd.args.name.type).toBe('string')
    expect(MakeCmd.flags.force.type).toBe('boolean')
    expect(MakeCmd.flags.force.alias).toBe('f')
  })
})

describe('Parser — unknown flags with allowUnknown', () => {
  test('unknown long flags are collected in unknownFlags', () => {
    const r = parse(['--unknown', '--also-unknown'], {}, {}, true)
    expect(r.unknownFlags).toContain('--unknown')
    expect(r.unknownFlags).toContain('--also-unknown')
  })
})

describe('Parser — prototype pollution defense', () => {
  test('parsed flags bag has null prototype', () => {
    const r = parse([], {}, { x: { type: 'boolean' } })
    expect(Object.getPrototypeOf(r.flags)).toBeNull()
  })
  test('parsed args bag has null prototype', () => {
    const r = parse(['a'], { name: { type: 'string' } }, {})
    expect(Object.getPrototypeOf(r.args)).toBeNull()
  })
  test('a __proto__ own-key flag definition is rejected', () => {
    const flags: any = {}
    Object.defineProperty(flags, '__proto__', { value: { type: 'boolean' }, enumerable: true, configurable: true })
    expect(() => parse([], {}, flags)).toThrow('Unsafe')
  })
  test('a constructor flag definition is rejected', () => {
    expect(() => parse([], {}, { constructor: { type: 'boolean' } } as any)).toThrow('Unsafe')
  })
  test('a prototype arg definition is rejected', () => {
    expect(() => parse(['x'], { prototype: { type: 'string' } } as any, {})).toThrow('Unsafe')
  })
  test('--__proto__ from argv does not pollute Object.prototype', () => {
    // Unknown flag (no matching def) → throws, never reaches the bag.
    expect(() => parse(['--__proto__', 'x'], {}, {})).toThrow('Unknown flag')
    expect(({} as any).polluted).toBeUndefined()
  })
  test('--__proto__ allowed-unknown is collected raw, not applied', () => {
    const r = parse(['--__proto__=evil'], {}, {}, true)
    expect(r.unknownFlags).toContain('--__proto__=evil')
    expect(({} as any).polluted).toBeUndefined()
  })
})

describe('Parser — negative number flag values', () => {
  test('--offset -5 reads a negative number value', () => {
    expect(parse(['--offset', '-5'], {}, { offset: { type: 'number' } }).flags.offset).toBe(-5)
  })
  test('--rate -0.5 reads a negative decimal', () => {
    expect(parse(['--rate', '-0.5'], {}, { rate: { type: 'number' } }).flags.rate).toBe(-0.5)
  })
  test('still rejects a following flag as the value', () => {
    expect(() => parse(['--name', '--other'], {}, { name: { type: 'string' } })).toThrow('Missing value')
  })
  test('array flag accepts a negative number value', () => {
    expect(parse(['--n', '-3'], {}, { n: { type: 'array' } }).flags.n).toEqual(['-3'])
  })
  test('short flag accepts a negative number value', () => {
    expect(parse(['-o', '-7'], {}, { offset: { type: 'number', alias: 'o' } }).flags.offset).toBe(-7)
  })
})

describe('BaseCommand — exec calls run', () => {
  test('exec calls run and completes', async () => {
    class Simple extends BaseCommand {
      static commandName = 'simple'
      ran = false
      async run() { this.ran = true }
    }
    const c = new Simple()
    c.parsed = { command: 'simple', args: {}, flags: {}, unknownFlags: [] }
    await c.exec()
    expect(c.ran).toBe(true)
  })

  test('exec with args from parsed', async () => {
    class ArgCmd extends BaseCommand {
      static commandName = 'argcmd'
      static args = { input: { type: 'string' as const } }
      result = ''
      async run() { this.result = this.args.input }
    }
    const c = new ArgCmd()
    c.parsed = parse(['hello'], ArgCmd.args, {})
    await c.exec()
    expect(c.result).toBe('hello')
  })

  test('exec with flags from parsed', async () => {
    class FlagCmd extends BaseCommand {
      static commandName = 'flagcmd'
      static flags = { verbose: { type: 'boolean' as const } }
      result = false
      async run() { this.result = this.flags.verbose }
    }
    const c = new FlagCmd()
    c.parsed = parse(['--verbose'], {}, FlagCmd.flags)
    await c.exec()
    expect(c.result).toBe(true)
  })
})
