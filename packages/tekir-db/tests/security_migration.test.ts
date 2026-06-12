import { test, expect, describe } from 'bun:test'
import { SqlCompiler } from '../src/migration/sql_compiler'
import { TableBuilder } from '../src/migration/table_builder'

// Helper to build a table and compile
function compileCreate(name: string, builderFn: (t: TableBuilder) => void, driver = 'sqlite'): string {
  const builder = new TableBuilder()
  builderFn(builder)
  const compiler = new SqlCompiler(driver)
  const ops = [{ type: 'createTable' as const, tableName: name, builder }]
  return compiler.compile(ops)[0]
}

// ═══════════════════════════════════════════════════════════
// Default value escaping
// ═══════════════════════════════════════════════════════════

describe('SqlCompiler — default value SQL injection', () => {
  test('string default with single quote is escaped', () => {
    const sql = compileCreate('users', (t) => {
      t.string('name').defaultTo("O'Brien")
    })
    expect(sql).toContain("DEFAULT 'O''Brien'")
    expect(sql).not.toContain("O'Brien'")
  })

  test('string default with SQL injection is escaped', () => {
    const sql = compileCreate('users', (t) => {
      t.string('role').defaultTo("admin'; DROP TABLE users--")
    })
    expect(sql).toContain("DEFAULT 'admin''; DROP TABLE users--'")
    // The escaped version won't execute as SQL injection
  })

  test('string default with multiple quotes', () => {
    const sql = compileCreate('test', (t) => {
      t.string('data').defaultTo("it''s a ''test''")
    })
    expect(sql).toContain("DEFAULT")
  })

  test('numeric default is not quoted', () => {
    const sql = compileCreate('test', (t) => {
      t.integer('count').defaultTo(0)
    })
    expect(sql).toContain('DEFAULT 0')
  })

  test('boolean default converts to 0/1', () => {
    const sql = compileCreate('test', (t) => {
      t.boolean('active').defaultTo(true)
    })
    expect(sql).toContain('DEFAULT 1')
  })

  test('boolean false default', () => {
    const sql = compileCreate('test', (t) => {
      t.boolean('deleted').defaultTo(false)
    })
    expect(sql).toContain('DEFAULT 0')
  })

  test('now default for sqlite', () => {
    const sql = compileCreate('test', (t) => {
      t.timestamp('created_at').defaultTo('now')
    })
    expect(sql).toContain("DEFAULT (datetime('now'))")
  })

  test('empty string default is safe', () => {
    const sql = compileCreate('test', (t) => {
      t.string('bio').defaultTo('')
    })
    expect(sql).toContain("DEFAULT ''")
  })
})

// ═══════════════════════════════════════════════════════════
// Foreign key action validation
// ═══════════════════════════════════════════════════════════

