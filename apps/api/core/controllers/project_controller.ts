import { Controller, Get, Post, Put, Delete, Middleware } from '@tekir/http-decorators'
import type { HttpContext } from '@tekir/core'
import { validate } from '@tekir/validator'
import { eq } from '@tekir/db'
import { z } from 'zod'
import { Project } from '~/models/project'
import { createProjectSchema, updateProjectSchema } from '~/validators/project'
import { writeLimiter } from '~/limiters'
import { Task } from '~/models/task'
import { ApiTag, ApiSummary, ApiBody, ApiResponse, ApiParam, ApiBearerAuth } from '@tekir/swagger-decorators'
import { auth, cache } from '#services'

@Controller('/api/projects')
@ApiTag('Projects')
export default class ProjectController {
  /**
   * GET /api/projects
   * List all non-deleted projects with pagination. Results are cached per page.
   */
  @Get('/')
  @ApiSummary('List all projects (paginated)')
  @ApiResponse(200, {
    type: 'object',
    properties: {
      data: { type: 'array', items: { type: 'object' } },
      meta: {
        type: 'object',
        properties: {
          total: { type: 'integer' },
          page: { type: 'integer' },
          perPage: { type: 'integer' },
          lastPage: { type: 'integer' },
        },
      },
    },
  })
  @ApiBearerAuth()
  @Middleware([auth.middleware()])
  async index(ctx: HttpContext) {
    const page = Number(ctx.request.input('page', 1))
    const perPage = Math.min(100, Number(ctx.request.input('perPage', 15)))
    const cacheKey = `projects:list:page=${page}:perPage=${perPage}`

    const data = await cache.getOrSet(cacheKey, 60, async () => {
      // paginate() respects soft deletes automatically
      return Project.paginate(page, perPage)
    })

    return ctx.response.ok({
      data: data.data,
      meta: data.meta,
    })
  }

  /**
   * POST /api/projects
   * Create a new project owned by the authenticated user.
   */
  @Post('/')
  @ApiSummary('Create a new project')
  @ApiBody(createProjectSchema)
  @ApiResponse(201, {
    type: 'object',
    properties: {
      data: { type: 'object' },
    },
  })
  @ApiBearerAuth()
  @Middleware([
    auth.middleware(),
    writeLimiter,
    validate({ body: createProjectSchema }),
  ])
  async store(ctx: HttpContext) {
    const body = ctx.body as z.infer<typeof createProjectSchema>
    const user = ctx.auth.user
    if (!user) return ctx.response.unauthorized({ message: 'Unauthorized' })
    const userId = user.id

    const project = await Project.create({
      ...body,
      ownerId: userId,
    })

    // Bust the list cache on creation
    await cache.delete('projects:list:page=1:perPage=15')

    return ctx.response.created({ data: project })
  }

  /**
   * GET /api/projects/:id
   * Return a single project with its task count.
   */
  @Get('/:id')
  @ApiSummary('Get a project by ID')
  @ApiParam('id', { type: 'integer', description: 'Project ID' })
  @ApiResponse(200, {
    type: 'object',
    properties: {
      data: { type: 'object' },
    },
  })
  @ApiResponse(404, {
    type: 'object',
    properties: { message: { type: 'string' } },
  })
  @ApiBearerAuth()
  @Middleware([auth.middleware()])
  async show(ctx: HttpContext) {
    const { id } = ctx.params
    const cacheKey = `projects:${id}`

    const project = await cache.getOrSet(cacheKey, 120, async () => {
      // findOrFail() respects soft deletes (uses baseQuery which filters deletedAt=null)
      return Project.findOrFail(parseInt(id))
    })

    const tasks = await Task.findManyBy('projectId', project.id)
    const taskCount = tasks.length

    return ctx.response.ok({
      data: { ...project, taskCount },
    })
  }

  /**
   * PUT /api/projects/:id
   * Update a project (owner only).
   */
  @Put('/:id')
  @ApiSummary('Update a project')
  @ApiParam('id', { type: 'integer', description: 'Project ID' })
  @ApiBody(updateProjectSchema)
  @ApiResponse(200, {
    type: 'object',
    properties: {
      data: { type: 'object' },
    },
  })
  @ApiResponse(403, {
    type: 'object',
    properties: { message: { type: 'string' } },
  })
  @ApiResponse(404, {
    type: 'object',
    properties: { message: { type: 'string' } },
  })
  @ApiBearerAuth()
  @Middleware([
    auth.middleware(),
    writeLimiter,
    validate({ body: updateProjectSchema }),
  ])
  async update(ctx: HttpContext) {
    const { id } = ctx.params
    const user = ctx.auth.user
    if (!user) return ctx.response.unauthorized({ message: 'Unauthorized' })
    const body = ctx.body as z.infer<typeof updateProjectSchema>

    // findOrFail respects soft deletes
    const project = await Project.findOrFail(parseInt(id))

    // Authorize: only the owner may update
    if (project.ownerId !== user.id) {
      return ctx.response.forbidden({ message: 'You do not have permission to update this project.' })
    }

    const updated = await Project.update(parseInt(id), body)

    // Invalidate cached entry
    await cache.delete(`projects:${id}`)

    return ctx.response.ok({ data: updated })
  }

