import { test, expect, describe } from 'bun:test'
import { str, num, bool, port, makeValidator, defineEnv } from '../src/index'

// NOTE: defineEnv() calls envalid's cleanEnv() which validates process.env at
// call-time and throws for missing required vars. We test the re-exported
// validators in isolation, and defineEnv() returns a typed readonly object
// accessed via env.KEY (dot notation).

describe('re-exported envalid validators', () => {
  describe('str()', () => {
    test('str() returns a validator spec', () => {
      const spec = str()
      expect(spec).toBeDefined()
    })

    test('str() with default does not throw when absent', () => {
      const spec = str({ default: 'hello' })
      expect(spec).toBeDefined()
    })
  })

  describe('num()', () => {
    test('num() returns a validator spec', () => {
      const spec = num({ default: 42 })
      expect(spec).toBeDefined()
    })
  })

  describe('bool()', () => {
    test('bool() returns a validator spec', () => {
      const spec = bool({ default: false })
      expect(spec).toBeDefined()
    })
  })

  describe('port()', () => {
    test('port() returns a validator spec', () => {
      const spec = port({ default: 3000 })
      expect(spec).toBeDefined()
    })
  })

  describe('makeValidator()', () => {
    test('makeValidator creates a custom validator factory', () => {
      const csvList = makeValidator<string[]>((input) => {
        return input.split(',').map((s) => s.trim())
      })
      expect(typeof csvList).toBe('function')
    })

    test('makeValidator result is callable as a spec factory', () => {
      const csvList = makeValidator<string[]>((input) => input.split(','))
      const spec = csvList({ default: [] as string[] })
      expect(spec).toBeDefined()
    })
  })
})

describe('defineEnv() with valid process.env vars', () => {
  test('parses a str() field from process.env', () => {
    process.env['TEST_APP_NAME'] = 'myapp'
    const { defineEnv, str: s } = require('../src/index')
    const env = defineEnv({ TEST_APP_NAME: s() })
    expect(env.TEST_APP_NAME).toBe('myapp')
    delete process.env['TEST_APP_NAME']
  })

  test('parses a num() field from process.env', () => {
    process.env['TEST_APP_PORT'] = '4000'
    const { defineEnv, num: n } = require('../src/index')
    const env = defineEnv({ TEST_APP_PORT: n() })
    expect(env.TEST_APP_PORT).toBe(4000)
    delete process.env['TEST_APP_PORT']
  })

  test('parses a bool() field from process.env', () => {
    process.env['TEST_APP_DEBUG'] = 'true'
    const { defineEnv, bool: b } = require('../src/index')
    const env = defineEnv({ TEST_APP_DEBUG: b() })
    expect(env.TEST_APP_DEBUG).toBe(true)
    delete process.env['TEST_APP_DEBUG']
  })

  test('uses default value when var is not set', () => {
    delete process.env['TEST_OPTIONAL_VAR']
    const { defineEnv, str: s } = require('../src/index')
    const env = defineEnv({ TEST_OPTIONAL_VAR: s({ default: 'fallback' }) })
    expect(env.TEST_OPTIONAL_VAR).toBe('fallback')
  })

  test('defineEnv result is readonly-like (has the parsed keys)', () => {
    process.env['TEST_READONLY_KEY'] = 'hello'
    const { defineEnv, str: s } = require('../src/index')
    const env = defineEnv({ TEST_READONLY_KEY: s() })
    expect(env.TEST_READONLY_KEY).toBe('hello')
    delete process.env['TEST_READONLY_KEY']
  })
})

// Validator types — str, num, bool, port in detail