describe('SqlCompiler — FK action whitelist', () => {
  test('CASCADE is accepted', () => {
    const sql = compileCreate('posts', (t) => {
      t.integer('user_id').references('users', 'id').onDelete('CASCADE')
    })
    expect(sql).toContain('ON DELETE CASCADE')
  })

  test('SET NULL is accepted', () => {
    const sql = compileCreate('posts', (t) => {
      t.integer('user_id').references('users', 'id').onDelete('SET NULL')
    })
    expect(sql).toContain('ON DELETE SET NULL')
  })

  test('SET DEFAULT is accepted', () => {
    const sql = compileCreate('posts', (t) => {
      t.integer('user_id').references('users', 'id').onDelete('SET DEFAULT')
    })
    expect(sql).toContain('ON DELETE SET DEFAULT')
  })

  test('RESTRICT is accepted', () => {
    const sql = compileCreate('posts', (t) => {
      t.integer('user_id').references('users', 'id').onDelete('RESTRICT')
    })
    expect(sql).toContain('ON DELETE RESTRICT')
  })

  test('NO ACTION is accepted', () => {
    const sql = compileCreate('posts', (t) => {
      t.integer('user_id').references('users', 'id').onDelete('NO ACTION')
    })
    expect(sql).toContain('ON DELETE NO ACTION')
  })

  test('case insensitive acceptance', () => {
    const sql = compileCreate('posts', (t) => {
      t.integer('user_id').references('users', 'id').onDelete('cascade')
    })
    expect(sql).toContain('ON DELETE CASCADE')
  })

  test('onUpdate CASCADE is accepted', () => {
    const sql = compileCreate('posts', (t) => {
      t.integer('user_id').references('users', 'id').onUpdate('CASCADE')
    })
    expect(sql).toContain('ON UPDATE CASCADE')
  })

  test('both onDelete and onUpdate work', () => {
    const sql = compileCreate('posts', (t) => {
      t.integer('user_id').references('users', 'id').onDelete('CASCADE').onUpdate('SET NULL')
    })
    expect(sql).toContain('ON DELETE CASCADE')
    expect(sql).toContain('ON UPDATE SET NULL')
  })

  test('rejects SQL injection in onDelete', () => {
    expect(() => {
      compileCreate('posts', (t) => {
        t.integer('user_id').references('users', 'id').onDelete('CASCADE; DROP TABLE users--')
      })
    }).toThrow('Invalid foreign key action')
  })

  test('rejects SQL injection in onUpdate', () => {
    expect(() => {
      compileCreate('posts', (t) => {
        t.integer('user_id').references('users', 'id').onUpdate('CASCADE; DROP TABLE users')
      })
    }).toThrow('Invalid foreign key action')
  })

  test('rejects arbitrary strings', () => {
    expect(() => {
      compileCreate('posts', (t) => {
        t.integer('user_id').references('users', 'id').onDelete('ANYTHING')
      })
    }).toThrow('Invalid foreign key action')
  })

  test('rejects random SQL as action', () => {
    expect(() => {
      compileCreate('posts', (t) => {
        t.integer('user_id').references('users', 'id').onDelete('DROP TABLE users')
      })
    }).toThrow('Invalid foreign key action')
  })

  test('FK references table and column are quoted', () => {
    const sql = compileCreate('posts', (t) => {
      t.integer('user_id').references('users', 'id').onDelete('CASCADE')
    })
    // The compiler should quote table/column in REFERENCES
    expect(sql).toContain('REFERENCES')
  })
})

// ═══════════════════════════════════════════════════════════
// Table name quoting
// ═══════════════════════════════════════════════════════════

describe('SqlCompiler — table name quoting', () => {
  test('CREATE TABLE name is quoted', () => {
    const sql = compileCreate('users', (t) => {
      t.id()
      t.string('name')
    })
    expect(sql).toContain('"users"')
  })

  test('column names are quoted', () => {
    const sql = compileCreate('test', (t) => {
      t.string('user_name')
    })
    expect(sql).toContain('"user_name"')
  })

  test('id column is quoted', () => {
    const sql = compileCreate('test', (t) => {
      t.id()
    })
    expect(sql).toContain('"id"')
  })

  test('all column types produce quoted names', () => {
    const sql = compileCreate('test', (t) => {
      t.string('s')
      t.text('t')
      t.integer('i')
      t.boolean('b')
      t.timestamp('ts')
      t.json('j')
    })
    expect(sql).toContain('"s"')
    expect(sql).toContain('"t"')
    expect(sql).toContain('"i"')
    expect(sql).toContain('"b"')
    expect(sql).toContain('"ts"')
    expect(sql).toContain('"j"')
  })
})

// ═══════════════════════════════════════════════════════════
// Default value edge cases
// ═══════════════════════════════════════════════════════════

describe('SqlCompiler — default value edge cases', () => {
  test('default with backtick is safe (not a SQL escape char in standard SQL)', () => {
    const sql = compileCreate('test', (t) => {
      t.string('data').defaultTo('value`with`backticks')
    })
    expect(sql).toContain("DEFAULT 'value`with`backticks'")
  })

  test('default with backslash', () => {
    const sql = compileCreate('test', (t) => {
      t.string('path').defaultTo('C:\\Users\\test')
    })
    expect(sql).toContain('DEFAULT')
  })

  test('default with percent (LIKE wildcard)', () => {
    const sql = compileCreate('test', (t) => {
      t.string('pattern').defaultTo('%admin%')
    })
    expect(sql).toContain("DEFAULT '%admin%'")
  })

  test('default with semicolons is safe (inside quotes)', () => {
    const sql = compileCreate('test', (t) => {
      t.string('data').defaultTo('a;b;c')
    })
    expect(sql).toContain("DEFAULT 'a;b;c'")
  })

  test('default with double dashes is safe', () => {
    const sql = compileCreate('test', (t) => {
      t.string('data').defaultTo('value--comment')
    })
    expect(sql).toContain("DEFAULT 'value--comment'")
  })

  test('default with parentheses', () => {
    const sql = compileCreate('test', (t) => {
      t.string('data').defaultTo('(test)')
    })
    expect(sql).toContain("DEFAULT '(test)'")
  })

  test('integer default negative value', () => {
    const sql = compileCreate('test', (t) => {
      t.integer('offset').defaultTo(-1)
    })
    expect(sql).toContain('DEFAULT -1')
  })

  test('real/float default', () => {
    const sql = compileCreate('test', (t) => {
      t.real('price').defaultTo(9.99)
    })
    expect(sql).toContain('DEFAULT 9.99')
  })

  test('now default for postgres', () => {
    const sql = compileCreate('test', (t) => {
      t.timestamp('created_at').defaultTo('now')
    }, 'postgres')
    expect(sql).toContain('DEFAULT NOW()')
  })

  test('now default for mysql', () => {
    const sql = compileCreate('test', (t) => {
      t.timestamp('created_at').defaultTo('now')
    }, 'mysql')
    expect(sql).toContain('DEFAULT CURRENT_TIMESTAMP')
  })
})

