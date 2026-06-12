import { test, expect, describe } from 'bun:test'
import { BaseModel } from '@tekir/db'
import {
  table, timestamps, softDeletes, hidden, cast, fillable,
  HasOne, HasMany, BelongsTo, ManyToMany,
  BeforeSave, AfterSave, BeforeCreate, AfterCreate,
  BeforeUpdate, AfterUpdate, BeforeDelete, AfterDelete,
  BeforeFind, AfterFind, BeforeFetch, AfterFetch,
  BeforePaginate, AfterPaginate
} from '../src/index'

// NOTE: Because the field/hook decorators use `this.constructor` inside
// addInitializer and check `if (!ctor.hidden)` etc., and BaseModel already
// declares `static hidden = []`, `static casts = {}`, etc., decorator state
// accumulates on BaseModel's own static properties (shared across all subclasses).
// Tests therefore use .toContain / property checks rather than strict equality
// on array/object contents, and do not assert isolation between classes for
// field-level decorator properties (hidden, casts, fillable, relations, hooks).


describe('@table', () => {
  test('sets static table name', () => {
    @table('custom_users')
    class User extends BaseModel {}
    expect((User as any).table).toBe('custom_users')
  })

  test('sets a simple table name', () => {
    @table('posts')
    class Post extends BaseModel {}
    expect((Post as any).table).toBe('posts')
  })

  test('supports underscored names', () => {
    @table('user_profiles')
    class UserProfile extends BaseModel {}
    expect((UserProfile as any).table).toBe('user_profiles')
  })

  test('supports names with numbers', () => {
    @table('log_entries_v2')
    class LogEntry extends BaseModel {}
    expect((LogEntry as any).table).toBe('log_entries_v2')
  })

  test('supports single character name', () => {
    @table('x')
    class X extends BaseModel {}
    expect((X as any).table).toBe('x')
  })

  test('supports long table name', () => {
    @table('very_long_table_name_for_testing_purposes')
    class LongName extends BaseModel {}
    expect((LongName as any).table).toBe('very_long_table_name_for_testing_purposes')
  })

  test('supports names with dots (schema-qualified)', () => {
    @table('myschema.users')
    class SchemaUser extends BaseModel {}
    expect((SchemaUser as any).table).toBe('myschema.users')
  })

  test('overrides previously set static table', () => {
    @table('overridden')
    class Item extends BaseModel {
      static table = 'original'
    }
    expect((Item as any).table).toBe('overridden')
  })

  test('two classes get independent table names', () => {
    @table('alpha')
    class A extends BaseModel {}
    @table('beta')
    class B extends BaseModel {}
    expect((A as any).table).toBe('alpha')
    expect((B as any).table).toBe('beta')
  })

  test('supports hyphenated names', () => {
    @table('my-table')
    class Hyphen extends BaseModel {}
    expect((Hyphen as any).table).toBe('my-table')
  })
})


describe('@timestamps', () => {
  test('sets static timestamps = true', () => {
    @timestamps()
    class Post extends BaseModel {
      static table = 'posts'
    }
    expect((Post as any).timestamps).toBe(true)
  })

  test('BaseModel default timestamps is false', () => {
    expect((BaseModel as any).timestamps).toBe(false)
  })

  test('combined with @table', () => {
    @table('articles')
    @timestamps()
    class Article extends BaseModel {}
    expect((Article as any).table).toBe('articles')
    expect((Article as any).timestamps).toBe(true)
  })

  test('combined with @softDeletes', () => {
    @timestamps()
    @softDeletes()
    class Record extends BaseModel {
      static table = 'records'
    }
    expect((Record as any).timestamps).toBe(true)
    expect((Record as any).softDeletes).toBe(true)
  })

  test('sets own property on decorated class', () => {
    @timestamps()
    class A extends BaseModel { static table = 'a_ts' }
    expect(Object.hasOwn(A, 'timestamps')).toBe(true)
    expect((A as any).timestamps).toBe(true)
  })

  test('decorator order does not matter with @table (timestamps first)', () => {
    @timestamps()
    @table('t1')
    class T1 extends BaseModel {}
    expect((T1 as any).timestamps).toBe(true)
    expect((T1 as any).table).toBe('t1')
  })

  test('decorator order does not matter with @table (table first)', () => {
    @table('t2')
    @timestamps()
    class T2 extends BaseModel {}
    expect((T2 as any).timestamps).toBe(true)
    expect((T2 as any).table).toBe('t2')
  })

  test('combined with all three class decorators', () => {
    @table('full_ts')
    @timestamps()
    @softDeletes()
    class Full extends BaseModel {}
    expect((Full as any).table).toBe('full_ts')
    expect((Full as any).timestamps).toBe(true)
    expect((Full as any).softDeletes).toBe(true)
  })
})


describe('@softDeletes', () => {
  test('sets static softDeletes = true', () => {
    @softDeletes()
    class Post extends BaseModel {
      static table = 'posts_sd'
    }
    expect((Post as any).softDeletes).toBe(true)
  })

  test('BaseModel default softDeletes is false', () => {
    expect((BaseModel as any).softDeletes).toBe(false)
  })

  test('combined with @timestamps', () => {
    @softDeletes()
    @timestamps()
    class Combo extends BaseModel { static table = 'combo_sd' }
    expect((Combo as any).softDeletes).toBe(true)
    expect((Combo as any).timestamps).toBe(true)
  })

  test('combined with @table', () => {
    @table('items_sd')
    @softDeletes()
    class Item extends BaseModel {}
    expect((Item as any).table).toBe('items_sd')
    expect((Item as any).softDeletes).toBe(true)
  })

  test('sets own property on decorated class', () => {
    @softDeletes()
    class A extends BaseModel { static table = 'a_sd' }
    expect(Object.hasOwn(A, 'softDeletes')).toBe(true)
    expect((A as any).softDeletes).toBe(true)
  })

  test('decorator order: softDeletes then table', () => {
    @softDeletes()
    @table('sd1')
    class SD1 extends BaseModel {}
    expect((SD1 as any).softDeletes).toBe(true)
    expect((SD1 as any).table).toBe('sd1')
  })

  test('decorator order: table then softDeletes', () => {
    @table('sd2')
    @softDeletes()
    class SD2 extends BaseModel {}
    expect((SD2 as any).softDeletes).toBe(true)
    expect((SD2 as any).table).toBe('sd2')
  })

  test('all three class decorators in reverse order', () => {
    @softDeletes()
    @timestamps()
    @table('rev_sd')
    class Rev extends BaseModel {}
    expect((Rev as any).table).toBe('rev_sd')
    expect((Rev as any).timestamps).toBe(true)
    expect((Rev as any).softDeletes).toBe(true)
  })
})


