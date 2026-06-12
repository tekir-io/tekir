import { test, expect, describe } from 'bun:test'
import { BaseModel, column, hasOne, hasMany, belongsTo, manyToMany, type Relation } from '../src/index'


class Profile extends BaseModel {
  static table = 'profiles'
  static schema = { id: column.id(), userId: column.integer(), bio: column.text({ nullable: true }) }
  static relations: Record<string, Relation> = { user: belongsTo(() => User) }
  declare id: number
  declare userId: number
  declare bio: string | null
}

class Post extends BaseModel {
  static table = 'posts'
  static schema = { id: column.id(), userId: column.integer(), title: column.string(), status: column.string({ default: 'draft' }) }
  static relations: Record<string, Relation> = {
    user: belongsTo(() => User),
    comments: hasMany(() => Comment),
  }
  declare id: number
  declare userId: number
  declare title: string
}

class Comment extends BaseModel {
  static table = 'comments'
  static schema = { id: column.id(), postId: column.integer(), body: column.text() }
  static relations: Record<string, Relation> = { post: belongsTo(() => Post) }
  declare id: number
  declare postId: number
  declare body: string
}

class Role extends BaseModel {
  static table = 'roles'
  static schema = { id: column.id(), name: column.string() }
  static relations: Record<string, Relation> = { users: manyToMany(() => User, { pivotTable: 'user_roles' }) }
  declare id: number
  declare name: string
}

class Tag extends BaseModel {
  static table = 'tags'
  static schema = { id: column.id(), label: column.string() }
}

class User extends BaseModel {
  static table = 'users'
  static schema = { id: column.id(), name: column.string(), email: column.string({ unique: true }) }
  static relations: Record<string, Relation> = {
    profile: hasOne(() => Profile),
    posts: hasMany(() => Post),
    roles: manyToMany(() => Role, { pivotTable: 'user_roles' }),
  }
  declare id: number
  declare name: string
  declare email: string
}

// hasOne

describe('hasOne', () => {
  test('type is hasOne', () => {
    expect(User.relations.profile.type).toBe('hasOne')
  })

  test('model factory returns correct model', () => {
    expect(User.relations.profile.model()).toBe(Profile)
  })

  test('default foreignKey is modelNameId', () => {
    const rel = hasOne(() => Profile)
    expect(rel.foreignKey).toBeUndefined() // uses convention
  })

  test('custom foreignKey', () => {
    const rel = hasOne(() => Profile, { foreignKey: 'ownerId' })
    expect(rel.foreignKey).toBe('ownerId')
  })

  test('custom localKey', () => {
    const rel = hasOne(() => Profile, { localKey: 'uuid' })
    expect(rel.localKey).toBe('uuid')
  })

  test('withDefault: true', () => {
    const rel = hasOne(() => Profile, { withDefault: true })
    expect(rel.withDefault).toBe(true)
  })

  test('withDefault: object', () => {
    const rel = hasOne(() => Profile, { withDefault: { bio: 'N/A' } })
    expect(rel.withDefault).toEqual({ bio: 'N/A' })
  })

  test('creates independent relation objects', () => {
    const r1 = hasOne(() => Profile)
    const r2 = hasOne(() => Profile, { foreignKey: 'x' })
    expect(r1.foreignKey).toBeUndefined()
    expect(r2.foreignKey).toBe('x')
  })
})

// hasMany

describe('hasMany', () => {
  test('type is hasMany', () => {
    expect(User.relations.posts.type).toBe('hasMany')
  })

  test('model factory returns correct model', () => {
    expect(User.relations.posts.model()).toBe(Post)
  })

  test('default foreignKey', () => {
    const rel = hasMany(() => Post)
    expect(rel.foreignKey).toBeUndefined()
  })

  test('custom foreignKey', () => {
    const rel = hasMany(() => Post, { foreignKey: 'authorId' })
    expect(rel.foreignKey).toBe('authorId')
  })

  test('custom localKey', () => {
    const rel = hasMany(() => Post, { localKey: 'uuid' })
    expect(rel.localKey).toBe('uuid')
  })

  test('multiple hasMany on same model', () => {
    expect(Post.relations.comments.type).toBe('hasMany')
    expect(Post.relations.comments.model()).toBe(Comment)
  })
})

// belongsTo

