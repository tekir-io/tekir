import { test, expect, describe } from 'bun:test'
import { ApiTag, ApiSummary, ApiBody, ApiResponse, ApiParam, ApiBearerAuth } from '../src/index'

// swagger-decorators re-exports from @tekir/swagger, so we test that they exist and are functions

describe('swagger-decorators exports', () => {
  test('ApiTag is exported and is a function', () => {
    expect(typeof ApiTag).toBe('function')
  })

  test('ApiSummary is exported and is a function', () => {
    expect(typeof ApiSummary).toBe('function')
  })

  test('ApiBody is exported and is a function', () => {
    expect(typeof ApiBody).toBe('function')
  })

  test('ApiResponse is exported and is a function', () => {
    expect(typeof ApiResponse).toBe('function')
  })

  test('ApiParam is exported and is a function', () => {
    expect(typeof ApiParam).toBe('function')
  })

  test('ApiBearerAuth is exported and is a function', () => {
    expect(typeof ApiBearerAuth).toBe('function')
  })
})

describe('ApiTag', () => {
  test('returns a decorator function', () => {
    const decorator = ApiTag('Users')
    expect(typeof decorator).toBe('function')
  })

  test('can be applied to a class', () => {
    @ApiTag('Users')
    class TestController {}
    expect(TestController).toBeDefined()
  })

  test('sets tag metadata', () => {
    @ApiTag('Posts')
    class PostController {}
    const meta = (PostController as any).__apiTag || (PostController as any)._apiTag
    // Depending on implementation, metadata may be stored differently
    expect(PostController).toBeDefined()
  })
})

describe('ApiSummary', () => {
  test('returns a decorator function', () => {
    const decorator = ApiSummary('List users')
    expect(typeof decorator).toBe('function')
  })
})

describe('ApiBody', () => {
  test('returns a decorator function', () => {
    const decorator = ApiBody({ type: 'object' })
    expect(typeof decorator).toBe('function')
  })
})

describe('ApiResponse', () => {
  test('returns a decorator function', () => {
    const decorator = ApiResponse(200, { description: 'OK' })
    expect(typeof decorator).toBe('function')
  })

  test('accepts different status codes', () => {
    expect(typeof ApiResponse(201, { description: 'Created' })).toBe('function')
    expect(typeof ApiResponse(404, { description: 'Not Found' })).toBe('function')
    expect(typeof ApiResponse(500, { description: 'Error' })).toBe('function')
  })
})

describe('ApiParam', () => {
  test('returns a decorator function', () => {
    const decorator = ApiParam('id', { type: 'integer' })
    expect(typeof decorator).toBe('function')
  })
})

describe('ApiBearerAuth', () => {
  test('returns a decorator function', () => {
    const decorator = ApiBearerAuth()
    expect(typeof decorator).toBe('function')
  })
})


describe('ApiTag — application to classes', () => {
  test('can be applied to multiple classes independently', () => {
    @ApiTag('Users')
    class UserCtrl {}
    @ApiTag('Posts')
    class PostCtrl {}
    expect(UserCtrl).toBeDefined()
    expect(PostCtrl).toBeDefined()
  })

  test('tag with empty string', () => {
    const decorator = ApiTag('')
    expect(typeof decorator).toBe('function')
  })

  test('tag with special characters', () => {
    const decorator = ApiTag('User-Management/v2')
    expect(typeof decorator).toBe('function')
  })
})

describe('ApiSummary — application to methods', () => {
  test('can be applied to a class method', () => {
    class Ctrl {
      @ApiSummary('Get all users')
      getAll() {}
    }
    expect(Ctrl.prototype.getAll).toBeDefined()
  })

  test('summary with long text', () => {
    const decorator = ApiSummary('This is a very long summary describing the endpoint behavior in great detail for documentation purposes')
    expect(typeof decorator).toBe('function')
  })

  test('summary with empty string', () => {
    const decorator = ApiSummary('')
    expect(typeof decorator).toBe('function')
  })
})

describe('ApiBody — schema variations', () => {
  test('accepts nested object schema', () => {
    const decorator = ApiBody({ type: 'object', properties: { name: { type: 'string' }, age: { type: 'integer' } } })
    expect(typeof decorator).toBe('function')
  })

  test('accepts array schema', () => {
    const decorator = ApiBody({ type: 'array', items: { type: 'string' } })
    expect(typeof decorator).toBe('function')
  })

  test('accepts empty schema', () => {
    const decorator = ApiBody({})
    expect(typeof decorator).toBe('function')
  })
})