// ═══════════════════════════════════════════════════════════
// FK injection — comprehensive
// ═══════════════════════════════════════════════════════════

describe('SqlCompiler — FK injection comprehensive', () => {
  test('rejects UNION in onDelete', () => {
    expect(() => {
      compileCreate('posts', (t) => {
        t.integer('user_id').references('users', 'id').onDelete('CASCADE UNION SELECT')
      })
    }).toThrow('Invalid foreign key action')
  })

  test('rejects semicolon in onDelete', () => {
    expect(() => {
      compileCreate('posts', (t) => {
        t.integer('user_id').references('users', 'id').onDelete('CASCADE;')
      })
    }).toThrow('Invalid foreign key action')
  })

  test('rejects comment in onDelete', () => {
    expect(() => {
      compileCreate('posts', (t) => {
        t.integer('user_id').references('users', 'id').onDelete('CASCADE--')
      })
    }).toThrow('Invalid foreign key action')
  })

  test('rejects parentheses in onDelete', () => {
    expect(() => {
      compileCreate('posts', (t) => {
        t.integer('user_id').references('users', 'id').onDelete('CASCADE()')
      })
    }).toThrow('Invalid foreign key action')
  })

  test('all valid actions with onUpdate', () => {
    const actions = ['CASCADE', 'SET NULL', 'SET DEFAULT', 'RESTRICT', 'NO ACTION']
    for (const action of actions) {
      const sql = compileCreate('posts', (t) => {
        t.integer('user_id').references('users', 'id').onUpdate(action)
      })
      expect(sql).toContain(`ON UPDATE ${action}`)
    }
  })

  test('mixed case set null', () => {
    const sql = compileCreate('posts', (t) => {
      t.integer('user_id').references('users', 'id').onDelete('Set Null')
    })
    expect(sql).toContain('ON DELETE SET NULL')
  })

  test('mixed case no action', () => {
    const sql = compileCreate('posts', (t) => {
      t.integer('user_id').references('users', 'id').onDelete('no action')
    })
    expect(sql).toContain('ON DELETE NO ACTION')
  })
})

// ═══════════════════════════════════════════════════════════
// Column constraints
// ═══════════════════════════════════════════════════════════

describe('SqlCompiler — column constraints', () => {
  test('NOT NULL is applied', () => {
    const sql = compileCreate('test', (t) => {
      t.string('name')
    })
    expect(sql).toContain('NOT NULL')
  })

  test('nullable removes NOT NULL', () => {
    const sql = compileCreate('test', (t) => {
      t.string('bio').nullable()
    })
    expect(sql).not.toContain('"bio" TEXT NOT NULL')
  })

  test('unique constraint', () => {
    const sql = compileCreate('test', (t) => {
      t.string('email').unique()
    })
    expect(sql).toContain('UNIQUE')
  })

  test('primary key', () => {
    const sql = compileCreate('test', (t) => {
      t.id()
    })
    expect(sql).toContain('PRIMARY KEY')
  })

  test('multiple columns with constraints', () => {
    const sql = compileCreate('users', (t) => {
      t.id()
      t.string('name')
      t.string('email').unique()
      t.boolean('active').defaultTo(true)
      t.timestamp('created_at').defaultTo('now')
    })
    expect(sql).toContain('"id"')
    expect(sql).toContain('"name"')
    expect(sql).toContain('"email"')
    expect(sql).toContain('UNIQUE')
    expect(sql).toContain('DEFAULT 1')
    expect(sql).toContain("DEFAULT (datetime('now'))")
  })
})