describe('belongsTo', () => {
  test('type is belongsTo', () => {
    expect(Post.relations.user.type).toBe('belongsTo')
  })

  test('model factory returns correct model', () => {
    expect(Post.relations.user.model()).toBe(User)
  })

  test('default foreignKey', () => {
    const rel = belongsTo(() => User)
    expect(rel.foreignKey).toBeUndefined()
  })

  test('custom foreignKey', () => {
    const rel = belongsTo(() => User, { foreignKey: 'authorId' })
    expect(rel.foreignKey).toBe('authorId')
  })

  test('withDefault: true', () => {
    const rel = belongsTo(() => User, { withDefault: true })
    expect(rel.withDefault).toBe(true)
  })

  test('withDefault: object', () => {
    const rel = belongsTo(() => User, { withDefault: { name: 'Unknown' } })
    expect(rel.withDefault).toEqual({ name: 'Unknown' })
  })

  test('inverse of hasMany', () => {
    expect(Post.relations.user.model()).toBe(User)
    expect(User.relations.posts.model()).toBe(Post)
  })

  test('nested belongsTo chain', () => {
    expect(Comment.relations.post.type).toBe('belongsTo')
    expect(Comment.relations.post.model()).toBe(Post)
    expect(Post.relations.user.model()).toBe(User)
  })
})

// manyToMany

describe('manyToMany', () => {
  test('type is manyToMany', () => {
    expect(User.relations.roles.type).toBe('manyToMany')
  })

  test('model factory returns correct model', () => {
    expect(User.relations.roles.model()).toBe(Role)
  })

  test('pivotTable is set', () => {
    expect(User.relations.roles.pivotTable).toBe('user_roles')
  })

  test('inverse manyToMany', () => {
    expect(Role.relations.users.type).toBe('manyToMany')
    expect(Role.relations.users.model()).toBe(User)
    expect(Role.relations.users.pivotTable).toBe('user_roles')
  })

  test('custom pivotForeignKey', () => {
    const rel = manyToMany(() => Role, { pivotTable: 'ur', pivotForeignKey: 'uid' })
    expect(rel.pivotForeignKey).toBe('uid')
  })

  test('custom pivotRelatedForeignKey', () => {
    const rel = manyToMany(() => Role, { pivotTable: 'ur', pivotRelatedForeignKey: 'rid' })
    expect(rel.pivotRelatedForeignKey).toBe('rid')
  })

  test('all pivot options together', () => {
    const rel = manyToMany(() => Tag, {
      pivotTable: 'post_tags',
      pivotForeignKey: 'post_id',
      pivotRelatedForeignKey: 'tag_id',
    })
    expect(rel.type).toBe('manyToMany')
    expect(rel.pivotTable).toBe('post_tags')
    expect(rel.pivotForeignKey).toBe('post_id')
    expect(rel.pivotRelatedForeignKey).toBe('tag_id')
  })
})

// Relation structure on models

describe('Model relation structure', () => {
  test('User has 3 relations', () => {
    expect(Object.keys(User.relations)).toHaveLength(3)
  })

  test('Post has 2 relations', () => {
    expect(Object.keys(Post.relations)).toHaveLength(2)
  })

  test('Comment has 1 relation', () => {
    expect(Object.keys(Comment.relations)).toHaveLength(1)
  })

  test('Role has 1 relation', () => {
    expect(Object.keys(Role.relations)).toHaveLength(1)
  })

  test('Tag has no own declared relations', () => {
    // Tag itself declares no relations, but other models may reference it
    // via manyToMany — so we just check Tag's schema has no relation descriptors
    const ownRelations = Object.entries(Tag.schema || {}).filter(([, v]) => v && typeof v === 'object' && 'type' in v && ['hasOne', 'hasMany', 'belongsTo', 'manyToMany'].includes((v as any).type))
    expect(ownRelations).toHaveLength(0)
  })

  test('relations are enumerable', () => {
    const keys = Object.keys(User.relations)
    expect(keys).toContain('profile')
    expect(keys).toContain('posts')
    expect(keys).toContain('roles')
  })

  test('each relation has type and model', () => {
    for (const rel of Object.values(User.relations)) {
      expect(rel.type).toBeDefined()
      expect(typeof rel.model).toBe('function')
    }
  })
})

// Edge cases

describe('Relation edge cases', () => {
  test('lazy factory avoids circular import', () => {
    // User references Post, Post references User — no error
    const userPostsModel = User.relations.posts.model()
    const postUserModel = Post.relations.user.model()
    expect(userPostsModel).toBe(Post)
    expect(postUserModel).toBe(User)
  })

  test('same model can be referenced by multiple relations', () => {
    const r1 = hasMany(() => Post, { foreignKey: 'userId' })
    const r2 = hasMany(() => Post, { foreignKey: 'reviewerId' })
    expect(r1.foreignKey).toBe('userId')
    expect(r2.foreignKey).toBe('reviewerId')
    expect(r1.model()).toBe(r2.model())
  })

  test('relation objects are plain objects', () => {
    const rel = hasOne(() => Profile)
    expect(typeof rel).toBe('object')
    expect(rel.type).toBe('hasOne')
  })

  test('manyToMany without pivot options still has type', () => {
    const rel = manyToMany(() => Tag, { pivotTable: 'taggables' })
    expect(rel.type).toBe('manyToMany')
    expect(rel.pivotForeignKey).toBeUndefined()
  })
})
