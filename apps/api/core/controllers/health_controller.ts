import { Controller, Get, Middleware } from '@tekir/http-decorators'
import type { HttpContext } from '@tekir/core'
import { Project } from '~/models/project'
import { healthLimiter } from '~/limiters'
import { Task } from '~/models/task'
import { ApiTag, ApiSummary, ApiResponse } from '@tekir/swagger-decorators'

@Controller('/api')
@ApiTag('Health')
export default class HealthController {
  @Get('/health')
  @ApiSummary('Health check')
  @ApiResponse(200, {
    type: 'object',
    properties: {
      status: { type: 'string', example: 'ok' },
    },
  })
  @Middleware([healthLimiter])
  async health(ctx: HttpContext) {
    return ctx.response.ok({ status: 'ok' })
  }

  @Get('/stats')
  @ApiSummary('Aggregate project and task statistics')
  @ApiResponse(200, {
    type: 'object',
    properties: {
      projects: { type: 'object', properties: { total: { type: 'integer' } } },
      tasks: { type: 'object', properties: { total: { type: 'integer' }, completed: { type: 'integer' }, pending: { type: 'integer' }, completionRate: { type: 'string' } } },
    },
  })
  @Middleware([healthLimiter])
  async stats(ctx: HttpContext) {
    const [totalProjects, totalTasks, doneTasks] = await Promise.all([
      Project.count(),
      Task.count(),
      Task.findManyBy('status', 'done'),
    ])

    const completedTasks = doneTasks.length
    const completionRate = totalTasks > 0
      ? Math.round((completedTasks / totalTasks) * 100 * 100) / 100
      : 0

    return ctx.response.ok({
      projects: { total: totalProjects },
      tasks: {
        total: totalTasks,
        completed: completedTasks,
        pending: totalTasks - completedTasks,
        completionRate: `${completionRate}%`,
      },
    })
  }
}
