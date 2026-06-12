import { test, expect, describe } from 'bun:test'
import { validateIdentifier, quoteIdentifier, validateOperator } from '../src/query_builder'

describe('validateIdentifier — OWASP SQLi payloads', () => {
  const payloads = [
    "1' OR '1'='1",
    "1' OR '1'='1'--",
    "1' OR '1'='1'/*",
    "' OR 1=1--",
    "' OR 'x'='x",
    "' AND id IS NOT NULL--",
    "1' ORDER BY 1--",
    "1' UNION SELECT NULL--",
    "1' UNION SELECT 1,2,3--",
    "admin'--",
    "1; DROP TABLE users",
    "1'; EXEC xp_cmdshell('dir')--",
    "' HAVING 1=1--",
    "' GROUP BY columnname HAVING 1=1--",
    "1 AND 1=1",
    "1 AND 1=2",
    "' AND ''='",
    "'; WAITFOR DELAY '0:0:5'--",
    "1) OR (1=1",
    "')) OR (('1'='1",
    "1' AND SLEEP(5)--",
    "1 OR SLEEP(5)",
    "1' AND (SELECT COUNT(*) FROM users)>0--",
    "1' AND SUBSTRING(username,1,1)='a'--",
    "' UNION SELECT username,password FROM users--",
    "1; INSERT INTO users VALUES('hacker','hacked')--",
    "1; UPDATE users SET role='admin'--",
    "1; DELETE FROM users--",
    "1' AND ASCII(SUBSTRING(database(),1,1))>64--",
    "1' AND (SELECT 1 FROM(SELECT COUNT(*),CONCAT(version(),FLOOR(RAND(0)*2))x FROM information_schema.tables GROUP BY x)a)--",
  ]

  for (const p of payloads) {
    test(`rejects: ${p.slice(0, 50)}`, () => {
      expect(() => validateIdentifier(p)).toThrow('Invalid SQL identifier')
    })
  }
})

describe('quoteIdentifier — various formats', () => {
  test('simple name', () => { expect(quoteIdentifier('users')).toBe('"users"') })
  test('with underscore', () => { expect(quoteIdentifier('user_name')).toBe('"user_name"') })
  test('two part', () => { expect(quoteIdentifier('t.col')).toBe('"t"."col"') })
  test('three part', () => { expect(quoteIdentifier('s.t.c')).toBe('"s"."t"."c"') })
  test('single char', () => { expect(quoteIdentifier('a')).toBe('"a"') })
  test('with numbers', () => { expect(quoteIdentifier('col1')).toBe('"col1"') })
  test('underscore only', () => { expect(quoteIdentifier('_')).toBe('"_"') })
  test('rejects injection', () => { expect(() => quoteIdentifier('a; DROP')).toThrow() })
})

describe('validateOperator — all valid operators', () => {
  const valid = ['=', '!=', '<', '>', '<=', '>=', '<>', 'LIKE', 'NOT LIKE', 'IS', 'IS NOT', 'IN', 'NOT IN']
  for (const op of valid) {
    test(`accepts: ${op}`, () => { expect(() => validateOperator(op)).not.toThrow() })
  }

  const invalid = ['OR', 'AND', 'UNION', 'DROP', 'SELECT', 'INSERT', 'DELETE', 'UPDATE', ';', '--', 'EXEC', 'HAVING', 'GROUP', 'ORDER', 'BETWEEN', 'EXISTS', 'ALL', 'ANY']
  for (const op of invalid) {
    test(`rejects: ${op}`, () => { expect(() => validateOperator(op)).toThrow('Invalid SQL operator') })
  }
})