describe('envalid validator types — detailed behaviour', () => {
  test('str() parses environment variable as a string', () => {
    process.env['EV_STR'] = 'hello-world'
    const { defineEnv, str: s } = require('../src/index')
    const env = defineEnv({ EV_STR: s() })
    expect(env.EV_STR).toBe('hello-world')
    expect(typeof env.EV_STR).toBe('string')
    delete process.env['EV_STR']
  })

  test('num() coerces string env var to a number', () => {
    process.env['EV_NUM'] = '123'
    const { defineEnv, num: n } = require('../src/index')
    const env = defineEnv({ EV_NUM: n() })
    expect(env.EV_NUM).toBe(123)
    expect(typeof env.EV_NUM).toBe('number')
    delete process.env['EV_NUM']
  })

  test('bool() coerces "true" to boolean true', () => {
    process.env['EV_BOOL_T'] = 'true'
    const { defineEnv, bool: b } = require('../src/index')
    const env = defineEnv({ EV_BOOL_T: b() })
    expect(env.EV_BOOL_T).toBe(true)
    delete process.env['EV_BOOL_T']
  })

  test('bool() coerces "false" to boolean false', () => {
    process.env['EV_BOOL_F'] = 'false'
    const { defineEnv, bool: b } = require('../src/index')
    const env = defineEnv({ EV_BOOL_F: b() })
    expect(env.EV_BOOL_F).toBe(false)
    delete process.env['EV_BOOL_F']
  })

  test('port() parses a valid port number', () => {
    process.env['EV_PORT'] = '8080'
    const { defineEnv, port: p } = require('../src/index')
    const env = defineEnv({ EV_PORT: p() })
    expect(env.EV_PORT).toBe(8080)
    delete process.env['EV_PORT']
  })

  test('port() with default uses the default when var is absent', () => {
    delete process.env['EV_PORT_DEFAULT']
    const { defineEnv, port: p } = require('../src/index')
    const env = defineEnv({ EV_PORT_DEFAULT: p({ default: 3000 }) })
    expect(env.EV_PORT_DEFAULT).toBe(3000)
  })
})

// Default values

describe('envalid — default values', () => {
  test('str() default used when var is absent', () => {
    delete process.env['EV_STR_DEFAULT']
    const { defineEnv, str: s } = require('../src/index')
    const env = defineEnv({ EV_STR_DEFAULT: s({ default: 'my-default' }) })
    expect(env.EV_STR_DEFAULT).toBe('my-default')
  })

  test('num() default used when var is absent', () => {
    delete process.env['EV_NUM_DEFAULT']
    const { defineEnv, num: n } = require('../src/index')
    const env = defineEnv({ EV_NUM_DEFAULT: n({ default: 99 }) })
    expect(env.EV_NUM_DEFAULT).toBe(99)
  })

  test('bool() default used when var is absent', () => {
    delete process.env['EV_BOOL_DEFAULT']
    const { defineEnv, bool: b } = require('../src/index')
    const env = defineEnv({ EV_BOOL_DEFAULT: b({ default: true }) })
    expect(env.EV_BOOL_DEFAULT).toBe(true)
  })
})

// Validation failures terminate by default, so exercise them in a child Bun
// process instead of leaving these important behavior checks skipped.
function runValidationScript(source: string, envOverrides: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = { ...process.env, ...envOverrides }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete env[key]
  }
  return Bun.spawnSync([process.execPath, '-e', source], {
    cwd: new URL('../../..', import.meta.url).pathname,
    env: env as Record<string, string>,
  })
}

const envEntry = new URL('../src/index.ts', import.meta.url).href

describe('envalid — required field missing', () => {
  test('str() without default exits process when env var is absent', () => {
    const result = runValidationScript(
      `import { defineEnv, str } from ${JSON.stringify(envEntry)}; defineEnv({ EV_REQUIRED_STR: str() })`,
      { EV_REQUIRED_STR: undefined }
    )
    expect(result.exitCode).toBe(1)
    expect(result.stderr.toString()).toContain('EV_REQUIRED_STR')
  })

  test('num() without default exits process when env var is absent', () => {
    const result = runValidationScript(
      `import { defineEnv, num } from ${JSON.stringify(envEntry)}; defineEnv({ EV_REQUIRED_NUM: num() })`,
      { EV_REQUIRED_NUM: undefined }
    )
    expect(result.exitCode).toBe(1)
    expect(result.stderr.toString()).toContain('EV_REQUIRED_NUM')
  })
})

// choices validation