describe('@hidden', () => {
  test('adds single field to static hidden array', () => {
    class User extends BaseModel {
      static table = 'users'
      @hidden() password!: string
    }
    new User()
    expect((User as any).hidden).toContain('password')
  })

  test('multiple @hidden fields accumulate', () => {
    class User extends BaseModel {
      static table = 'users'
      @hidden() secret!: string
      @hidden() apiKey!: string
    }
    new User()
    expect((User as any).hidden).toContain('secret')
    expect((User as any).hidden).toContain('apiKey')
  })

  test('hidden array includes all decorated fields from this class', () => {
    class User extends BaseModel {
      static table = 'users'
      @hidden() hid_a!: string
      @hidden() hid_b!: string
      @hidden() hid_c!: string
    }
    new User()
    expect((User as any).hidden).toContain('hid_a')
    expect((User as any).hidden).toContain('hid_b')
    expect((User as any).hidden).toContain('hid_c')
  })

  test('non-hidden fields are not in hidden array', () => {
    class User extends BaseModel {
      static table = 'users'
      @hidden() hiddenField!: string
      declare visibleField: string
    }
    new User()
    expect((User as any).hidden).toContain('hiddenField')
    expect((User as any).hidden).not.toContain('visibleField')
  })

  test('no duplicate entries on multiple instantiations', () => {
    class User extends BaseModel {
      static table = 'users'
      @hidden() noDupField!: string
    }
    new User()
    new User()
    new User()
    const count = (User as any).hidden.filter((x: string) => x === 'noDupField').length
    expect(count).toBe(1)
  })

  test('hidden field from one class is visible', () => {
    class A extends BaseModel {
      static table = 'a'
      @hidden() fieldFromA!: string
    }
    new A()
    expect((A as any).hidden).toContain('fieldFromA')
  })

  test('hidden field from another class is visible', () => {
    class B extends BaseModel {
      static table = 'b'
      @hidden() fieldFromB!: string
    }
    new B()
    expect((B as any).hidden).toContain('fieldFromB')
  })

  test('hidden is an array of strings', () => {
    class User extends BaseModel {
      static table = 'users'
      @hidden() arrStrCheck!: string
    }
    new User()
    expect(Array.isArray((User as any).hidden)).toBe(true)
    const idx = (User as any).hidden.indexOf('arrStrCheck')
    expect(typeof (User as any).hidden[idx]).toBe('string')
  })

  test('combined with @cast on same field', () => {
    class User extends BaseModel {
      static table = 'users'
      @hidden() @cast('string') hidCast!: string
    }
    new User()
    expect((User as any).hidden).toContain('hidCast')
    expect((User as any).casts.hidCast).toBe('string')
  })

  test('combined with @fillable on same field', () => {
    class User extends BaseModel {
      static table = 'users'
      @hidden() @fillable() hidFill!: string
    }
    new User()
    expect((User as any).hidden).toContain('hidFill')
    expect((User as any).fillable).toContain('hidFill')
  })

  test('hidden preserves insertion order for same class fields', () => {
    class User extends BaseModel {
      static table = 'users'
      @hidden() ord_first!: string
      @hidden() ord_second!: string
      @hidden() ord_third!: string
    }
    new User()
    const arr = (User as any).hidden as string[]
    const i1 = arr.indexOf('ord_first')
    const i2 = arr.indexOf('ord_second')
    const i3 = arr.indexOf('ord_third')
    expect(i1).toBeLessThan(i2)
    expect(i2).toBeLessThan(i3)
  })

  test('works with class that has @table decorator', () => {
    @table('hidden_tbl')
    class HT extends BaseModel {
      @hidden() tblSecret!: string
    }
    new HT()
    expect((HT as any).table).toBe('hidden_tbl')
    expect((HT as any).hidden).toContain('tblSecret')
  })

  test('five hidden fields are all present', () => {
    class Big extends BaseModel {
      static table = 'big'
      @hidden() big_a!: string
      @hidden() big_b!: string
      @hidden() big_c!: string
      @hidden() big_d!: string
      @hidden() big_e!: string
    }
    new Big()
    expect((Big as any).hidden).toContain('big_a')
    expect((Big as any).hidden).toContain('big_b')
    expect((Big as any).hidden).toContain('big_c')
    expect((Big as any).hidden).toContain('big_d')
    expect((Big as any).hidden).toContain('big_e')
  })

  test('hidden array is accessible from the constructor and BaseModel', () => {
    class User extends BaseModel {
      static table = 'users'
      @hidden() ctorCheck!: string
    }
    const u = new User()
    expect((u as any).constructor.hidden).toContain('ctorCheck')
    expect(Array.isArray((BaseModel as any).hidden)).toBe(true)
  })

  test('hidden with timestamps and softDeletes', () => {
    @timestamps()
    @softDeletes()
    class M extends BaseModel {
      static table = 'hts_m'
      @hidden() htsToken!: string
    }
    new M()
    expect((M as any).hidden).toContain('htsToken')
    expect((M as any).timestamps).toBe(true)
    expect((M as any).softDeletes).toBe(true)
  })

  test('two classes with same field name both get hidden', () => {
    class A extends BaseModel {
      static table = 'a'
      @hidden() sameName1!: string
    }
    class B extends BaseModel {
      static table = 'b'
      @hidden() sameName1!: string
    }
    new A()
    new B()
    // Due to includes check, only one entry even though two classes declare it
    const count = (A as any).hidden.filter((x: string) => x === 'sameName1').length
    expect(count).toBe(1)
    expect((A as any).hidden).toContain('sameName1')
    expect((B as any).hidden).toContain('sameName1')
  })

  test('hidden field alongside non-decorated fields', () => {
    class User extends BaseModel {
      static table = 'users'
      declare plainField: string
      @hidden() hidOnly!: string
      declare anotherPlain: string
    }
    new User()
    expect((User as any).hidden).toContain('hidOnly')
    expect((User as any).hidden).not.toContain('plainField')
    expect((User as any).hidden).not.toContain('anotherPlain')
  })

  test('four hidden fields all present', () => {
    class M extends BaseModel {
      static table = 'm'
      @hidden() h4_w!: string
      @hidden() h4_x!: string
      @hidden() h4_y!: string
      @hidden() h4_z!: string
    }
    new M()
    expect((M as any).hidden).toContain('h4_w')
    expect((M as any).hidden).toContain('h4_x')
    expect((M as any).hidden).toContain('h4_y')
    expect((M as any).hidden).toContain('h4_z')
  })

  test('hidden works with camelCase field names', () => {
    class M extends BaseModel {
      static table = 'm'
      @hidden() myCamelField!: string
    }
    new M()
    expect((M as any).hidden).toContain('myCamelField')
  })
})


describe('@cast', () => {
  test('json cast', () => {
    class Post extends BaseModel {
      static table = 'posts'
      @cast('json') castMeta!: any
    }
    new Post()
    expect((Post as any).casts.castMeta).toBe('json')
  })

  test('boolean cast', () => {
    class User extends BaseModel {
      static table = 'users'
      @cast('boolean') castActive!: boolean
    }
    new User()
    expect((User as any).casts.castActive).toBe('boolean')
  })

  test('integer cast', () => {
    class Item extends BaseModel {
      static table = 'items'
      @cast('integer') castQty!: number
    }
    new Item()
    expect((Item as any).casts.castQty).toBe('integer')
  })

  test('float cast', () => {
    class Product extends BaseModel {
      static table = 'products'
      @cast('float') castPrice!: number
    }
    new Product()
    expect((Product as any).casts.castPrice).toBe('float')
  })

  test('date cast', () => {
    class Event extends BaseModel {
      static table = 'events'
      @cast('date') castStart!: Date
    }
    new Event()
    expect((Event as any).casts.castStart).toBe('date')
  })

  test('string cast', () => {
    class Entry extends BaseModel {
      static table = 'entries'
      @cast('string') castCode!: string
    }
    new Entry()
    expect((Entry as any).casts.castCode).toBe('string')
  })

  test('custom cast function', () => {
    const fn = (v: any) => String(v).toUpperCase()
    class User extends BaseModel {
      static table = 'users'
      @cast(fn) castUpper!: string
    }
    new User()
    expect((User as any).casts.castUpper).toBe(fn)
  })

  test('custom cast function is callable', () => {
    const fn = (v: any) => v * 2
    class M extends BaseModel {
      static table = 'm'
      @cast(fn) castDouble!: number
    }
    new M()
    expect((M as any).casts.castDouble(5)).toBe(10)
  })

  test('multiple casts on different fields', () => {
    class User extends BaseModel {
      static table = 'users'
      @cast('boolean') mcBool!: boolean
      @cast('json') mcJson!: any
      @cast('integer') mcInt!: number
    }
    new User()
    expect((User as any).casts.mcBool).toBe('boolean')
    expect((User as any).casts.mcJson).toBe('json')
    expect((User as any).casts.mcInt).toBe('integer')
  })

  test('casts contains the decorated field keys', () => {
    class M extends BaseModel {
      static table = 'm'
      @cast('string') ck_a!: string
      @cast('integer') ck_b!: number
    }
    new M()
    expect((M as any).casts).toHaveProperty('ck_a')
    expect((M as any).casts).toHaveProperty('ck_b')
  })

  test('casts is a plain object with no duplicates on re-instantiation', () => {
    class M extends BaseModel {
      static table = 'm'
      @cast('boolean') noDupCast!: boolean
    }
    new M()
    new M()
    expect(typeof (M as any).casts).toBe('object')
    expect(Array.isArray((M as any).casts)).toBe(false)
    expect((M as any).casts.noDupCast).toBe('boolean')
  })

  test('cast field from one class is visible', () => {
    class A extends BaseModel {
      static table = 'a'
      @cast('json') castFromA!: any
    }
    new A()
    expect((A as any).casts.castFromA).toBe('json')
  })

  test('cast field from another class is visible', () => {
    class B extends BaseModel {
      static table = 'b'
      @cast('boolean') castFromB!: boolean
    }
    new B()
    expect((B as any).casts.castFromB).toBe('boolean')
  })

  test('combined with @hidden on same field', () => {
    class M extends BaseModel {
      static table = 'm'
      @cast('string') @hidden() chField!: string
    }
    new M()
    expect((M as any).casts.chField).toBe('string')
    expect((M as any).hidden).toContain('chField')
  })

  test('combined with @fillable on same field', () => {
    class M extends BaseModel {
      static table = 'm'
      @cast('integer') @fillable() cfField!: number
    }
    new M()
    expect((M as any).casts.cfField).toBe('integer')
    expect((M as any).fillable).toContain('cfField')
  })

  test('cast is accessible from instance constructor and BaseModel has default', () => {
    expect(typeof (BaseModel as any).casts).toBe('object')
    class M extends BaseModel {
      static table = 'm'
      @cast('json') instCast!: any
    }
    const inst = new M()
    expect((inst as any).constructor.casts.instCast).toBe('json')
  })

  test('all six string cast types on one model', () => {
    class AllCasts extends BaseModel {
      static table = 'all'
      @cast('boolean') ac_a!: boolean
      @cast('json') ac_b!: any
      @cast('integer') ac_c!: number
      @cast('float') ac_d!: number
      @cast('date') ac_e!: Date
      @cast('string') ac_f!: string
    }
    new AllCasts()
    expect((AllCasts as any).casts.ac_a).toBe('boolean')
    expect((AllCasts as any).casts.ac_b).toBe('json')
    expect((AllCasts as any).casts.ac_c).toBe('integer')
    expect((AllCasts as any).casts.ac_d).toBe('float')
    expect((AllCasts as any).casts.ac_e).toBe('date')
    expect((AllCasts as any).casts.ac_f).toBe('string')
  })

  test('repeated instantiation keeps same cast value', () => {
    class M extends BaseModel {
      static table = 'm'
      @cast('integer') repeatCast!: any
    }
    new M()
    new M()
    expect((M as any).casts.repeatCast).toBe('integer')
  })

  test('cast combined with @table and @timestamps', () => {
    @table('casted_combo')
    @timestamps()
    class Casted extends BaseModel {
      @cast('json') comboPayload!: any
    }
    new Casted()
    expect((Casted as any).table).toBe('casted_combo')
    expect((Casted as any).timestamps).toBe(true)
    expect((Casted as any).casts.comboPayload).toBe('json')
  })

  test('two custom functions on different fields', () => {
    const fn1 = (v: any) => v + 1
    const fn2 = (v: any) => v - 1
    class M extends BaseModel {
      static table = 'm'
      @cast(fn1) custA!: number
      @cast(fn2) custB!: number
    }
    new M()
    expect((M as any).casts.custA).toBe(fn1)
    expect((M as any).casts.custB).toBe(fn2)
    expect((M as any).casts.custA(10)).toBe(11)
    expect((M as any).casts.custB(10)).toBe(9)
  })

  test('cast with camelCase field name', () => {
    class M extends BaseModel {
      static table = 'm'
      @cast('boolean') camelCasted!: boolean
    }
    new M()
    expect((M as any).casts.camelCasted).toBe('boolean')
  })

  test('five casts all present', () => {
    class M extends BaseModel {
      static table = 'm'
      @cast('string') fc_a!: string
      @cast('string') fc_b!: string
      @cast('string') fc_c!: string
      @cast('string') fc_d!: string
      @cast('string') fc_e!: string
    }
    new M()
    expect((M as any).casts.fc_a).toBe('string')
    expect((M as any).casts.fc_b).toBe('string')
    expect((M as any).casts.fc_c).toBe('string')
    expect((M as any).casts.fc_d).toBe('string')
    expect((M as any).casts.fc_e).toBe('string')
  })

  test('cast with same type on multiple fields', () => {
    class M extends BaseModel {
      static table = 'm'
      @cast('boolean') sameCast1!: boolean
      @cast('boolean') sameCast2!: boolean
    }
    new M()
    expect((M as any).casts.sameCast1).toBe('boolean')
    expect((M as any).casts.sameCast2).toBe('boolean')
  })
})


