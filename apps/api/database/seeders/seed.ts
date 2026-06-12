import { User } from '~/models/user'
import { Project } from '~/models/project'
import { Task } from '~/models/task'
import { Comment } from '~/models/comment'

export async function run() {
  if ((await User.count()) > 0) return

  await User.createMany([
    {
      name: 'Alice Admin',
      email: 'alice@tekir.dev',
      password: 'hashed_password_admin',
      role: 'admin',
      bio: 'Platform administrator and lead developer.',
    },
    {
      name: 'Bob Builder',
      email: 'bob@tekir.dev',
      password: 'hashed_password_bob',
      role: 'member',
      bio: 'Full-stack developer focused on backend services.',
    },
    {
      name: 'Carol Designer',
      email: 'carol@tekir.dev',
      password: 'hashed_password_carol',
      role: 'member',
      bio: 'UI/UX designer and frontend developer.',
    },
  ])
  await Project.createMany([
    {
      name: 'tekir Core Platform',
      description: 'The core API platform powering all tekir services.',
      ownerId: 1,
      status: 'active',
      isPublic: false,
    },
    {
      name: 'Marketing Website',
      description: 'Public-facing marketing site and documentation portal.',
      ownerId: 1,
      status: 'active',
      isPublic: true,
    },
  ])
  await Task.createMany([
    {
      title: 'Set up authentication middleware',
      description: 'Implement JWT and API token guards for all protected routes.',
      projectId: 1,
      assigneeId: 2,
      status: 'done',
      priority: 'high',
      dueDate: '2026-03-01',
      completedAt: '2026-02-28',
    },
    {
      title: 'Design database schema',
      description: 'Define all tables, relations, and indexes for the core platform.',
      projectId: 1,
      assigneeId: 2,
      status: 'done',
      priority: 'high',
      dueDate: '2026-02-15',
      completedAt: '2026-02-14',
    },
    {
      title: 'Build project management endpoints',
      description: 'CRUD endpoints for projects, tasks, and comments with full validation.',
      projectId: 1,
      assigneeId: 2,
      status: 'in_progress',
      priority: 'high',
      dueDate: '2026-04-01',
    },
    {
      title: 'Design landing page mockups',
      description: 'Create high-fidelity Figma mockups for the homepage and features page.',
      projectId: 2,
      assigneeId: 3,
      status: 'in_progress',
      priority: 'medium',
      dueDate: '2026-04-10',
    },
    {
      title: 'Write API documentation',
      description: 'Document all public endpoints using OpenAPI/Swagger annotations.',
      projectId: 1,
      assigneeId: null,
      status: 'todo',
      priority: 'low',
      dueDate: '2026-05-01',
    },
  ])
  await Comment.createMany([
    {
      body: 'Auth middleware is working great in staging. Ready for review.',
      taskId: 1,
      userId: 2,
    },
    {
      body: 'Looks good! Merging this into main.',
      taskId: 1,
      userId: 1,
    },
    {
      body: 'I have drafted the initial schema. Please review the foreign key constraints on tasks.',
      taskId: 2,
      userId: 2,
    },
  ])
}
