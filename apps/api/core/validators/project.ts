import { z } from 'zod'

export const createProjectSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  description: z.string().max(2000).trim().optional(),
  status: z.enum(['active', 'archived', 'completed']).default('active'),
})

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).trim().optional(),
  description: z.string().max(2000).trim().optional(),
  status: z.enum(['active', 'archived', 'completed']).optional(),
})