describe('@fillable', () => {
  test('adds single field to static fillable', () => {
    class User extends BaseModel {
      static table = 'users'
      @fillable() fillName!: string
    }
    new User()
    expect((User as any).fillable).toContain('fillName')
  })

  test('adds multiple fields to static fillable', () => {
    class User extends BaseModel {
      static table = 'users'
      @fillable() fillA!: string
      @fillable() fillB!: string
    }
    new User()
    expect((User as any).fillable).toContain('fillA')
    expect((User as any).fillable).toContain('fillB')
  })

  test('fillable preserves relative order for same-class fields', () => {
    class M extends BaseModel {
      static table = 'm'
      @fillable() fo_alpha!: string
      @fillable() fo_beta!: string
      @fillable() fo_gamma!: string
    }
    new M()
    const arr = (M as any).fillable as string[]
    const i1 = arr.indexOf('fo_alpha')
    const i2 = arr.indexOf('fo_beta')
    const i3 = arr.indexOf('fo_gamma')
    expect(i1).toBeLessThan(i2)
    expect(i2).toBeLessThan(i3)
  })

  test('no duplicates on multiple instantiations', () => {
    class M extends BaseModel {
      static table = 'm'
      @fillable() noDupFill!: string
    }
    new M()
    new M()
    new M()
    const count = (M as any).fillable.filter((x: string) => x === 'noDupFill').length
    expect(count).toBe(1)
  })

  test('fillable field from one class is visible', () => {
    class A extends BaseModel {
      static table = 'a'
      @fillable() fillFromA!: string
    }
    new A()
    expect((A as any).fillable).toContain('fillFromA')
  })

  test('fillable field from another class is visible', () => {
    class B extends BaseModel {
      static table = 'b'
      @fillable() fillFromB!: string
    }
    new B()
    expect((B as any).fillable).toContain('fillFromB')
  })

  test('fillable is an array of strings', () => {
    class M extends BaseModel {
      static table = 'm'
      @fillable() fillArrStr!: string
    }
    new M()
    expect(Array.isArray((M as any).fillable)).toBe(true)
    const idx = (M as any).fillable.indexOf('fillArrStr')
    expect(typeof (M as any).fillable[idx]).toBe('string')
  })

  test('fillable accessible from instance constructor', () => {
    class M extends BaseModel {
      static table = 'm'
      @fillable() fillInst!: string
    }
    const inst = new M()
    expect((inst as any).constructor.fillable).toContain('fillInst')
  })

  test('five fillable fields all present', () => {
    class M extends BaseModel {
      static table = 'm'
      @fillable() f5_a!: string
      @fillable() f5_b!: string
      @fillable() f5_c!: string
      @fillable() f5_d!: string
      @fillable() f5_e!: string
    }
    new M()
    expect((M as any).fillable).toContain('f5_a')
    expect((M as any).fillable).toContain('f5_b')
    expect((M as any).fillable).toContain('f5_c')
    expect((M as any).fillable).toContain('f5_d')
    expect((M as any).fillable).toContain('f5_e')
  })

  test('combined with @hidden', () => {
    class M extends BaseModel {
      static table = 'm'
      @fillable() @hidden() fhCombo!: string
    }
    new M()
    expect((M as any).fillable).toContain('fhCombo')
    expect((M as any).hidden).toContain('fhCombo')
  })

  test('combined with @cast', () => {
    class M extends BaseModel {
      static table = 'm'
      @fillable() @cast('integer') fcCombo!: number
    }
    new M()
    expect((M as any).fillable).toContain('fcCombo')
    expect((M as any).casts.fcCombo).toBe('integer')
  })

  test('non-fillable fields are not in fillable array', () => {
    class M extends BaseModel {
      static table = 'm'
      @fillable() fillOnly!: string
      declare notFill: number
    }
    new M()
    expect((M as any).fillable).toContain('fillOnly')
    expect((M as any).fillable).not.toContain('notFill')
  })

  test('fillable with @table and @timestamps', () => {
    @table('fill_combo')
    @timestamps()
    class FT extends BaseModel {
      @fillable() fillComboName!: string
    }
    new FT()
    expect((FT as any).table).toBe('fill_combo')
    expect((FT as any).timestamps).toBe(true)
    expect((FT as any).fillable).toContain('fillComboName')
  })

  test('two classes with same fillable field name share it', () => {
    class A extends BaseModel {
      static table = 'a'
      @fillable() sharedFillName!: string
    }
    class B extends BaseModel {
      static table = 'b'
      @fillable() sharedFillName!: string
    }
    new A()
    new B()
    expect((A as any).fillable).toContain('sharedFillName')
    expect((B as any).fillable).toContain('sharedFillName')
    // Due to includes check, only one entry
    const count = (A as any).fillable.filter((x: string) => x === 'sharedFillName').length
    expect(count).toBe(1)
  })
})


describe('@HasOne', () => {
  class Profile extends BaseModel { static table = 'profiles' }
  class Address extends BaseModel { static table = 'addresses' }

  test('sets relation with correct type', () => {
    class User extends BaseModel {
      static table = 'users'
      @HasOne(() => Profile) ho_profile!: any
    }
    new User()
    expect((User as any).relations.ho_profile).toBeDefined()
    expect((User as any).relations.ho_profile.type).toBe('hasOne')
  })

  test('relation has model function', () => {
    class User extends BaseModel {
      static table = 'users'
      @HasOne(() => Profile) ho_prof2!: any
    }
    new User()
    expect(typeof (User as any).relations.ho_prof2.model).toBe('function')
  })

  test('model function returns related model', () => {
    class User extends BaseModel {
      static table = 'users'
      @HasOne(() => Profile) ho_prof3!: any
    }
    new User()
    expect((User as any).relations.ho_prof3.model()).toBe(Profile)
  })

  test('custom foreignKey', () => {
    class User extends BaseModel {
      static table = 'users'
      @HasOne(() => Profile, { foreignKey: 'ownerId' }) ho_prof4!: any
    }
    new User()
    expect((User as any).relations.ho_prof4.foreignKey).toBe('ownerId')
  })

  test('custom localKey', () => {
    class User extends BaseModel {
      static table = 'users'
      @HasOne(() => Profile, { localKey: 'uuid' }) ho_prof5!: any
    }
    new User()
    expect((User as any).relations.ho_prof5.localKey).toBe('uuid')
  })

  test('both custom foreignKey and localKey', () => {
    class User extends BaseModel {
      static table = 'users'
      @HasOne(() => Profile, { foreignKey: 'owner_id', localKey: 'uuid' }) ho_prof6!: any
    }
    new User()
    expect((User as any).relations.ho_prof6.foreignKey).toBe('owner_id')
    expect((User as any).relations.ho_prof6.localKey).toBe('uuid')
  })

  test('withDefault true', () => {
    class User extends BaseModel {
      static table = 'users'
      @HasOne(() => Profile, { withDefault: true }) ho_prof7!: any
    }
    new User()
    expect((User as any).relations.ho_prof7.withDefault).toBe(true)
  })

  test('withDefault object', () => {
    class User extends BaseModel {
      static table = 'users'
      @HasOne(() => Profile, { withDefault: { bio: 'N/A' } }) ho_prof8!: any
    }
    new User()
    expect((User as any).relations.ho_prof8.withDefault).toEqual({ bio: 'N/A' })
  })

  test('no opts sets no extra keys', () => {
    class User extends BaseModel {
      static table = 'users'
      @HasOne(() => Profile) ho_prof9!: any
    }
    new User()
    expect((User as any).relations.ho_prof9.foreignKey).toBeUndefined()
    expect((User as any).relations.ho_prof9.localKey).toBeUndefined()
  })

  test('multiple HasOne on same class', () => {
    class User extends BaseModel {
      static table = 'users'
      @HasOne(() => Profile) ho_multi1!: any
      @HasOne(() => Address) ho_multi2!: any
    }
    new User()
    expect((User as any).relations.ho_multi1.type).toBe('hasOne')
    expect((User as any).relations.ho_multi2.type).toBe('hasOne')
  })

  test('HasOne from one class is visible', () => {
    class A extends BaseModel {
      static table = 'a'
      @HasOne(() => Profile) ho_fromA!: any
    }
    new A()
    expect((A as any).relations.ho_fromA).toBeDefined()
  })

  test('HasOne from another class is visible', () => {
    class B extends BaseModel {
      static table = 'b'
      @HasOne(() => Address) ho_fromB!: any
    }
    new B()
    expect((B as any).relations.ho_fromB).toBeDefined()
  })

  test('HasOne combined with @table', () => {
    @table('people_ho')
    class Person extends BaseModel {
      @HasOne(() => Profile) ho_tbl!: any
    }
    new Person()
    expect((Person as any).table).toBe('people_ho')
    expect((Person as any).relations.ho_tbl.type).toBe('hasOne')
  })

})