describe('envalid — choices validation', () => {
  test('str() with choices passes when value is in the list', () => {
    process.env['EV_CHOICE'] = 'production'
    const { defineEnv, str: s } = require('../src/index')
    const env = defineEnv({ EV_CHOICE: s({ choices: ['development', 'production', 'test'] }) })
    expect(env.EV_CHOICE).toBe('production')
    delete process.env['EV_CHOICE']
  })

  test('str() with choices exits when value is not in the list', () => {
    const result = runValidationScript(
      `import { defineEnv, str } from ${JSON.stringify(envEntry)}; defineEnv({ EV_CHOICE_BAD: str({ choices: ['a', 'b'] }) })`,
      { EV_CHOICE_BAD: 'not-allowed' }
    )
    expect(result.exitCode).toBe(1)
    expect(result.stderr.toString()).toContain('EV_CHOICE_BAD')
  })
})

// defineEnv — dot notation access

describe('defineEnv — dot notation access for all types', () => {
  test('env.KEY returns a string value', () => {
    process.env['ENV_ADD_STR'] = 'hello'
    const { defineEnv, str: s } = require('../src/index')
    const env = defineEnv({ ENV_ADD_STR: s() })
    expect(env.ENV_ADD_STR).toBe('hello')
    expect(typeof env.ENV_ADD_STR).toBe('string')
    delete process.env['ENV_ADD_STR']
  })

  test('env.KEY returns a number value', () => {
    process.env['ENV_ADD_NUM'] = '9999'
    const { defineEnv, num: n } = require('../src/index')
    const env = defineEnv({ ENV_ADD_NUM: n() })
    expect(env.ENV_ADD_NUM).toBe(9999)
    expect(typeof env.ENV_ADD_NUM).toBe('number')
    delete process.env['ENV_ADD_NUM']
  })

  test('env.KEY returns a boolean value', () => {
    process.env['ENV_ADD_BOOL'] = 'false'
    const { defineEnv, bool: b } = require('../src/index')
    const env = defineEnv({ ENV_ADD_BOOL: b() })
    expect(env.ENV_ADD_BOOL).toBe(false)
    expect(typeof env.ENV_ADD_BOOL).toBe('boolean')
    delete process.env['ENV_ADD_BOOL']
  })

  test('env.KEY returns a port number', () => {
    process.env['ENV_ADD_PORT'] = '443'
    const { defineEnv, port: p } = require('../src/index')
    const env = defineEnv({ ENV_ADD_PORT: p() })
    expect(env.ENV_ADD_PORT).toBe(443)
    delete process.env['ENV_ADD_PORT']
  })
})

describe('defineEnv — accessing keys not in schema throws', () => {
  test('envalid proxy throws for keys not in schema', () => {
    process.env['ENV_DEF_EXIST'] = 'present'
    const { defineEnv, str: s } = require('../src/index')
    const env = defineEnv({ ENV_DEF_EXIST: s() })
    expect(() => (env as any).ENV_NONEXISTENT_KEY).toThrow()
    delete process.env['ENV_DEF_EXIST']
  })

  test('defined key returns correct value', () => {
    process.env['ENV_DEF_EXIST2'] = 'val'
    const { defineEnv, str: s } = require('../src/index')
    const env = defineEnv({ ENV_DEF_EXIST2: s() })
    expect(env.ENV_DEF_EXIST2).toBe('val')
    delete process.env['ENV_DEF_EXIST2']
  })
})

describe('defineEnv — multiple calls (re-initialization)', () => {
  test('second defineEnv call creates a separate env object', () => {
    process.env['REINIT_A'] = 'first'
    const mod = require('../src/index')
    const env1 = mod.defineEnv({ REINIT_A: mod.str() })
    expect(env1.REINIT_A).toBe('first')

    process.env['REINIT_B'] = 'second'
    const env2 = mod.defineEnv({ REINIT_B: mod.str() })
    expect(env2.REINIT_B).toBe('second')
    delete process.env['REINIT_A']
    delete process.env['REINIT_B']
  })
})

