import { BasePolicy } from '@tekir/authorize'
import type { User } from '~/models/user'
import type { Project } from '~/models/project'

export class ProjectPolicy extends BasePolicy {
  view(user: User, project: Project) {
    return project.isPublic || user.id === project.ownerId
  }

  update(user: User, project: Project) {
    return user.id === project.ownerId
  }

  delete(user: User, project: Project) {
    return user.id === project.ownerId || user.role === 'admin'
  }
}