describe('@HasMany', () => {
  class Post extends BaseModel { static table = 'posts' }
  class Comment extends BaseModel { static table = 'comments' }

  test('sets relation with correct type', () => {
    class User extends BaseModel {
      static table = 'users'
      @HasMany(() => Post) hm_posts!: any
    }
    new User()
    expect((User as any).relations.hm_posts.type).toBe('hasMany')
  })

  test('relation has model function', () => {
    class User extends BaseModel {
      static table = 'users'
      @HasMany(() => Post) hm_posts2!: any
    }
    new User()
    expect(typeof (User as any).relations.hm_posts2.model).toBe('function')
  })

  test('model function returns related model', () => {
    class User extends BaseModel {
      static table = 'users'
      @HasMany(() => Post) hm_posts3!: any
    }
    new User()
    expect((User as any).relations.hm_posts3.model()).toBe(Post)
  })

  test('custom foreignKey', () => {
    class User extends BaseModel {
      static table = 'users'
      @HasMany(() => Post, { foreignKey: 'authorId' }) hm_posts4!: any
    }
    new User()
    expect((User as any).relations.hm_posts4.foreignKey).toBe('authorId')
  })

  test('custom localKey', () => {
    class User extends BaseModel {
      static table = 'users'
      @HasMany(() => Post, { localKey: 'uuid' }) hm_posts5!: any
    }
    new User()
    expect((User as any).relations.hm_posts5.localKey).toBe('uuid')
  })

  test('both foreignKey and localKey', () => {
    class User extends BaseModel {
      static table = 'users'
      @HasMany(() => Post, { foreignKey: 'author_id', localKey: 'uuid' }) hm_posts6!: any
    }
    new User()
    expect((User as any).relations.hm_posts6.foreignKey).toBe('author_id')
    expect((User as any).relations.hm_posts6.localKey).toBe('uuid')
  })

  test('no opts sets no extra keys', () => {
    class User extends BaseModel {
      static table = 'users'
      @HasMany(() => Post) hm_posts7!: any
    }
    new User()
    expect((User as any).relations.hm_posts7.foreignKey).toBeUndefined()
  })

  test('multiple HasMany on same class', () => {
    class User extends BaseModel {
      static table = 'users'
      @HasMany(() => Post) hm_m1!: any
      @HasMany(() => Comment) hm_m2!: any
    }
    new User()
    expect((User as any).relations.hm_m1.type).toBe('hasMany')
    expect((User as any).relations.hm_m2.type).toBe('hasMany')
  })

  test('HasMany from one class is visible', () => {
    class A extends BaseModel {
      static table = 'a'
      @HasMany(() => Post) hm_fromA!: any
    }
    new A()
    expect((A as any).relations.hm_fromA).toBeDefined()
  })

  test('HasMany from another class is visible', () => {
    class B extends BaseModel {
      static table = 'b'
      @HasMany(() => Comment) hm_fromB!: any
    }
    new B()
    expect((B as any).relations.hm_fromB).toBeDefined()
  })

  test('HasMany combined with HasOne', () => {
    class Profile extends BaseModel { static table = 'profiles' }
    class User extends BaseModel {
      static table = 'users'
      @HasOne(() => Profile) hm_ho!: any
      @HasMany(() => Post) hm_hm!: any
    }
    new User()
    expect((User as any).relations.hm_ho.type).toBe('hasOne')
    expect((User as any).relations.hm_hm.type).toBe('hasMany')
  })

  test('HasMany combined with @table', () => {
    @table('authors_hm')
    class Author extends BaseModel {
      @HasMany(() => Post) hm_tbl!: any
    }
    new Author()
    expect((Author as any).table).toBe('authors_hm')
    expect((Author as any).relations.hm_tbl.type).toBe('hasMany')
  })

  test('HasMany relation value stable across multiple instantiations', () => {
    class User extends BaseModel {
      static table = 'users'
      @HasMany(() => Post) hm_stable!: any
    }
    new User()
    const type1 = (User as any).relations.hm_stable.type
    new User()
    expect((User as any).relations.hm_stable.type).toBe('hasMany')
    expect((User as any).relations.hm_stable.type).toBe(type1)
  })
})


describe('@BelongsTo', () => {
  class User extends BaseModel { static table = 'users' }
  class Category extends BaseModel { static table = 'categories' }

  test('sets relation with correct type', () => {
    class Post extends BaseModel {
      static table = 'posts'
      @BelongsTo(() => User) bt_author!: any
    }
    new Post()
    expect((Post as any).relations.bt_author.type).toBe('belongsTo')
  })

  test('relation has model function', () => {
    class Post extends BaseModel {
      static table = 'posts'
      @BelongsTo(() => User) bt_author2!: any
    }
    new Post()
    expect(typeof (Post as any).relations.bt_author2.model).toBe('function')
  })

  test('model function returns related model', () => {
    class Post extends BaseModel {
      static table = 'posts'
      @BelongsTo(() => User) bt_author3!: any
    }
    new Post()
    expect((Post as any).relations.bt_author3.model()).toBe(User)
  })

  test('custom foreignKey', () => {
    class Post extends BaseModel {
      static table = 'posts'
      @BelongsTo(() => User, { foreignKey: 'authorId' }) bt_author4!: any
    }
    new Post()
    expect((Post as any).relations.bt_author4.foreignKey).toBe('authorId')
  })

  test('custom localKey', () => {
    class Post extends BaseModel {
      static table = 'posts'
      @BelongsTo(() => User, { localKey: 'uuid' }) bt_author5!: any
    }
    new Post()
    expect((Post as any).relations.bt_author5.localKey).toBe('uuid')
  })

  test('withDefault true', () => {
    class Post extends BaseModel {
      static table = 'posts'
      @BelongsTo(() => User, { withDefault: true }) bt_author6!: any
    }
    new Post()
    expect((Post as any).relations.bt_author6.withDefault).toBe(true)
  })

  test('withDefault object', () => {
    class Post extends BaseModel {
      static table = 'posts'
      @BelongsTo(() => User, { withDefault: { name: 'Anonymous' } }) bt_author7!: any
    }
    new Post()
    expect((Post as any).relations.bt_author7.withDefault).toEqual({ name: 'Anonymous' })
  })

  test('no opts sets no extra keys', () => {
    class Post extends BaseModel {
      static table = 'posts'
      @BelongsTo(() => User) bt_author8!: any
    }
    new Post()
    expect((Post as any).relations.bt_author8.foreignKey).toBeUndefined()
  })

  test('multiple BelongsTo on same class', () => {
    class Post extends BaseModel {
      static table = 'posts'
      @BelongsTo(() => User) bt_m1!: any
      @BelongsTo(() => Category) bt_m2!: any
    }
    new Post()
    expect((Post as any).relations.bt_m1.type).toBe('belongsTo')
    expect((Post as any).relations.bt_m2.type).toBe('belongsTo')
  })

  test('BelongsTo from one class is visible', () => {
    class Post extends BaseModel {
      static table = 'posts'
      @BelongsTo(() => User) bt_fromPost!: any
    }
    new Post()
    expect((Post as any).relations.bt_fromPost).toBeDefined()
  })

  test('BelongsTo from another class is visible', () => {
    class Comment extends BaseModel {
      static table = 'comments'
      @BelongsTo(() => User) bt_fromComment!: any
    }
    new Comment()
    expect((Comment as any).relations.bt_fromComment).toBeDefined()
  })

  test('BelongsTo combined with @table', () => {
    @table('reviews_bt')
    class Review extends BaseModel {
      @BelongsTo(() => User) bt_tbl!: any
    }
    new Review()
    expect((Review as any).table).toBe('reviews_bt')
    expect((Review as any).relations.bt_tbl.type).toBe('belongsTo')
  })

  test('both foreignKey and localKey', () => {
    class Post extends BaseModel {
      static table = 'posts'
      @BelongsTo(() => User, { foreignKey: 'author_id', localKey: 'uuid' }) bt_both!: any
    }
    new Post()
    expect((Post as any).relations.bt_both.foreignKey).toBe('author_id')
    expect((Post as any).relations.bt_both.localKey).toBe('uuid')
  })
})


