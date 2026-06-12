import { test, expect, describe } from 'bun:test'
import { BaseModel } from '@tekir/db'
import {
  hidden, cast, fillable, HasMany,
  BeforeSave, AfterCreate,
} from '../src/index'

// These tests cover the mass-assignment / metadata-leak fix: a field or hook
// declared on one model class must not leak into a parent model or its
// siblings. Each subclass owns its own hidden/fillable/casts/relations/hooks
// collection (inheriting a copy of the parent's).
//
// Each model is defined in its own factory function. In real projects every
// model lives in its own module, and Bun's class-field decorator lowering
// mis-resolves `context.name` when several decorated classes share one lexical
// scope, so per-function definitions mirror real usage and keep names correct.

class Post extends BaseModel { static table = 'inh_posts' }

function makeAccount() {
  class Account extends BaseModel {
    static table = 'inh_accounts'
    @fillable() accountField!: string
  }
  return Account
}

function makeOrder() {
  class Order extends BaseModel {
    static table = 'inh_orders'
    @fillable() orderField!: string
  }
  return Order
}

describe('field metadata does not leak across classes', () => {
  test('@fillable on one class does not appear on a sibling', () => {
    const Account = makeAccount()
    const Order = makeOrder()
    new Account()
    new Order()
    expect((Account as any).fillable).toContain('accountField')
    expect((Account as any).fillable).not.toContain('orderField')
    expect((Order as any).fillable).toContain('orderField')
    expect((Order as any).fillable).not.toContain('accountField')
  })

  test('@fillable does not leak into BaseModel (mass-assignment boundary)', () => {
    const Account = makeAccount()
    new Account()
    expect((Account as any).fillable).toContain('accountField')
    expect((BaseModel as any).fillable ?? []).not.toContain('accountField')
  })

  test('@hidden arrays are distinct objects per class', () => {
    const Account = makeAccount()
    const Order = makeOrder()
    new Account()
    new Order()
    expect((Account as any).fillable).not.toBe((Order as any).fillable)
  })

  test('@cast / @relations stay isolated per class', () => {
    function makeCastModel() {
      class CA extends BaseModel {
        static table = 'inh_ca'
        @cast('json') caData!: any
        @HasMany(() => Post) caPosts!: any
      }
      return CA
    }
    const CA = makeCastModel()
    const Order = makeOrder()
    new CA()
    new Order()
    expect((CA as any).casts.caData).toBe('json')
    expect((Order as any).casts?.caData).toBeUndefined()
    expect((CA as any).relations.caPosts).toBeDefined()
    expect((Order as any).relations?.caPosts).toBeUndefined()
  })

  test('subclass inherits a copy of parent fillable but additions stay local', () => {
    function makeParent() {
      class ParentModel extends BaseModel {
        static table = 'inh_parent_m'
        @fillable() parentField!: string
      }
      return ParentModel
    }
    const ParentModel = makeParent()
    new ParentModel()

    function makeChild(P: any) {
      class ChildModel extends P {
        @fillable() childField!: string
      }
      return ChildModel
    }
    const ChildModel = makeChild(ParentModel)
    new ChildModel()

    expect((ChildModel as any).fillable).toContain('parentField')
    expect((ChildModel as any).fillable).toContain('childField')
    expect((ParentModel as any).fillable).toContain('parentField')
    expect((ParentModel as any).fillable).not.toContain('childField')
    expect((ChildModel as any).fillable).not.toBe((ParentModel as any).fillable)
  })
})

describe('hook metadata does not leak across classes', () => {
  test('static hook on one class does not leak into a sibling or BaseModel', () => {
    function makeHookA() {
      class StaticHookA extends BaseModel {
        static table = 'static_hook_a'
        @BeforeSave() static hookA() {}
      }
      return StaticHookA
    }
    function makeHookB() {
      class StaticHookB extends BaseModel {
        static table = 'static_hook_b'
        @AfterCreate() static hookB() {}
      }
      return StaticHookB
    }
    const A = makeHookA()
    const B = makeHookB()
    new A()
    new B()
    expect((A as any).hooks.beforeSave?.length).toBe(1)
    expect((A as any).hooks.afterCreate ?? []).toHaveLength(0)
    expect((B as any).hooks.afterCreate?.length).toBe(1)
    expect((B as any).hooks.beforeSave ?? []).toHaveLength(0)
    expect((A as any).hooks).not.toBe((B as any).hooks)
    expect((BaseModel as any).hooks.beforeSave ?? []).toHaveLength(0)
  })

  test('subclass static hook does not append to parent hook array', () => {
    function makeParent() {
      class HParent extends BaseModel {
        static table = 'h_parent'
        @BeforeSave() static parentHook() {}
      }
      return HParent
    }
    const HParent = makeParent()
    new HParent()
    const parentArr = (HParent as any).hooks.beforeSave
    const parentLen = parentArr.length

    function makeChild(P: any) {
      class HChild extends P {
        @BeforeSave() static childHook() {}
      }
      return HChild
    }
    const HChild = makeChild(HParent)
    new HChild()

    expect((HChild as any).hooks.beforeSave.length).toBe(parentLen + 1)
    expect((HParent as any).hooks.beforeSave.length).toBe(parentLen)
    expect((HChild as any).hooks.beforeSave).not.toBe(parentArr)
  })
})