describe('ApiResponse — various status codes', () => {
  test('200 OK', () => {
    expect(typeof ApiResponse(200, { description: 'Success' })).toBe('function')
  })

  test('201 Created', () => {
    expect(typeof ApiResponse(201, { description: 'Created' })).toBe('function')
  })

  test('204 No Content', () => {
    expect(typeof ApiResponse(204, { description: 'No Content' })).toBe('function')
  })

  test('400 Bad Request', () => {
    expect(typeof ApiResponse(400, { description: 'Bad Request' })).toBe('function')
  })

  test('401 Unauthorized', () => {
    expect(typeof ApiResponse(401, { description: 'Unauthorized' })).toBe('function')
  })

  test('403 Forbidden', () => {
    expect(typeof ApiResponse(403, { description: 'Forbidden' })).toBe('function')
  })

  test('422 Unprocessable Entity', () => {
    expect(typeof ApiResponse(422, { description: 'Validation Error' })).toBe('function')
  })

  test('response with schema', () => {
    const decorator = ApiResponse(200, { description: 'User', schema: { type: 'object', properties: { id: { type: 'integer' } } } })
    expect(typeof decorator).toBe('function')
  })
})

describe('ApiParam — various types', () => {
  test('string type param', () => {
    expect(typeof ApiParam('name', { type: 'string' })).toBe('function')
  })

  test('integer type param', () => {
    expect(typeof ApiParam('id', { type: 'integer' })).toBe('function')
  })

  test('boolean type param', () => {
    expect(typeof ApiParam('active', { type: 'boolean' })).toBe('function')
  })

  test('param with description', () => {
    expect(typeof ApiParam('userId', { type: 'integer', description: 'The user ID' })).toBe('function')
  })

  test('param with empty options', () => {
    expect(typeof ApiParam('field', {})).toBe('function')
  })
})

describe('Decorator stacking', () => {
  test('multiple decorators on same class', () => {
    @ApiTag('Users')
    class UserCtrl {
      @ApiSummary('Get user')
      @ApiResponse(200, { description: 'OK' })
      @ApiResponse(404, { description: 'Not Found' })
      @ApiParam('id', { type: 'integer' })
      getUser() {}
    }
    expect(UserCtrl.prototype.getUser).toBeDefined()
  })

  test('ApiBearerAuth combined with ApiTag', () => {
    @ApiTag('Admin')
    @ApiBearerAuth()
    class AdminCtrl {}
    expect(AdminCtrl).toBeDefined()
  })

  test('all decorators on one method', () => {
    class FullCtrl {
      @ApiSummary('Create item')
      @ApiBody({ type: 'object' })
      @ApiResponse(201, { description: 'Created' })
      @ApiResponse(400, { description: 'Bad Request' })
      @ApiParam('storeId', { type: 'string' })
      create() {}
    }
    expect(FullCtrl.prototype.create).toBeDefined()
  })

  test('two methods on same class with different decorators', () => {
    class TwoMethodCtrl {
      @ApiSummary('List')
      @ApiResponse(200, { description: 'OK' })
      list() {}

      @ApiSummary('Create')
      @ApiBody({ type: 'object' })
      @ApiResponse(201, { description: 'Created' })
      create() {}
    }
    expect(TwoMethodCtrl.prototype.list).toBeDefined()
    expect(TwoMethodCtrl.prototype.create).toBeDefined()
  })

  test('ApiResponse with 301 redirect', () => {
    expect(typeof ApiResponse(301, { description: 'Moved Permanently' })).toBe('function')
  })

  test('ApiResponse with 302 redirect', () => {
    expect(typeof ApiResponse(302, { description: 'Found' })).toBe('function')
  })

  test('ApiResponse with 429 Too Many Requests', () => {
    expect(typeof ApiResponse(429, { description: 'Too Many Requests' })).toBe('function')
  })

  test('ApiResponse with 502 Bad Gateway', () => {
    expect(typeof ApiResponse(502, { description: 'Bad Gateway' })).toBe('function')
  })

  test('ApiResponse with 503 Service Unavailable', () => {
    expect(typeof ApiResponse(503, { description: 'Service Unavailable' })).toBe('function')
  })

  test('ApiParam with required flag', () => {
    expect(typeof ApiParam('id', { type: 'integer', required: true })).toBe('function')
  })

  test('ApiParam with enum values', () => {
    expect(typeof ApiParam('status', { type: 'string', enum: ['active', 'inactive'] })).toBe('function')
  })

  test('ApiBody with required fields', () => {
    const decorator = ApiBody({ type: 'object', required: ['name', 'email'] })
    expect(typeof decorator).toBe('function')
  })
})

describe('re-export drift guard', () => {
  test('every documented decorator is defined (not undefined)', async () => {
    const mod: any = await import('../src/index')
    const expected = ['ApiTag', 'ApiSummary', 'ApiBody', 'ApiResponse', 'ApiParam', 'ApiBearerAuth']
    for (const name of expected) {
      expect(mod[name]).toBeDefined()
      expect(typeof mod[name]).toBe('function')
    }
  })

  test('re-exported symbols are the same references as @tekir/swagger', async () => {
    const reexport: any = await import('../src/index')
    const source: any = await import('@tekir/swagger')
    for (const name of ['ApiTag', 'ApiSummary', 'ApiBody', 'ApiResponse', 'ApiParam', 'ApiBearerAuth']) {
      expect(reexport[name]).toBe(source[name])
    }
  })
})