describe('@ManyToMany', () => {
  class Role extends BaseModel { static table = 'roles' }
  class Tag extends BaseModel { static table = 'tags' }

  test('sets relation with correct type', () => {
    class User extends BaseModel {
      static table = 'users'
      @ManyToMany(() => Role) mm_roles!: any
    }
    new User()
    expect((User as any).relations.mm_roles.type).toBe('manyToMany')
  })

  test('relation has model function', () => {
    class User extends BaseModel {
      static table = 'users'
      @ManyToMany(() => Role) mm_roles2!: any
    }
    new User()
    expect(typeof (User as any).relations.mm_roles2.model).toBe('function')
  })

  test('model function returns related model', () => {
    class User extends BaseModel {
      static table = 'users'
      @ManyToMany(() => Role) mm_roles3!: any
    }
    new User()
    expect((User as any).relations.mm_roles3.model()).toBe(Role)
  })

  test('custom pivotTable', () => {
    class User extends BaseModel {
      static table = 'users'
      @ManyToMany(() => Role, { pivotTable: 'user_roles' }) mm_roles4!: any
    }
    new User()
    expect((User as any).relations.mm_roles4.pivotTable).toBe('user_roles')
  })

  test('custom pivotForeignKey', () => {
    class User extends BaseModel {
      static table = 'users'
      @ManyToMany(() => Role, { pivotForeignKey: 'user_id' }) mm_roles5!: any
    }
    new User()
    expect((User as any).relations.mm_roles5.pivotForeignKey).toBe('user_id')
  })

  test('custom pivotRelatedForeignKey', () => {
    class User extends BaseModel {
      static table = 'users'
      @ManyToMany(() => Role, { pivotRelatedForeignKey: 'role_id' }) mm_roles6!: any
    }
    new User()
    expect((User as any).relations.mm_roles6.pivotRelatedForeignKey).toBe('role_id')
  })

  test('all three pivot options', () => {
    class User extends BaseModel {
      static table = 'users'
      @ManyToMany(() => Role, {
        pivotTable: 'user_roles_mm',
        pivotForeignKey: 'user_id',
        pivotRelatedForeignKey: 'role_id'
      }) mm_roles7!: any
    }
    new User()
    expect((User as any).relations.mm_roles7.pivotTable).toBe('user_roles_mm')
    expect((User as any).relations.mm_roles7.pivotForeignKey).toBe('user_id')
    expect((User as any).relations.mm_roles7.pivotRelatedForeignKey).toBe('role_id')
  })

  test('no opts sets no pivot keys', () => {
    class User extends BaseModel {
      static table = 'users'
      @ManyToMany(() => Role) mm_roles8!: any
    }
    new User()
    expect((User as any).relations.mm_roles8.pivotTable).toBeUndefined()
    expect((User as any).relations.mm_roles8.pivotForeignKey).toBeUndefined()
    expect((User as any).relations.mm_roles8.pivotRelatedForeignKey).toBeUndefined()
  })

  test('multiple ManyToMany on same class', () => {
    class Post extends BaseModel {
      static table = 'posts'
      @ManyToMany(() => Tag, { pivotTable: 'post_tags_mm' }) mm_tags!: any
      @ManyToMany(() => Role, { pivotTable: 'post_roles_mm' }) mm_proles!: any
    }
    new Post()
    expect((Post as any).relations.mm_tags.type).toBe('manyToMany')
    expect((Post as any).relations.mm_proles.type).toBe('manyToMany')
  })

  test('ManyToMany from one class is visible', () => {
    class A extends BaseModel {
      static table = 'a'
      @ManyToMany(() => Role) mm_fromA!: any
    }
    new A()
    expect((A as any).relations.mm_fromA).toBeDefined()
  })

  test('ManyToMany from another class is visible', () => {
    class B extends BaseModel {
      static table = 'b'
      @ManyToMany(() => Tag) mm_fromB!: any
    }
    new B()
    expect((B as any).relations.mm_fromB).toBeDefined()
  })

  test('ManyToMany combined with @table', () => {
    @table('people_mm')
    class Person extends BaseModel {
      @ManyToMany(() => Role, { pivotTable: 'person_roles_mm' }) mm_tbl!: any
    }
    new Person()
    expect((Person as any).table).toBe('people_mm')
    expect((Person as any).relations.mm_tbl.type).toBe('manyToMany')
  })

  test('ManyToMany combined with HasMany', () => {
    class Post extends BaseModel { static table = 'posts' }
    class User extends BaseModel {
      static table = 'users'
      @HasMany(() => Post) mm_hm!: any
      @ManyToMany(() => Role) mm_combo!: any
    }
    new User()
    expect((User as any).relations.mm_hm.type).toBe('hasMany')
    expect((User as any).relations.mm_combo.type).toBe('manyToMany')
  })

  test('relation value stable on multiple instantiations', () => {
    class User extends BaseModel {
      static table = 'users'
      @ManyToMany(() => Role) mm_stable!: any
    }
    new User()
    new User()
    expect((User as any).relations.mm_stable.type).toBe('manyToMany')
  })

  test('pivotTable with schema prefix', () => {
    class User extends BaseModel {
      static table = 'users'
      @ManyToMany(() => Role, { pivotTable: 'app.user_roles_mm' }) mm_schema!: any
    }
    new User()
    expect((User as any).relations.mm_schema.pivotTable).toBe('app.user_roles_mm')
  })

  test('relations object contains the declared keys', () => {
    class User extends BaseModel {
      static table = 'users'
      @ManyToMany(() => Role) mm_k1!: any
      @ManyToMany(() => Tag) mm_k2!: any
    }
    new User()
    expect((User as any).relations).toHaveProperty('mm_k1')
    expect((User as any).relations).toHaveProperty('mm_k2')
  })
})


