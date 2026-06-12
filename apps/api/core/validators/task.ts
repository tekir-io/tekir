import { z } from 'zod'

export const createTaskSchema = z.object({
  title: z.string().min(1).max(300).trim(),
  description: z.string().max(5000).trim().optional(),
  projectId: z.number().int().positive(),
  assigneeId: z.number().int().positive().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  status: z.enum(['todo', 'in_progress', 'review', 'done']).default('todo'),
  dueDate: z.string().datetime().optional(),
})

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(300).trim().optional(),
  description: z.string().max(5000).trim().optional(),
  assigneeId: z.number().int().positive().nullable().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  status: z.enum(['todo', 'in_progress', 'review', 'done']).optional(),
  dueDate: z.string().datetime().nullable().optional(),
})

export const assignSchema = z.object({
  assigneeId: z.number().int().positive(),
})