describe('envalid validators — url, email, json, host', () => {
  test('url() is exported and returns a validator spec', () => {
    const { url } = require('../src/index')
    const spec = url({ default: 'http://localhost' })
    expect(spec).toBeDefined()
  })

  test('email() is exported and returns a validator spec', () => {
    const { email } = require('../src/index')
    const spec = email({ default: 'test@example.com' })
    expect(spec).toBeDefined()
  })

  test('json() is exported and returns a validator spec', () => {
    const { json } = require('../src/index')
    const spec = json({ default: { key: 'value' } })
    expect(spec).toBeDefined()
  })

  test('host() is exported and returns a validator spec', () => {
    const { host } = require('../src/index')
    const spec = host({ default: 'localhost' })
    expect(spec).toBeDefined()
  })
})

describe('defineEnv — all validator types combined', () => {
  test('parses multiple types in a single defineEnv call', () => {
    process.env['COMBO_STR'] = 'hello'
    process.env['COMBO_NUM'] = '42'
    process.env['COMBO_BOOL'] = 'true'
    process.env['COMBO_PORT'] = '8080'
    const { defineEnv, str: s, num: n, bool: b, port: p } = require('../src/index')
    const env = defineEnv({
      COMBO_STR: s(),
      COMBO_NUM: n(),
      COMBO_BOOL: b(),
      COMBO_PORT: p(),
    })
    expect(env.COMBO_STR).toBe('hello')
    expect(env.COMBO_NUM).toBe(42)
    expect(env.COMBO_BOOL).toBe(true)
    expect(env.COMBO_PORT).toBe(8080)
    delete process.env['COMBO_STR']
    delete process.env['COMBO_NUM']
    delete process.env['COMBO_BOOL']
    delete process.env['COMBO_PORT']
  })
})

describe('defineEnv — dot notation with underscore keys', () => {
  test('underscore-containing env var name accessed via dot notation', () => {
    process.env['APP_DB_HOST'] = 'db.local'
    const { defineEnv, str: s } = require('../src/index')
    const env = defineEnv({ APP_DB_HOST: s() })
    expect(env.APP_DB_HOST).toBe('db.local')
    delete process.env['APP_DB_HOST']
  })
})

describe('boolean environment variable parsing', () => {
  test('bool() parses "true" as true', () => {
    process.env['BOOL_PARSE_T'] = 'true'
    const { defineEnv, bool: b } = require('../src/index')
    const env = defineEnv({ BOOL_PARSE_T: b() })
    expect(env.BOOL_PARSE_T).toBe(true)
    delete process.env['BOOL_PARSE_T']
  })

  test('bool() parses "false" as false', () => {
    process.env['BOOL_PARSE_F'] = 'false'
    const { defineEnv, bool: b } = require('../src/index')
    const env = defineEnv({ BOOL_PARSE_F: b() })
    expect(env.BOOL_PARSE_F).toBe(false)
    delete process.env['BOOL_PARSE_F']
  })

  test('bool() parses "1" as true', () => {
    process.env['BOOL_PARSE_1'] = '1'
    const { defineEnv, bool: b } = require('../src/index')
    const env = defineEnv({ BOOL_PARSE_1: b() })
    expect(env.BOOL_PARSE_1).toBe(true)
    delete process.env['BOOL_PARSE_1']
  })

  test('bool() parses "0" as false', () => {
    process.env['BOOL_PARSE_0'] = '0'
    const { defineEnv, bool: b } = require('../src/index')
    const env = defineEnv({ BOOL_PARSE_0: b() })
    expect(env.BOOL_PARSE_0).toBe(false)
    delete process.env['BOOL_PARSE_0']
  })
})

// Additional validator tests