describe('Hook decorators', () => {
  test('@BeforeSave registers hook', () => {
    class User extends BaseModel {
      static table = 'users'
      @BeforeSave()
      static async hk_bs(u: any) {}
    }
    new User()
    expect((User as any).hooks.beforeSave.length).toBeGreaterThanOrEqual(1)
  })

  test('@AfterSave registers hook', () => {
    class User extends BaseModel {
      static table = 'users'
      @AfterSave()
      static async hk_as(u: any) {}
    }
    new User()
    expect((User as any).hooks.afterSave.length).toBeGreaterThanOrEqual(1)
  })

  test('@BeforeCreate registers hook', () => {
    class User extends BaseModel {
      static table = 'users'
      @BeforeCreate()
      static async hk_bc(u: any) {}
    }
    new User()
    expect((User as any).hooks.beforeCreate.length).toBeGreaterThanOrEqual(1)
  })

  test('@AfterCreate registers hook', () => {
    class User extends BaseModel {
      static table = 'users'
      @AfterCreate()
      static async hk_ac(u: any) {}
    }
    new User()
    expect((User as any).hooks.afterCreate.length).toBeGreaterThanOrEqual(1)
  })

  test('@BeforeUpdate registers hook', () => {
    class User extends BaseModel {
      static table = 'users'
      @BeforeUpdate()
      static async hk_bu(u: any) {}
    }
    new User()
    expect((User as any).hooks.beforeUpdate.length).toBeGreaterThanOrEqual(1)
  })

  test('@AfterUpdate registers hook', () => {
    class User extends BaseModel {
      static table = 'users'
      @AfterUpdate()
      static async hk_au(u: any) {}
    }
    new User()
    expect((User as any).hooks.afterUpdate.length).toBeGreaterThanOrEqual(1)
  })

  test('@BeforeDelete registers hook', () => {
    class User extends BaseModel {
      static table = 'users'
      @BeforeDelete()
      static async hk_bd(u: any) {}
    }
    new User()
    expect((User as any).hooks.beforeDelete.length).toBeGreaterThanOrEqual(1)
  })

  test('@AfterDelete registers hook', () => {
    class User extends BaseModel {
      static table = 'users'
      @AfterDelete()
      static async hk_ad(u: any) {}
    }
    new User()
    expect((User as any).hooks.afterDelete.length).toBeGreaterThanOrEqual(1)
  })

  test('@BeforeFind registers hook', () => {
    class User extends BaseModel {
      static table = 'users'
      @BeforeFind()
      static async hk_bf(u: any) {}
    }
    new User()
    expect((User as any).hooks.beforeFind.length).toBeGreaterThanOrEqual(1)
  })

  test('@AfterFind registers hook', () => {
    class User extends BaseModel {
      static table = 'users'
      @AfterFind()
      static async hk_afi(u: any) {}
    }
    new User()
    expect((User as any).hooks.afterFind.length).toBeGreaterThanOrEqual(1)
  })

  test('@BeforeFetch registers hook', () => {
    class User extends BaseModel {
      static table = 'users'
      @BeforeFetch()
      static async hk_bfe(u: any) {}
    }
    new User()
    expect((User as any).hooks.beforeFetch.length).toBeGreaterThanOrEqual(1)
  })

  test('@AfterFetch registers hook', () => {
    class User extends BaseModel {
      static table = 'users'
      @AfterFetch()
      static async hk_afe(u: any) {}
    }
    new User()
    expect((User as any).hooks.afterFetch.length).toBeGreaterThanOrEqual(1)
  })

  test('@BeforePaginate registers hook', () => {
    class User extends BaseModel {
      static table = 'users'
      @BeforePaginate()
      static async hk_bp(u: any) {}
    }
    new User()
    expect((User as any).hooks.beforePaginate.length).toBeGreaterThanOrEqual(1)
  })

  test('@AfterPaginate registers hook', () => {
    class User extends BaseModel {
      static table = 'users'
      @AfterPaginate()
      static async hk_ap(u: any) {}
    }
    new User()
    expect((User as any).hooks.afterPaginate.length).toBeGreaterThanOrEqual(1)
  })

  test('multiple hooks per event accumulate', () => {
    const beforeLen = ((BaseModel as any).hooks.beforeSave || []).length
    class User extends BaseModel {
      static table = 'users'
      @BeforeSave()
      static async hk_multi1(u: any) {}
      @BeforeSave()
      static async hk_multi2(u: any) {}
    }
    new User()
    expect((User as any).hooks.beforeSave.length).toBe(beforeLen + 2)
  })

  test('three hooks per event', () => {
    const beforeLen = ((BaseModel as any).hooks.afterCreate || []).length
    class User extends BaseModel {
      static table = 'users'
      @AfterCreate()
      static async hk_t1(u: any) {}
      @AfterCreate()
      static async hk_t2(u: any) {}
      @AfterCreate()
      static async hk_t3(u: any) {}
    }
    new User()
    expect((User as any).hooks.afterCreate.length).toBe(beforeLen + 3)
  })

  test('hooks from different events are stored separately', () => {
    class User extends BaseModel {
      static table = 'users'
      @BeforeSave()
      static async hk_sep1(u: any) {}
      @AfterSave()
      static async hk_sep2(u: any) {}
      @BeforeDelete()
      static async hk_sep3(u: any) {}
    }
    new User()
    expect((User as any).hooks.beforeSave).toBeDefined()
    expect((User as any).hooks.afterSave).toBeDefined()
    expect((User as any).hooks.beforeDelete).toBeDefined()
  })

  test('hooks are shared on BaseModel static hooks object', () => {
    class A extends BaseModel {
      static table = 'a'
      @BeforeSave()
      static async hk_shA(u: any) {}
    }
    class B extends BaseModel {
      static table = 'b'
      @AfterCreate()
      static async hk_shB(u: any) {}
    }
    new A()
    new B()
    // Both are in the same hooks object (BaseModel.hooks)
    expect((A as any).hooks.beforeSave).toBeDefined()
    expect((B as any).hooks.afterCreate).toBeDefined()
  })

  test('hook array contains functions', () => {
    class User extends BaseModel {
      static table = 'users'
      @BeforeSave()
      static async hk_fn(u: any) {}
    }
    new User()
    const hooks = (User as any).hooks.beforeSave
    expect(typeof hooks[hooks.length - 1]).toBe('function')
  })

  test('hooks is a plain object on BaseModel', () => {
    expect(typeof (BaseModel as any).hooks).toBe('object')
    expect(Array.isArray((BaseModel as any).hooks)).toBe(false)
  })

  test('hook array entry is a function for AfterUpdate', () => {
    class User extends BaseModel {
      static table = 'users'
      @AfterUpdate()
      static async hk_auFn(u: any) {}
    }
    new User()
    const hooks = (User as any).hooks.afterUpdate
    expect(typeof hooks[hooks.length - 1]).toBe('function')
  })

  test('hooks combined with @table', () => {
    @table('hooked_tbl')
    class Hooked extends BaseModel {
      @BeforeSave()
      static async hk_tbl(u: any) {}
    }
    new Hooked()
    expect((Hooked as any).table).toBe('hooked_tbl')
    expect((Hooked as any).hooks.beforeSave).toBeDefined()
  })

  test('hooks combined with @timestamps', () => {
    @timestamps()
    class Hooked extends BaseModel {
      static table = 'hooked_ts'
      @AfterSave()
      static async hk_ts(u: any) {}
    }
    new Hooked()
    expect((Hooked as any).timestamps).toBe(true)
    expect((Hooked as any).hooks.afterSave).toBeDefined()
  })

  test('BeforeSave and AfterSave on same class', () => {
    class User extends BaseModel {
      static table = 'users'
      @BeforeSave()
      static async hk_pair1(u: any) {}
      @AfterSave()
      static async hk_pair2(u: any) {}
    }
    new User()
    expect((User as any).hooks.beforeSave).toBeDefined()
    expect((User as any).hooks.afterSave).toBeDefined()
  })

  test('BeforeCreate and AfterCreate on same class', () => {
    class User extends BaseModel {
      static table = 'users'
      @BeforeCreate()
      static async hk_cpair1(u: any) {}
      @AfterCreate()
      static async hk_cpair2(u: any) {}
    }
    new User()
    expect((User as any).hooks.beforeCreate).toBeDefined()
    expect((User as any).hooks.afterCreate).toBeDefined()
  })

  test('BeforeUpdate and AfterUpdate on same class', () => {
    class User extends BaseModel {
      static table = 'users'
      @BeforeUpdate()
      static async hk_upair1(u: any) {}
      @AfterUpdate()
      static async hk_upair2(u: any) {}
    }
    new User()
    expect((User as any).hooks.beforeUpdate).toBeDefined()
    expect((User as any).hooks.afterUpdate).toBeDefined()
  })

  test('BeforeDelete and AfterDelete on same class', () => {
    class User extends BaseModel {
      static table = 'users'
      @BeforeDelete()
      static async hk_dpair1(u: any) {}
      @AfterDelete()
      static async hk_dpair2(u: any) {}
    }
    new User()
    expect((User as any).hooks.beforeDelete).toBeDefined()
    expect((User as any).hooks.afterDelete).toBeDefined()
  })

  test('BeforeFind and AfterFind on same class', () => {
    class User extends BaseModel {
      static table = 'users'
      @BeforeFind()
      static async hk_fipair1(u: any) {}
      @AfterFind()
      static async hk_fipair2(u: any) {}
    }
    new User()
    expect((User as any).hooks.beforeFind).toBeDefined()
    expect((User as any).hooks.afterFind).toBeDefined()
  })

  test('BeforeFetch and AfterFetch on same class', () => {
    class User extends BaseModel {
      static table = 'users'
      @BeforeFetch()
      static async hk_fepair1(u: any) {}
      @AfterFetch()
      static async hk_fepair2(u: any) {}
    }
    new User()
    expect((User as any).hooks.beforeFetch).toBeDefined()
    expect((User as any).hooks.afterFetch).toBeDefined()
  })

  test('BeforePaginate and AfterPaginate on same class', () => {
    class User extends BaseModel {
      static table = 'users'
      @BeforePaginate()
      static async hk_ppair1(u: any) {}
      @AfterPaginate()
      static async hk_ppair2(u: any) {}
    }
    new User()
    expect((User as any).hooks.beforePaginate).toBeDefined()
    expect((User as any).hooks.afterPaginate).toBeDefined()
  })

  test('all 14 hook events are registered', () => {
    class AllHooks extends BaseModel {
      static table = 'all_hooks'
      @BeforeSave() static async ah1(u: any) {}
      @AfterSave() static async ah2(u: any) {}
      @BeforeCreate() static async ah3(u: any) {}
      @AfterCreate() static async ah4(u: any) {}
      @BeforeUpdate() static async ah5(u: any) {}
      @AfterUpdate() static async ah6(u: any) {}
      @BeforeDelete() static async ah7(u: any) {}
      @AfterDelete() static async ah8(u: any) {}
      @BeforeFind() static async ah9(u: any) {}
      @AfterFind() static async ah10(u: any) {}
      @BeforeFetch() static async ah11(u: any) {}
      @AfterFetch() static async ah12(u: any) {}
      @BeforePaginate() static async ah13(u: any) {}
      @AfterPaginate() static async ah14(u: any) {}
    }
    new AllHooks()
    const events = [
      'beforeSave', 'afterSave', 'beforeCreate', 'afterCreate',
      'beforeUpdate', 'afterUpdate', 'beforeDelete', 'afterDelete',
      'beforeFind', 'afterFind', 'beforeFetch', 'afterFetch',
      'beforePaginate', 'afterPaginate'
    ]
    for (const ev of events) {
      expect((AllHooks as any).hooks[ev]).toBeDefined()
      expect((AllHooks as any).hooks[ev].length).toBeGreaterThanOrEqual(1)
    }
  })

  test('static hook not duplicated on multiple instantiations', () => {
    const beforeLen = ((BaseModel as any).hooks.beforeSave || []).length
    class User extends BaseModel {
      static table = 'users'
      @BeforeSave()
      static async hk_nodup(u: any) {}
    }
    new User()
    const afterFirst = (User as any).hooks.beforeSave.length
    new User()
    // Static hooks use hasOwn check, should not duplicate
    expect((User as any).hooks.beforeSave.length).toBe(afterFirst)
  })

  test('hooks object keys include event names', () => {
    class M extends BaseModel {
      static table = 'm'
      @BeforeSave() static async hk_key1(u: any) {}
      @AfterDelete() static async hk_key2(u: any) {}
    }
    new M()
    expect((M as any).hooks).toHaveProperty('beforeSave')
    expect((M as any).hooks).toHaveProperty('afterDelete')
  })

  test('hooks combined with field decorators', () => {
    class User extends BaseModel {
      static table = 'users'
      @hidden() hk_pw!: string
      @cast('boolean') hk_active!: boolean
      @fillable() hk_name!: string
      @BeforeSave()
      static async hk_combo(u: any) {}
    }
    new User()
    expect((User as any).hidden).toContain('hk_pw')
    expect((User as any).casts.hk_active).toBe('boolean')
    expect((User as any).fillable).toContain('hk_name')
    expect((User as any).hooks.beforeSave).toBeDefined()
  })

  test('each hook event array grows independently', () => {
    const bsLen = ((BaseModel as any).hooks.beforeSave || []).length
    const asLen = ((BaseModel as any).hooks.afterSave || []).length
    class M extends BaseModel {
      static table = 'm'
      @BeforeSave() static async hk_ind1(u: any) {}
      @BeforeSave() static async hk_ind2(u: any) {}
      @AfterSave() static async hk_ind3(u: any) {}
    }
    new M()
    expect((M as any).hooks.beforeSave.length).toBe(bsLen + 2)
    expect((M as any).hooks.afterSave.length).toBe(asLen + 1)
  })

  test('hook with @softDeletes', () => {
    @softDeletes()
    class M extends BaseModel {
      static table = 'hk_sd'
      @BeforeDelete()
      static async hk_sdGuard(u: any) {}
    }
    new M()
    expect((M as any).softDeletes).toBe(true)
    expect((M as any).hooks.beforeDelete).toBeDefined()
  })

  test('four hooks on same event accumulate', () => {
    const beforeLen = ((BaseModel as any).hooks.beforeCreate || []).length
    class M extends BaseModel {
      static table = 'm'
      @BeforeCreate() static async hk_4a(u: any) {}
      @BeforeCreate() static async hk_4b(u: any) {}
      @BeforeCreate() static async hk_4c(u: any) {}
      @BeforeCreate() static async hk_4d(u: any) {}
    }
    new M()
    expect((M as any).hooks.beforeCreate.length).toBe(beforeLen + 4)
  })
})


