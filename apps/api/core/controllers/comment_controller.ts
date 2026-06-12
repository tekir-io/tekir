import { Controller, Get, Post, Delete, Middleware } from '@tekir/http-decorators'
import type { HttpContext } from '@tekir/core'
import { validate } from '@tekir/validator'
import { z } from 'zod'
import { Comment } from '~/models/comment'
import { createCommentSchema } from '~/validators/comment'
import { writeLimiter } from '~/limiters'
import { Task } from '~/models/task'
import { ApiTag, ApiSummary, ApiBody, ApiResponse, ApiParam, ApiBearerAuth } from '@tekir/swagger-decorators'
import { auth } from '#services'

@Controller('/api')
@ApiTag('Comments')
export default class CommentController {
  /**
   * GET /api/tasks/:taskId/comments
   * List all comments for a given task, ordered oldest-first.
   */
  @Get('/tasks/:taskId/comments')
  @ApiSummary('List all comments for a task')
  @ApiParam('taskId', { type: 'integer', description: 'Task ID' })
  @ApiResponse(200, {
    type: 'object',
    properties: {
      data: { type: 'array', items: { type: 'object' } },
    },
  })
  @ApiResponse(404, {
    type: 'object',
    properties: { message: { type: 'string' } },
  })
  @ApiBearerAuth()
  @Middleware([auth.middleware()])
  async index(ctx: HttpContext) {
    const { taskId } = ctx.params

    // Verify the task exists
    await Task.findOrFail(parseInt(taskId))

    // findManyBy uses baseQuery (respects soft deletes) and returns all matching records
    const comments = await Comment.findManyBy('taskId', parseInt(taskId))

    return ctx.response.ok({ data: comments })
  }

  /**
   * POST /api/tasks/:taskId/comments
   * Create a new comment on a task. The userId is set from the auth context.
   */
  @Post('/tasks/:taskId/comments')
  @ApiSummary('Add a comment to a task')
  @ApiParam('taskId', { type: 'integer', description: 'Task ID' })
  @ApiBody(createCommentSchema)
  @ApiResponse(201, {
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
    validate({ body: createCommentSchema }),
  ])
  async store(ctx: HttpContext) {
    const { taskId } = ctx.params
    const { body: commentBody } = ctx.body as z.infer<typeof createCommentSchema>
    const user = ctx.auth.user
    if (!user) return ctx.response.unauthorized({ message: 'Unauthorized' })
    const userId = user.id

    // Verify the task exists
    await Task.findOrFail(parseInt(taskId))

    const comment = await Comment.create({
      taskId: parseInt(taskId),
      userId,
      body: commentBody,
    })

    return ctx.response.created({ data: comment })
  }

  /**
   * DELETE /api/comments/:id
   * Delete a comment. Only the comment author may delete their own comment.
   */
  @Delete('/comments/:id')
  @ApiSummary('Delete a comment')
  @ApiParam('id', { type: 'integer', description: 'Comment ID' })
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

    const comment = await Comment.findOrFail(parseInt(id))

    // Only the comment author may delete it (admins bypass)
    if (comment.userId !== user.id && user.role !== 'admin') {
      return ctx.response.forbidden({ message: 'You can only delete your own comments.' })
    }

    await comment.delete()

    return ctx.response.ok({ message: 'Comment deleted successfully.' })
  }
}