describe('envalid — str() edge cases', () => {
  test('str() with empty string value', () => {
    process.env['STR_EMPTY'] = ''
    const { defineEnv, str: s } = require('../src/index')
    const env = defineEnv({ STR_EMPTY: s({ default: '' }) })
    expect(env.STR_EMPTY).toBe('')
    delete process.env['STR_EMPTY']
  })

  test('str() with whitespace value', () => {
    process.env['STR_WS'] = '  spaces  '
    const { defineEnv, str: s } = require('../src/index')
    const env = defineEnv({ STR_WS: s() })
    expect(env.STR_WS).toBe('  spaces  ')
    delete process.env['STR_WS']
  })

  test('str() with unicode value', () => {
    process.env['STR_UNI'] = 'こんにちは'
    const { defineEnv, str: s } = require('../src/index')
    const env = defineEnv({ STR_UNI: s() })
    expect(env.STR_UNI).toBe('こんにちは')
    delete process.env['STR_UNI']
  })

  test('str() with very long value', () => {
    process.env['STR_LONG'] = 'x'.repeat(10000)
    const { defineEnv, str: s } = require('../src/index')
    const env = defineEnv({ STR_LONG: s() })
    expect(env.STR_LONG.length).toBe(10000)
    delete process.env['STR_LONG']
  })

  test('str() with special characters', () => {
    process.env['STR_SPECIAL'] = '!@#$%^&*()_+-=[]{}|;:,.<>?'
    const { defineEnv, str: s } = require('../src/index')
    const env = defineEnv({ STR_SPECIAL: s() })
    expect(env.STR_SPECIAL).toBe('!@#$%^&*()_+-=[]{}|;:,.<>?')
    delete process.env['STR_SPECIAL']
  })
})

describe('envalid — num() edge cases', () => {
  test('num() with zero', () => {
    process.env['NUM_ZERO'] = '0'
    const { defineEnv, num: n } = require('../src/index')
    const env = defineEnv({ NUM_ZERO: n() })
    expect(env.NUM_ZERO).toBe(0)
    delete process.env['NUM_ZERO']
  })

  test('num() with negative number', () => {
    process.env['NUM_NEG'] = '-42'
    const { defineEnv, num: n } = require('../src/index')
    const env = defineEnv({ NUM_NEG: n() })
    expect(env.NUM_NEG).toBe(-42)
    delete process.env['NUM_NEG']
  })

  test('num() with float', () => {
    process.env['NUM_FLOAT'] = '3.14'
    const { defineEnv, num: n } = require('../src/index')
    const env = defineEnv({ NUM_FLOAT: n() })
    expect(env.NUM_FLOAT).toBeCloseTo(3.14)
    delete process.env['NUM_FLOAT']
  })

  test('num() with large number', () => {
    process.env['NUM_LARGE'] = '999999999'
    const { defineEnv, num: n } = require('../src/index')
    const env = defineEnv({ NUM_LARGE: n() })
    expect(env.NUM_LARGE).toBe(999999999)
    delete process.env['NUM_LARGE']
  })

  test('num() default value of zero', () => {
    delete process.env['NUM_DEF_ZERO']
    const { defineEnv, num: n } = require('../src/index')
    const env = defineEnv({ NUM_DEF_ZERO: n({ default: 0 }) })
    expect(env.NUM_DEF_ZERO).toBe(0)
  })
})

describe('envalid — port() edge cases', () => {
  test('port() with port 80', () => {
    process.env['PORT_80'] = '80'
    const { defineEnv, port: p } = require('../src/index')
    const env = defineEnv({ PORT_80: p() })
    expect(env.PORT_80).toBe(80)
    delete process.env['PORT_80']
  })

  test('port() with port 443', () => {
    process.env['PORT_443'] = '443'
    const { defineEnv, port: p } = require('../src/index')
    const env = defineEnv({ PORT_443: p() })
    expect(env.PORT_443).toBe(443)
    delete process.env['PORT_443']
  })

  test('port() with port 65535', () => {
    process.env['PORT_MAX'] = '65535'
    const { defineEnv, port: p } = require('../src/index')
    const env = defineEnv({ PORT_MAX: p() })
    expect(env.PORT_MAX).toBe(65535)
    delete process.env['PORT_MAX']
  })

  test('port() with port 1', () => {
    process.env['PORT_MIN'] = '1'
    const { defineEnv, port: p } = require('../src/index')
    const env = defineEnv({ PORT_MIN: p() })
    expect(env.PORT_MIN).toBe(1)
    delete process.env['PORT_MIN']
  })
})

