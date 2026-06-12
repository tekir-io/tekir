// Types

export interface MailPayload {
  to: string
  subject: string
  html?: string
  text?: string
  [key: string]: unknown
}

export interface DatabasePayload {
  type: string
  title: string
  body: string
  [key: string]: unknown
}

export interface PushPayload {
  title: string
  body: string
  icon?: string
  data?: Record<string, unknown>
  [key: string]: unknown
}

export type ChannelName = 'mail' | 'database' | 'push' | 'log'

export interface DatabaseRow {
  id: string
  user_id: string
  type: string
  title: string
  body: string
  data: Record<string, unknown>
  read_at: string | null
  created_at: string
}

// DB adapter interface — implementations injected via NotificationProvider

export interface DbAdapter {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>
  execute(sql: string, params?: unknown[]): Promise<void>
}

// FCM config interface

export interface FcmConfig {
  /**
   * Legacy FCM server key. When provided (and no v1 credentials are set), the
   * legacy HTTP endpoint and `Authorization: key=...` scheme are used so the
   * auth header and endpoint match.
   */
  serverKey?: string
  /**
   * GCP project id. Required for the FCM HTTP v1 API.
   */
  projectId?: string
  /**
   * OAuth2 bearer access token for the FCM HTTP v1 API. Provide either this or
   * {@link getAccessToken}. When set, the v1 endpoint and `message.topic`
   * schema are used.
   */
  accessToken?: string
  /**
   * Async provider for a fresh OAuth2 access token (preferred over a static
   * token so it can be refreshed). Used by the v1 API.
   */
  getAccessToken?: () => Promise<string>
  /** Override the FCM endpoint. Defaults to the v1 or legacy URL as appropriate. */
  endpoint?: string
}

// Notification config

export interface NotificationConfig {
  db?: DbAdapter
  fcm?: FcmConfig
  defaultChannels?: ChannelName[]
}

import type { BaseNotification } from './base'

// Sent record used for fake/testing

export interface SentRecord {
  userId: string
  channel: string
  notification: BaseNotification
  payload: unknown
}
