import { Controller, Get, Post, Put, Delete, Middleware } from '@tekir/http-decorators'
import type { HttpContext } from '@tekir/core'
import { validate } from '@tekir/validator'
import { z } from 'zod'
import { Task } from '~/models/task'
import { createTaskSchema, updateTaskSchema, assignSchema } from '~/validators/task'
import { writeLimiter } from '~/limiters'
import { User } from '~/models/user'
import { Comment } from '~/models/comment'
import { TaskAssignedNotification } from '~/notifications/task_assigned'
import { ApiTag, ApiSummary, ApiBody, ApiResponse, ApiParam, ApiBearerAuth } from '@tekir/swagger-decorators'
import { auth, notify, emitter } from '#services'

@Controller('/api/tasks')
@ApiTag('Tasks')
export default class TaskController {
  /**
   * GET /api/tasks
   * List tasks with optional filters: status, assigneeId, priority.
   */
  @Get('/')
  @ApiSummary('List tasks with optional filters')
  @ApiResponse(200, {
    type: 'object',
    properties: {
      data: { type: 'array', items: { type: 'object' } },
      meta: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          perPage: { type: 'integer' },
          total: { type: 'integer' },
          lastPage: { type: 'integer' },
        },
      },
    },
  })
  @ApiBearerAuth()
  @Middleware([auth.middleware()])
  async index(ctx: HttpContext) {
    const page = Number(ctx.request.input('page', 1))
    const perPage = Math.min(100, Number(ctx.request.input('perPage', 20)))
    const { status, assigneeId, priority } = ctx.query as Record<string, string>

    // Fetch all tasks and filter in JS to avoid using unsupported query builder methods
    let tasks = await Task.all()

    if (status) {
      tasks = tasks.filter((t) => t.status === status)
    }
    if (assigneeId) {
      const aid = parseInt(assigneeId)
      tasks = tasks.filter((t) => t.assigneeId === aid)
    }
    if (priority) {
      tasks = tasks.filter((t) => t.priority === priority)
    }

    const total = tasks.length
    const offset = (page - 1) * perPage
    const paginated = tasks.slice(offset, offset + perPage)

    return ctx.response.ok({
      data: paginated,
      meta: { page, perPage, total, lastPage: Math.ceil(total / perPage) },
    })
  }

  /**
   * POST /api/tasks
   * Create a new task and dispatch a notification to the assignee.
   */
  @Post('/')
  @ApiSummary('Create a new task')
  @ApiBody(createTaskSchema)
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
    validate({ body: createTaskSchema }),
  ])
  async store(ctx: HttpContext) {
    const body = ctx.body as z.infer<typeof createTaskSchema>
    const task = await Task.create(body)

    // Notify the assignee if one is set
    if (body.assigneeId) {
      const assignee = await User.find(body.assigneeId)
      if (assignee) {
        await notify.send(String(assignee.id), new TaskAssignedNotification(task, assignee))
      }
    }

    return ctx.response.created({ data: task })
  }

  /**
   * GET /api/tasks/:id
   * Return a task with its comments loaded.
   */
  @Get('/:id')
  @ApiSummary('Get a task by ID')
  @ApiParam('id', { type: 'integer', description: 'Task ID' })
  @ApiResponse(200, {
    type: 'object',
    properties: {
      data: {
        type: 'object',
        properties: {
          comments: { type: 'array', items: { type: 'object' } },
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
  async show(ctx: HttpContext) {
    const { id } = ctx.params

    const [task, comments] = await Promise.all([
      Task.findOrFail(parseInt(id)),
      Comment.findManyBy('taskId', parseInt(id)),
    ])

    return ctx.response.ok({ data: { ...task, comments } })
  }

  /**
   * PUT /api/tasks/:id
   * Update a task. If status changes, emit a task.status_changed event.
   */
  @Put('/:id')
  @ApiSummary('Update a task')
  @ApiParam('id', { type: 'integer', description: 'Task ID' })
  @ApiBody(updateTaskSchema)
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
  @Middleware([
    auth.middleware(),
    writeLimiter,
    validate({ body: updateTaskSchema }),
  ])
  async update(ctx: HttpContext) {
    const { id } = ctx.params
    const body = ctx.body as z.infer<typeof updateTaskSchema>

    const task = await Task.findOrFail(parseInt(id))
    const previousStatus = task.status
    const authUser = ctx.auth.user
    if (!authUser) return ctx.response.unauthorized({ message: 'Unauthorized' })

    await task.merge(body).save()

    // Emit event when task status changes
    if (body.status && body.status !== previousStatus) {
      await emitter.emit('task.status_changed', {
        taskId: task.id,
        previousStatus,
        newStatus: body.status,
        changedBy: authUser.id,
        changedAt: new Date().toISOString(),
      })
    }

    return ctx.response.ok({ data: task })
  }

  /**
   * DELETE /api/tasks/:id
   * Delete a task.
   */
  @Delete('/:id')
  @ApiSummary('Delete a task')
  @ApiParam('id', { type: 'integer', description: 'Task ID' })
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

    const task = await Task.findOrFail(parseInt(id))
    const user = ctx.auth.user
    if (!user) return ctx.response.unauthorized({ message: 'Unauthorized' })

    // Only task assignee or admin may delete
    if (task.assigneeId !== user.id && user.role !== 'admin') {
      return ctx.response.forbidden({ message: 'You do not have permission to delete this task.' })
    }

    await task.delete()

    return ctx.response.ok({ message: 'Task deleted successfully.' })
  }

  /**
   * POST /api/tasks/:id/assign
   * Assign a task to a user and notify that user.
   */
  @Post('/:id/assign')
  @ApiSummary('Assign a task to a user')
  @ApiParam('id', { type: 'integer', description: 'Task ID' })
  @ApiBody(assignSchema)
  @ApiResponse(200, {
    type: 'object',
    properties: {
      message: { type: 'string' },
      data: { type: 'object' },
    },
  })
  @ApiResponse(404, {
    type: 'object',
    properties: { message: { type: 'string' } },
  })
  @ApiBearerAuth()
  @Middleware([
    auth.middleware(),
    writeLimiter,
    validate({ body: assignSchema }),
  ])
  async assign(ctx: HttpContext) {
    const { id } = ctx.params
    const { assigneeId } = ctx.body as z.infer<typeof assignSchema>

    const [task, assignee] = await Promise.all([
      Task.findOrFail(parseInt(id)),
      User.findOrFail(assigneeId),
    ])

    await task.merge({ assigneeId }).save()

    // Notify the new assignee
    await notify.send(String(assignee.id), new TaskAssignedNotification(task, assignee))

    return ctx.response.ok({
      message: `Task assigned to ${assignee.name}.`,
      data: task,
    })
  }

  /**
   * POST /api/tasks/:id/complete
   * Mark a task as done and record the completedAt timestamp.
   */
  @Post('/:id/complete')
  @ApiSummary('Mark a task as complete')
  @ApiParam('id', { type: 'integer', description: 'Task ID' })
  @ApiResponse(200, {
    type: 'object',
    properties: {
      message: { type: 'string' },
      data: { type: 'object' },
    },
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
  async complete(ctx: HttpContext) {
    const { id } = ctx.params

    const task = await Task.findOrFail(parseInt(id))

    if (task.status === 'done') {
      return ctx.response.ok({ message: 'Task is already completed.', data: task })
    }

    const previousStatus = task.status
    const authUser = ctx.auth.user
    if (!authUser) return ctx.response.unauthorized({ message: 'Unauthorized' })
    await task.merge({
      status: 'done',
      completedAt: new Date().toISOString(),
    }).save()

    // Emit status change event

    await emitter.emit('task.status_changed', {
      taskId: task.id,
      previousStatus,
      newStatus: 'done',
      changedBy: authUser.id,
      changedAt: new Date().toISOString(),
    })

    return ctx.response.ok({ message: 'Task marked as complete.', data: task })
  }
}