describe('envalid — makeValidator advanced', () => {
  test('makeValidator for comma-separated list', () => {
    const csvList = makeValidator<string[]>((input: string) => {
      return input.split(',').map((s: string) => s.trim())
    })
    process.env['CSV_LIST'] = 'a, b, c'
    const env = defineEnv({ CSV_LIST: csvList() })
    expect(env.CSV_LIST).toEqual(['a', 'b', 'c'])
    delete process.env['CSV_LIST']
  })

  test('makeValidator for integer parsing', () => {
    const int = makeValidator<number>((input: string) => {
      const n = parseInt(input, 10)
      if (isNaN(n)) throw new Error('Not an integer')
      return n
    })
    process.env['MY_INT'] = '42'
    const env = defineEnv({ MY_INT: int() })
    expect(env.MY_INT).toBe(42)
    delete process.env['MY_INT']
  })

  test('makeValidator with default', () => {
    const upper = makeValidator<string>((input: string) => input.toUpperCase())
    delete process.env['UPPER_VAL']
    const env = defineEnv({ UPPER_VAL: upper({ default: 'default' }) })
    expect(env.UPPER_VAL).toBe('default')
  })
})

describe('envalid — url and email validators', () => {
  test('url() parses a URL', () => {
    process.env['URL_VAL'] = 'https://example.com'
    const { defineEnv, url } = require('../src/index')
    const env = defineEnv({ URL_VAL: url() })
    expect(env.URL_VAL).toBe('https://example.com')
    delete process.env['URL_VAL']
  })

  test('url() with path', () => {
    process.env['URL_PATH'] = 'https://example.com/api/v1'
    const { defineEnv, url } = require('../src/index')
    const env = defineEnv({ URL_PATH: url() })
    expect(env.URL_PATH).toBe('https://example.com/api/v1')
    delete process.env['URL_PATH']
  })

  test('email() parses valid email', () => {
    process.env['EMAIL_VAL'] = 'test@example.com'
    const { defineEnv, email } = require('../src/index')
    const env = defineEnv({ EMAIL_VAL: email() })
    expect(env.EMAIL_VAL).toBe('test@example.com')
    delete process.env['EMAIL_VAL']
  })

  test('json() parses JSON string', () => {
    process.env['JSON_VAL'] = '{"key":"value","num":42}'
    const { defineEnv, json } = require('../src/index')
    const env = defineEnv({ JSON_VAL: json() })
    expect(env.JSON_VAL).toEqual({ key: 'value', num: 42 })
    delete process.env['JSON_VAL']
  })

  test('json() parses array JSON', () => {
    process.env['JSON_ARR'] = '[1,2,3]'
    const { defineEnv, json } = require('../src/index')
    const env = defineEnv({ JSON_ARR: json() })
    expect(env.JSON_ARR).toEqual([1, 2, 3])
    delete process.env['JSON_ARR']
  })

  test('host() parses hostname', () => {
    process.env['HOST_VAL'] = '0.0.0.0'
    const { defineEnv, host } = require('../src/index')
    const env = defineEnv({ HOST_VAL: host() })
    expect(env.HOST_VAL).toBe('0.0.0.0')
    delete process.env['HOST_VAL']
  })
})

// Additional edge-case tests for validators

describe('envalid — email() edge cases', () => {
  test('email() parses email with subdomain', () => {
    process.env['EMAIL_SUB'] = 'user@mail.example.co.uk'
    const { defineEnv, email } = require('../src/index')
    const env = defineEnv({ EMAIL_SUB: email() })
    expect(env.EMAIL_SUB).toBe('user@mail.example.co.uk')
    delete process.env['EMAIL_SUB']
  })

  test('email() with default uses the default when absent', () => {
    delete process.env['EMAIL_DEF']
    const { defineEnv, email } = require('../src/index')
    const env = defineEnv({ EMAIL_DEF: email({ default: 'default@example.com' }) })
    expect(env.EMAIL_DEF).toBe('default@example.com')
  })
})

describe('envalid — url() edge cases', () => {
  test('url() parses URL with query string', () => {
    process.env['URL_QS'] = 'https://example.com/search?q=hello&page=1'
    const { defineEnv, url } = require('../src/index')
    const env = defineEnv({ URL_QS: url() })
    expect(env.URL_QS).toBe('https://example.com/search?q=hello&page=1')
    delete process.env['URL_QS']
  })

  test('url() parses URL with port', () => {
    process.env['URL_PORT'] = 'http://localhost:3000/api'
    const { defineEnv, url } = require('../src/index')
    const env = defineEnv({ URL_PORT: url() })
    expect(env.URL_PORT).toBe('http://localhost:3000/api')
    delete process.env['URL_PORT']
  })

  test('url() with default uses the default when absent', () => {
    delete process.env['URL_DEF']
    const { defineEnv, url } = require('../src/index')
    const env = defineEnv({ URL_DEF: url({ default: 'https://fallback.dev' }) })
    expect(env.URL_DEF).toBe('https://fallback.dev')
  })
})