  /**
   * DELETE /api/projects/:id
   * Soft-delete a project (owner or admin).
   */
  @Delete('/:id')
  @ApiSummary('Delete a project (soft delete)')
  @ApiParam('id', { type: 'integer', description: 'Project ID' })
  @ApiResponse(200, {
    type: 'object',
    properties: { message: { type: 'string' } },
  })
  @ApiResponse(403, {
    type: 'object',
    properties: { message: { type: 'string' } },
  })
  @ApiResponse(404, {
    type: 'object',
    properties: { message: { type: 'string' } },
  })
  @ApiBearerAuth()
  @Middleware([
    auth.middleware(),
    writeLimiter,
  ])
  async destroy(ctx: HttpContext) {
    const { id } = ctx.params
    const user = ctx.auth.user
    if (!user) return ctx.response.unauthorized({ message: 'Unauthorized' })

    // findOrFail respects soft deletes — will 404 if already deleted
    const project = await Project.findOrFail(parseInt(id))

    // Authorize: owner or admin
    const isOwner = project.ownerId === user.id
    const isAdmin = user.role === 'admin'

    if (!isOwner && !isAdmin) {
      return ctx.response.forbidden({ message: 'You do not have permission to delete this project.' })
    }

    // destroy() performs soft delete because Project has softDeletes=true
    await Project.destroy(parseInt(id))

    // Invalidate caches
    await cache.delete(`projects:${id}`)

    return ctx.response.ok({ message: 'Project deleted successfully.' })
  }

  /**
   * POST /api/projects/:id/restore
   * Restore a soft-deleted project (owner or admin).
   */
  @Post('/:id/restore')
  @ApiSummary('Restore a soft-deleted project')
  @ApiParam('id', { type: 'integer', description: 'Project ID' })
  @ApiResponse(200, {
    type: 'object',
    properties: {
      message: { type: 'string' },
      data: { type: 'object' },
    },
  })
  @ApiResponse(403, {
    type: 'object',
    properties: { message: { type: 'string' } },
  })
  @ApiResponse(404, {
    type: 'object',
    properties: { message: { type: 'string' } },
  })
  @ApiBearerAuth()
  @Middleware([
    auth.middleware(),
    writeLimiter,
  ])
  async restore(ctx: HttpContext) {
    const { id } = ctx.params
    const user = ctx.auth.user
    if (!user) return ctx.response.unauthorized({ message: 'Unauthorized' })

    // onlyTrashed() returns only soft-deleted records; filter by id
    const row = await Project.onlyTrashed()
      .where(eq(Project.$table.id, parseInt(id)))
      .get() as Project | null

    if (!row) {
      return ctx.response.notFound({ message: 'Project not found or is not deleted.' })
    }

    const isOwner = row.ownerId === user.id
    const isAdmin = user.role === 'admin'

    if (!isOwner && !isAdmin) {
      return ctx.response.forbidden({ message: 'You do not have permission to restore this project.' })
    }

    // Restore by clearing deletedAt (deletedAt is not in fillable, bypass with direct update)
    await Project.update(parseInt(id), { deletedAt: null })

    // Now findOrFail will work since deletedAt is null again
    const restored = await Project.findOrFail(parseInt(id))

    return ctx.response.ok({ message: 'Project restored successfully.', data: restored })
  }

  /**
   * GET /api/projects/:id/tasks
   * List all tasks belonging to a project.
   */
  @Get('/:id/tasks')
  @ApiSummary('List all tasks for a project')
  @ApiParam('id', { type: 'integer', description: 'Project ID' })
  @ApiResponse(200, {
    type: 'object',
    properties: {
      data: { type: 'array', items: { type: 'object' } },
      meta: {
        type: 'object',
        properties: {
          total: { type: 'integer' },
        },
      },
    },
  })
  @ApiResponse(404, {
    type: 'object',
    properties: { message: { type: 'string' } },
  })
  @ApiBearerAuth()
  @Middleware([auth.middleware()])
  async tasks(ctx: HttpContext) {
    const { id } = ctx.params

    // Verify the project exists and is not deleted
    await Project.findOrFail(parseInt(id))

    // Fetch all tasks for this project
    const tasks = await Task.findManyBy('projectId', parseInt(id))

    return ctx.response.ok({
      data: tasks,
      meta: {
        total: tasks.length,
      },
    })
  }
}
