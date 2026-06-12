import { Controller, Get, Post, Put, Delete } from '@tekir/http-decorators'
import type { HttpContext } from '@tekir/core'
import { db } from '#services'

@Controller('/api')
export default class TodoController {
  @Get('/todos')
  async list() { return await db.query('SELECT * FROM todos') }

  @Post('/todos')
  async create(ctx: HttpContext) {
    await db.run('INSERT INTO todos (title) VALUES (?)', [ctx.body.title])
    return await db.queryOne('SELECT * FROM todos ORDER BY id DESC LIMIT 1')
  }

  @Put('/todos/:id')
  async update(ctx: HttpContext) {
    await db.run('UPDATE todos SET done = ? WHERE id = ?', [ctx.body.done ? 1 : 0, ctx.params.id])
    return await db.queryOne('SELECT * FROM todos WHERE id = ?', [ctx.params.id])
  }

  @Delete('/todos/:id')
  async remove(ctx: HttpContext) {
    await db.run('DELETE FROM todos WHERE id = ?', [ctx.params.id])
    return { deleted: true }
  }
}
