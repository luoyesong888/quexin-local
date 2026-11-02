import type { Journal, PlanItem, RecordItem } from './domain'

export type Visibility = 'private' | 'shared' | 'pending_partner' | 'sealed_secret'
export type MemberRole = 'owner' | 'partner'
export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

export type AuthSession = {
  userId: string
  displayName: string
  email?: string
  emailVerified?: boolean
  sessionId?: string
  expiresAt: string
}

export type DeviceSession = { id:string; userAgent:string; createdAt:string; lastSeenAt:string; expiresAt:string; current:boolean }

export type CoupleSpace = {
  id: string
  name: string
  createdAt: string
  revision: number
}

export type SpaceMember = {
  spaceId: string
  userId: string
  role: MemberRole
  displayName: string
  joinedAt: string
}

export type SpaceInvite = {
  id: string
  spaceId: string
  code: string
  status: InviteStatus
  expiresAt: string
  createdBy: string
}

export type CloudEntity<T> = T & {
  spaceId: string
  ownerId: string
  visibility: Visibility
  revision: number
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export type CloudRecord = CloudEntity<RecordItem>
export type CloudPlan = CloudEntity<PlanItem>
export type CloudJournal = CloudEntity<Journal>

export type SyncEntity = 'record' | 'plan' | 'journal' | 'pet_action' | 'space_settings'
export type SyncCommand = {
  commandId: string
  entity: SyncEntity
  entityId: string
  operation: 'create' | 'update' | 'delete' | 'append' | 'withdraw' | 'publish'
  expectedRevision: number | null
  payload: unknown
  clientTime: string
}

export type SyncConflict = {
  commandId: string
  entity: SyncEntity
  entityId: string
  expectedRevision: number | null
  actualRevision: number
  serverValue: unknown
}

export type SyncBatchResult = {
  accepted: Array<{ commandId: string; entityId: string; revision: number; updatedAt: string }>
  conflicts: SyncConflict[]
  cursor: string
}
export type SyncServerStatus={cursor:string;entities:{record:number;plan:number;journal:number};pendingUploads:number;readyMedia:number}
export type SpaceExportJob={jobId:string;status:'ready';expiresAt:string;downloadUrl:string;sha256:string;byteSize:number}
export type SpaceDeletion={id?:string;deletionId?:string;spaceId?:string;requestedBy?:string;createdAt?:string;scheduledAt:string;cancelledAt?:string|null}
export type MaintenanceStatus={id:number;startedAt:string;completedAt:string;status:'success'|'partial'|'failed';expiredExports:number;deletedSpaces:number;removedMedia:number;expiredSessions:number;expiredTokens:number}
export type SystemAlert={id:number;severity:'warning'|'critical';source:string;code:string;message:string;createdAt:string}
export type NotificationJob={id:string;recipient:string;kind:'verify_email'|'reset_password'|'system_alert';status:'pending'|'sending'|'sent'|'retry'|'dead';attempts:number;createdAt:string;sentAt?:string|null;lastAttemptAt?:string|null;lastError?:string|null;provider?:string|null;providerMessageId?:string|null;accepted?:string[]|null;rejected?:string[]|null}
export type CareSignal={spaceId:string;userId:string;displayName:string;need:'想安静'|'想聊聊'|'想被听见'|'一起想办法';message:string;expiresAt:string;version:number;createdAt:string;updatedAt:string;revokedAt?:string|null}
export type SecureCapsule={id:string;title:string;unlockAt:string;visibility:'private'|'shared';createdAt:string;canOpen:boolean;body?:string;ownerId?:string}

export type ChangePage = {
  records: CloudRecord[]
  plans: CloudPlan[]
  journals: CloudJournal[]
  events: Array<{ id: string; entity: SyncEntity; entityId: string; revision: number; operation: string; updatedAt: string }>
  nextCursor: string
}

export type UploadIntent = {
  filename: string
  contentType: string
  size: number
  sha256: string
  scope: 'private' | 'shared'
  entityType?: 'record' | 'journal'
  entityId?: string
}

export type UploadGrant = {
  mediaId: string
  uploadUrl: string
  method: 'PUT'
  headers: Record<string, string>
  expiresAt: string
}

export type MediaUploadResult = {
  mediaId: string
  status: 'ready'
  privateUrl: string
  thumbnailUrl: string
  width: number
  height: number
}

export type ApiProblemCode =
  | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_FAILED'
  | 'EMAIL_EXISTS' | 'INVALID_CREDENTIALS' | 'REVISION_CONFLICT'
  | 'EMAIL_NOT_VERIFIED' | 'INVALID_TOKEN' | 'INVITE_EXPIRED' | 'SPACE_FULL' | 'RATE_LIMITED'
  | 'INVALID_IMAGE' | 'UPLOAD_EXPIRED' | 'UPLOAD_COMPLETED' | 'INTERNAL_ERROR'
  | 'EXPORT_TOO_LARGE' | 'CONFIRMATION_MISMATCH'

export type ApiProblem = {
  code: ApiProblemCode
  message: string
  requestId: string
  fieldErrors?: Record<string, string>
  retryAfterSeconds?: number
}

export type ApiResult<T> = { ok: true; data: T; requestId: string } | { ok: false; error: ApiProblem }

/**
 * 正式云端实现只依赖这组能力。浏览器页面不会直接访问数据库或对象存储密钥。
 * HTTP、WorkBuddy 或其他平台实现均可适配此接口。
 */
export interface CloudTransport {
  getSession(): Promise<ApiResult<AuthSession | null>>
  getCurrentSpace(): Promise<ApiResult<{ space: CoupleSpace; members: SpaceMember[] } | null>>
  createSpace(input: { name: string; selfDisplayName: string }): Promise<ApiResult<{ space: CoupleSpace; member: SpaceMember }>>
  createInvite(spaceId: string, ttlHours: number): Promise<ApiResult<SpaceInvite>>
  acceptInvite(code: string, displayName: string): Promise<ApiResult<{ space: CoupleSpace; members: SpaceMember[] }>>
  revokeInvite(spaceId: string, inviteId: string): Promise<ApiResult<SpaceInvite>>
  listMembers(spaceId: string): Promise<ApiResult<SpaceMember[]>>
  sync(spaceId: string, commands: SyncCommand[], expectedUserId?:string): Promise<ApiResult<SyncBatchResult>>
  changes(spaceId: string, cursor?: string): Promise<ApiResult<ChangePage>>
  createUpload(spaceId: string, input: UploadIntent): Promise<ApiResult<UploadGrant>>
  completeUpload(spaceId: string, mediaId: string): Promise<ApiResult<{ mediaId: string; privateUrl: string }>>
  exportSpace(spaceId: string): Promise<ApiResult<SpaceExportJob>>
  deleteSpace(spaceId: string, confirmation: string): Promise<ApiResult<{ deletionId: string; scheduledAt: string }>>
}
