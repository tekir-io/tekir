export { Auth } from './auth_manager'
export { authenticate, silentAuth, guest, attachAuth } from './middleware'
export { SessionGuard } from './guards/session_guard'
export { JwtGuard } from './guards/jwt_guard'
export { DatabaseTokenGuard } from './guards/database_token_guard'
export { AccessTokenGuard } from './guards/access_token_guard'
export { BasicAuthGuard } from './guards/basic_auth_guard'
export { AuthProvider } from './provider'
export type {
  TekirAuthUser, AuthUser, AuthGuard, AuthConfig, AuthState,
  SessionGuardConfig, JwtGuardConfig, DatabaseTokenGuardConfig,
  BasicAuthGuardConfig, TokenVerifier, CredentialVerifier,
  JwtPayload, AccessToken, AuthModel,
} from './types'

import type { AuthState } from './types'

declare module '@tekir/core' {
  interface HttpContext {
    auth: AuthState
  }
}