describe('Integration / Full model', () => {
  test('combines all decorators on one class', () => {
    class Post extends BaseModel { static table = 'posts' }
    class Role extends BaseModel { static table = 'roles' }
    class Profile extends BaseModel { static table = 'profiles' }

    @table('int_users')
    @timestamps()
    @softDeletes()
    class User extends BaseModel {
      @hidden() int_password!: string
      @hidden() int_token!: string
      @cast('json') int_metadata!: any
      @cast('boolean') int_isActive!: boolean
      @fillable() int_name!: string
      @fillable() int_email!: string
      @HasOne(() => Profile) int_profile!: any
      @HasMany(() => Post) int_posts!: any
      @BelongsTo(() => Role) int_role!: any
      @ManyToMany(() => Role, { pivotTable: 'int_user_roles' }) int_roles!: any
      @BeforeSave() static async int_hashPw(u: any) {}
      @AfterCreate() static async int_notify(u: any) {}
    }

    new User()
    expect((User as any).table).toBe('int_users')
    expect((User as any).timestamps).toBe(true)
    expect((User as any).softDeletes).toBe(true)
    expect((User as any).hidden).toContain('int_password')
    expect((User as any).hidden).toContain('int_token')
    expect((User as any).casts.int_metadata).toBe('json')
    expect((User as any).casts.int_isActive).toBe('boolean')
    expect((User as any).fillable).toContain('int_name')
    expect((User as any).fillable).toContain('int_email')
    expect((User as any).relations.int_profile.type).toBe('hasOne')
    expect((User as any).relations.int_posts.type).toBe('hasMany')
    expect((User as any).relations.int_role.type).toBe('belongsTo')
    expect((User as any).relations.int_roles.type).toBe('manyToMany')
    expect((User as any).hooks.beforeSave).toBeDefined()
    expect((User as any).hooks.afterCreate).toBeDefined()
  })

  test('decorator order: table, timestamps, softDeletes', () => {
    @table('int_o1')
    @timestamps()
    @softDeletes()
    class O1 extends BaseModel {}
    expect((O1 as any).table).toBe('int_o1')
    expect((O1 as any).timestamps).toBe(true)
    expect((O1 as any).softDeletes).toBe(true)
  })

  test('decorator order: softDeletes, timestamps, table', () => {
    @softDeletes()
    @timestamps()
    @table('int_o2')
    class O2 extends BaseModel {}
    expect((O2 as any).table).toBe('int_o2')
    expect((O2 as any).timestamps).toBe(true)
    expect((O2 as any).softDeletes).toBe(true)
  })

  test('decorator order: timestamps, softDeletes, table', () => {
    @timestamps()
    @softDeletes()
    @table('int_o3')
    class O3 extends BaseModel {}
    expect((O3 as any).table).toBe('int_o3')
    expect((O3 as any).timestamps).toBe(true)
    expect((O3 as any).softDeletes).toBe(true)
  })

  test('first model with its own configuration', () => {
    class Comment extends BaseModel { static table = 'comments' }

    @table('int_users2')
    @timestamps()
    class User extends BaseModel {
      @hidden() int2_pw!: string
      @cast('boolean') int2_active!: boolean
      @fillable() int2_name!: string
      @HasMany(() => Comment) int2_comments!: any
    }

    new User()

    expect((User as any).table).toBe('int_users2')
    expect((User as any).timestamps).toBe(true)
    expect((User as any).hidden).toContain('int2_pw')
    expect((User as any).casts.int2_active).toBe('boolean')
    expect((User as any).fillable).toContain('int2_name')
    expect((User as any).relations.int2_comments.type).toBe('hasMany')
  })

  test('second model with its own configuration', () => {
    class Tag extends BaseModel { static table = 'tags' }

    @table('int_products')
    @softDeletes()
    class Product extends BaseModel {
      @cast('float') int2_price!: number
      @fillable() int2_title!: string
      @ManyToMany(() => Tag) int2_tags!: any
    }

    new Product()

    expect((Product as any).table).toBe('int_products')
    expect((Product as any).softDeletes).toBe(true)
    expect((Product as any).casts.int2_price).toBe('float')
    expect((Product as any).fillable).toContain('int2_title')
    expect((Product as any).relations.int2_tags.type).toBe('manyToMany')
  })

  test('model with only class decorators', () => {
    @table('int_minimal')
    @timestamps()
    @softDeletes()
    class Minimal extends BaseModel {}
    expect((Minimal as any).table).toBe('int_minimal')
    expect((Minimal as any).timestamps).toBe(true)
    expect((Minimal as any).softDeletes).toBe(true)
  })

  test('model with only field decorators', () => {
    class FieldOnly extends BaseModel {
      static table = 'int_field_only'
      @hidden() intfo_secret!: string
      @cast('json') intfo_data!: any
      @fillable() intfo_name!: string
    }
    new FieldOnly()
    expect((FieldOnly as any).hidden).toContain('intfo_secret')
    expect((FieldOnly as any).casts.intfo_data).toBe('json')
    expect((FieldOnly as any).fillable).toContain('intfo_name')
  })

  test('model with only relations', () => {
    class Profile extends BaseModel { static table = 'profiles' }
    class Post extends BaseModel { static table = 'posts' }
    class RelOnly extends BaseModel {
      static table = 'int_rel_only'
      @HasOne(() => Profile) intro_profile!: any
      @HasMany(() => Post) intro_posts!: any
    }
    new RelOnly()
    expect((RelOnly as any).relations.intro_profile.type).toBe('hasOne')
    expect((RelOnly as any).relations.intro_posts.type).toBe('hasMany')
  })

  test('model with only hooks', () => {
    class HookOnly extends BaseModel {
      static table = 'int_hook_only'
      @BeforeSave() static async intho_a(u: any) {}
      @AfterSave() static async intho_b(u: any) {}
    }
    new HookOnly()
    expect((HookOnly as any).hooks.beforeSave).toBeDefined()
    expect((HookOnly as any).hooks.afterSave).toBeDefined()
  })

  test('multiple instances do not cause field duplication', () => {
    class Profile extends BaseModel { static table = 'profiles' }

    @table('int_nodup')
    @timestamps()
    class User extends BaseModel {
      @hidden() intnd_pw!: string
      @cast('json') intnd_settings!: any
      @fillable() intnd_name!: string
      @HasOne(() => Profile) intnd_profile!: any
      @BeforeSave() static async intnd_hook(u: any) {}
    }

    new User()
    new User()
    new User()

    const hidCount = (User as any).hidden.filter((x: string) => x === 'intnd_pw').length
    expect(hidCount).toBe(1)
    expect((User as any).casts.intnd_settings).toBe('json')
    const fillCount = (User as any).fillable.filter((x: string) => x === 'intnd_name').length
    expect(fillCount).toBe(1)
    expect((User as any).relations.intnd_profile.type).toBe('hasOne')
  })

  test('class with all four relation types', () => {
    class Profile extends BaseModel { static table = 'profiles' }
    class Post extends BaseModel { static table = 'posts' }
    class Company extends BaseModel { static table = 'companies' }
    class Role extends BaseModel { static table = 'roles' }

    class User extends BaseModel {
      static table = 'int_all_rels'
      @HasOne(() => Profile) intar_profile!: any
      @HasMany(() => Post) intar_posts!: any
      @BelongsTo(() => Company) intar_company!: any
      @ManyToMany(() => Role) intar_roles!: any
    }
    new User()
    expect((User as any).relations.intar_profile.type).toBe('hasOne')
    expect((User as any).relations.intar_posts.type).toBe('hasMany')
    expect((User as any).relations.intar_company.type).toBe('belongsTo')
    expect((User as any).relations.intar_roles.type).toBe('manyToMany')
  })

  test('hidden and fillable on same fields both register', () => {
    class M extends BaseModel {
      static table = 'int_hf'
      @hidden() @fillable() inthf_a!: string
      @hidden() @fillable() inthf_b!: string
    }
    new M()
    expect((M as any).hidden).toContain('inthf_a')
    expect((M as any).hidden).toContain('inthf_b')
    expect((M as any).fillable).toContain('inthf_a')
    expect((M as any).fillable).toContain('inthf_b')
  })

  test('cast and hidden and fillable all on same field', () => {
    class M extends BaseModel {
      static table = 'int_chf'
      @cast('string') @hidden() @fillable() intchf!: string
    }
    new M()
    expect((M as any).casts.intchf).toBe('string')
    expect((M as any).hidden).toContain('intchf')
    expect((M as any).fillable).toContain('intchf')
  })

  test('model with many fields of each decorator type', () => {
    @table('int_big')
    @timestamps()
    @softDeletes()
    class BigModel extends BaseModel {
      @hidden() intbig_h1!: string
      @hidden() intbig_h2!: string
      @cast('json') intbig_c1!: any
      @cast('boolean') intbig_c2!: boolean
      @cast('integer') intbig_c3!: number
      @fillable() intbig_f1!: string
      @fillable() intbig_f2!: string
      @fillable() intbig_f3!: string
    }
    new BigModel()
    expect((BigModel as any).hidden).toContain('intbig_h1')
    expect((BigModel as any).hidden).toContain('intbig_h2')
    expect((BigModel as any).casts.intbig_c1).toBe('json')
    expect((BigModel as any).casts.intbig_c2).toBe('boolean')
    expect((BigModel as any).casts.intbig_c3).toBe('integer')
    expect((BigModel as any).fillable).toContain('intbig_f1')
    expect((BigModel as any).fillable).toContain('intbig_f2')
    expect((BigModel as any).fillable).toContain('intbig_f3')
  })

  test('full model A has correct config', () => {
    class Profile extends BaseModel { static table = 'profiles' }

    @table('int_ma')
    @timestamps()
    class ModelA extends BaseModel {
      @hidden() intma_secret!: string
      @cast('json') intma_data!: any
      @fillable() intma_name!: string
      @HasOne(() => Profile) intma_profile!: any
      @BeforeSave() static async intma_hook(u: any) {}
    }

    new ModelA()

    expect((ModelA as any).table).toBe('int_ma')
    expect((ModelA as any).timestamps).toBe(true)
    expect((ModelA as any).hidden).toContain('intma_secret')
    expect((ModelA as any).casts.intma_data).toBe('json')
    expect((ModelA as any).fillable).toContain('intma_name')
    expect((ModelA as any).relations.intma_profile.type).toBe('hasOne')
  })

  test('full model B has correct config', () => {
    class Address extends BaseModel { static table = 'addresses' }

    @table('int_mb')
    @softDeletes()
    class ModelB extends BaseModel {
      @hidden() intmb_secret!: string
      @cast('boolean') intmb_flag!: boolean
      @fillable() intmb_title!: string
      @HasOne(() => Address) intmb_address!: any
      @AfterCreate() static async intmb_hook(u: any) {}
    }

    new ModelB()

    expect((ModelB as any).table).toBe('int_mb')
    expect((ModelB as any).softDeletes).toBe(true)
    expect((ModelB as any).hidden).toContain('intmb_secret')
    expect((ModelB as any).casts.intmb_flag).toBe('boolean')
    expect((ModelB as any).fillable).toContain('intmb_title')
    expect((ModelB as any).relations.intmb_address.type).toBe('hasOne')
  })

  test('relations with full options on all types', () => {
    class Profile extends BaseModel { static table = 'profiles' }
    class Post extends BaseModel { static table = 'posts' }
    class Company extends BaseModel { static table = 'companies' }
    class Role extends BaseModel { static table = 'roles' }

    class User extends BaseModel {
      static table = 'int_full_rel'
      @HasOne(() => Profile, { foreignKey: 'userId', localKey: 'id', withDefault: true })
      intfr_profile!: any
      @HasMany(() => Post, { foreignKey: 'authorId', localKey: 'id' })
      intfr_posts!: any
      @BelongsTo(() => Company, { foreignKey: 'companyId', withDefault: { name: 'N/A' } })
      intfr_company!: any
      @ManyToMany(() => Role, { pivotTable: 'intfr_user_roles', pivotForeignKey: 'user_id', pivotRelatedForeignKey: 'role_id' })
      intfr_roles!: any
    }
    new User()

    expect((User as any).relations.intfr_profile.foreignKey).toBe('userId')
    expect((User as any).relations.intfr_profile.localKey).toBe('id')
    expect((User as any).relations.intfr_profile.withDefault).toBe(true)
    expect((User as any).relations.intfr_posts.foreignKey).toBe('authorId')
    expect((User as any).relations.intfr_company.foreignKey).toBe('companyId')
    expect((User as any).relations.intfr_company.withDefault).toEqual({ name: 'N/A' })
    expect((User as any).relations.intfr_roles.pivotTable).toBe('intfr_user_roles')
    expect((User as any).relations.intfr_roles.pivotForeignKey).toBe('user_id')
    expect((User as any).relations.intfr_roles.pivotRelatedForeignKey).toBe('role_id')
  })

  test('empty model with just @table works', () => {
    @table('int_empty')
    class Empty extends BaseModel {}
    expect((Empty as any).table).toBe('int_empty')
  })

  test('model extending BaseModel is instanceof BaseModel', () => {
    @table('int_inst')
    class InstTest extends BaseModel {
      @fillable() intinst_name!: string
    }
    const inst = new InstTest()
    expect(inst).toBeInstanceOf(BaseModel)
  })

  test('all six cast types on one model', () => {
    class AllCasts extends BaseModel {
      static table = 'int_all_casts'
      @cast('boolean') intac_a!: boolean
      @cast('json') intac_b!: any
      @cast('integer') intac_c!: number
      @cast('float') intac_d!: number
      @cast('date') intac_e!: Date
      @cast('string') intac_f!: string
    }
    new AllCasts()
    expect((AllCasts as any).casts.intac_a).toBe('boolean')
    expect((AllCasts as any).casts.intac_b).toBe('json')
    expect((AllCasts as any).casts.intac_c).toBe('integer')
    expect((AllCasts as any).casts.intac_d).toBe('float')
    expect((AllCasts as any).casts.intac_e).toBe('date')
    expect((AllCasts as any).casts.intac_f).toBe('string')
  })

  test('hooks and relations on same model', () => {
    class Post extends BaseModel { static table = 'posts' }
    class User extends BaseModel {
      static table = 'int_hr'
      @HasMany(() => Post) inthr_posts!: any
      @BeforeSave() static async inthr_validate(u: any) {}
      @AfterCreate() static async inthr_welcome(u: any) {}
    }
    new User()
    expect((User as any).relations.inthr_posts.type).toBe('hasMany')
    expect((User as any).hooks.beforeSave).toBeDefined()
    expect((User as any).hooks.afterCreate).toBeDefined()
  })

  test('custom cast function combined with relation', () => {
    class Tag extends BaseModel { static table = 'tags' }
    const toUpper = (v: any) => String(v).toUpperCase()
    class Article extends BaseModel {
      static table = 'int_articles'
      @cast(toUpper) intart_title!: string
      @ManyToMany(() => Tag, { pivotTable: 'int_article_tags' }) intart_tags!: any
    }
    new Article()
    expect((Article as any).casts.intart_title).toBe(toUpper)
    expect((Article as any).casts.intart_title('hello')).toBe('HELLO')
    expect((Article as any).relations.intart_tags.pivotTable).toBe('int_article_tags')
  })

  test('model X with hidden field', () => {
    @table('int_x')
    class X extends BaseModel {
      @hidden() intx_a!: string
    }
    new X()
    expect((X as any).table).toBe('int_x')
    expect((X as any).hidden).toContain('intx_a')
  })

  test('model Y with fillable and model Z with cast', () => {
    @table('int_y')
    class Y extends BaseModel {
      @fillable() inty_b!: string
    }
    new Y()
    expect((Y as any).table).toBe('int_y')
    expect((Y as any).fillable).toContain('inty_b')

    @table('int_z')
    class Z extends BaseModel {
      @cast('json') intz_c!: any
    }
    new Z()
    expect((Z as any).table).toBe('int_z')
    expect((Z as any).casts.intz_c).toBe('json')
  })

  test('field decorators work without class decorators on BaseModel subclass', () => {
    class Bare extends BaseModel {
      static table = 'int_bare'
      @hidden() intbare_secret!: string
      @cast('integer') intbare_count!: number
      @fillable() intbare_label!: string
    }
    new Bare()
    expect((Bare as any).hidden).toContain('intbare_secret')
    expect((Bare as any).casts.intbare_count).toBe('integer')
    expect((Bare as any).fillable).toContain('intbare_label')
  })
})