describe('envalid — json() edge cases', () => {
  test('json() parses nested JSON object', () => {
    process.env['JSON_NESTED'] = '{"a":{"b":{"c":true}}}'
    const { defineEnv, json } = require('../src/index')
    const env = defineEnv({ JSON_NESTED: json() })
    expect(env.JSON_NESTED).toEqual({ a: { b: { c: true } } })
    delete process.env['JSON_NESTED']
  })

  test('json() parses JSON with string value', () => {
    process.env['JSON_STR'] = '"just a string"'
    const { defineEnv, json } = require('../src/index')
    const env = defineEnv({ JSON_STR: json() })
    expect(env.JSON_STR).toBe('just a string')
    delete process.env['JSON_STR']
  })

  test('json() with default uses the default when absent', () => {
    delete process.env['JSON_DEF']
    const { defineEnv, json } = require('../src/index')
    const env = defineEnv({ JSON_DEF: json({ default: { fallback: true } }) })
    expect(env.JSON_DEF).toEqual({ fallback: true })
  })

  test('json() parses empty object', () => {
    process.env['JSON_EMPTY'] = '{}'
    const { defineEnv, json } = require('../src/index')
    const env = defineEnv({ JSON_EMPTY: json() })
    expect(env.JSON_EMPTY).toEqual({})
    delete process.env['JSON_EMPTY']
  })
})

describe('envalid — host() edge cases', () => {
  test('host() parses domain name', () => {
    process.env['HOST_DOMAIN'] = 'example.com'
    const { defineEnv, host } = require('../src/index')
    const env = defineEnv({ HOST_DOMAIN: host() })
    expect(env.HOST_DOMAIN).toBe('example.com')
    delete process.env['HOST_DOMAIN']
  })

  test('host() with default uses the default when absent', () => {
    delete process.env['HOST_DEF']
    const { defineEnv, host } = require('../src/index')
    const env = defineEnv({ HOST_DEF: host({ default: '127.0.0.1' }) })
    expect(env.HOST_DEF).toBe('127.0.0.1')
  })
})

describe('envalid — bool() additional edge cases', () => {
  test('bool() default false used when var is absent', () => {
    delete process.env['BOOL_DEF_FALSE']
    const { defineEnv, bool: b } = require('../src/index')
    const env = defineEnv({ BOOL_DEF_FALSE: b({ default: false }) })
    expect(env.BOOL_DEF_FALSE).toBe(false)
  })
})

describe('envalid — str() with choices passes for each valid choice', () => {
  test('str() with choices passes for first choice', () => {
    process.env['CHOICE_FIRST'] = 'development'
    const { defineEnv, str: s } = require('../src/index')
    const env = defineEnv({ CHOICE_FIRST: s({ choices: ['development', 'production', 'test'] }) })
    expect(env.CHOICE_FIRST).toBe('development')
    delete process.env['CHOICE_FIRST']
  })

  test('str() with choices passes for last choice', () => {
    process.env['CHOICE_LAST'] = 'test'
    const { defineEnv, str: s } = require('../src/index')
    const env = defineEnv({ CHOICE_LAST: s({ choices: ['development', 'production', 'test'] }) })
    expect(env.CHOICE_LAST).toBe('test')
    delete process.env['CHOICE_LAST']
  })
})

describe('envalid — num() with negative float', () => {
  test('num() with negative float', () => {
    process.env['NUM_NEG_FLOAT'] = '-2.718'
    const { defineEnv, num: n } = require('../src/index')
    const env = defineEnv({ NUM_NEG_FLOAT: n() })
    expect(env.NUM_NEG_FLOAT).toBeCloseTo(-2.718)
    delete process.env['NUM_NEG_FLOAT']
  })
})
