import type {
  ApiResult, AuthSession, CareSignal, ChangePage, CloudTransport, CoupleSpace, DeviceSession, MaintenanceStatus, MediaUploadResult, NotificationJob, SecureCapsule, SpaceDeletion, SpaceExportJob, SpaceMember,
  SpaceInvite, SyncBatchResult, SyncCommand, SyncServerStatus, SystemAlert, UploadGrant, UploadIntent,
} from './cloud-contract'

const SESSION_KEY = 'quexin-local-cloud-session-v1'
import type { CompanionAction,CompanionState } from '../shared/companion.mjs'

export class LocalMockCloudTransport implements CloudTransport {
  private token = sessionStorage.getItem(SESSION_KEY) ?? ''

  get hasToken(): boolean { return Boolean(this.token) }

  async login(displayName: string): Promise<ApiResult<AuthSession>> {
    const result = await this.request<{ token: string; session: AuthSession }>('/v1/dev/sessions', { method: 'POST', body: JSON.stringify({ displayName }) }, false)
    if (!result.ok) return result
    this.token = result.data.token
    sessionStorage.setItem(SESSION_KEY, this.token)
    return { ...result, data: result.data.session }
  }

  logout(): void {
    this.token = ''
    sessionStorage.removeItem(SESSION_KEY)
  }

  getSession(): Promise<ApiResult<AuthSession | null>> { return this.request('/v1/session') }
  getCurrentSpace(): Promise<ApiResult<{ space: CoupleSpace; members: SpaceMember[] } | null>> { return this.request('/v1/spaces/current') }
  createSpace(input: { name: string; selfDisplayName: string }): Promise<ApiResult<{ space: CoupleSpace; member: SpaceMember }>> {
    return this.request('/v1/spaces', { method: 'POST', body: JSON.stringify(input) })
  }
  createInvite(spaceId: string, ttlHours: number): Promise<ApiResult<SpaceInvite>> {
    return this.request(`/v1/spaces/${spaceId}/invites`, { method: 'POST', body: JSON.stringify({ ttlHours }) })
  }
  acceptInvite(code: string, displayName: string): Promise<ApiResult<{ space: CoupleSpace; members: SpaceMember[] }>> {
    return this.request(`/v1/invites/${encodeURIComponent(code.trim().toUpperCase())}/accept`, { method: 'POST', body: JSON.stringify({ displayName }) })
  }
  revokeInvite(spaceId: string, inviteId: string): Promise<ApiResult<SpaceInvite>> {
    return this.request(`/v1/spaces/${spaceId}/invites/${inviteId}`, { method: 'DELETE' })
  }
  listMembers(spaceId: string): Promise<ApiResult<SpaceMember[]>> { return this.request(`/v1/spaces/${spaceId}/members`) }
  sync(spaceId: string, commands: SyncCommand[]): Promise<ApiResult<SyncBatchResult>> {
    return this.request(`/v1/spaces/${spaceId}/sync`, { method: 'POST', body: JSON.stringify({ commands }) })
  }
  changes(spaceId: string, cursor = ''): Promise<ApiResult<ChangePage>> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
    return this.request(`/v1/spaces/${spaceId}/changes${query}`)
  }
  createUpload(spaceId: string, input: UploadIntent): Promise<ApiResult<UploadGrant>> {
    return this.request(`/v1/spaces/${spaceId}/uploads`, { method: 'POST', body: JSON.stringify(input) })
  }
  completeUpload(spaceId: string, mediaId: string): Promise<ApiResult<{ mediaId: string; privateUrl: string }>> {
    return this.request(`/v1/spaces/${spaceId}/uploads/${mediaId}/complete`, { method: 'POST' })
  }
  exportSpace(spaceId: string): Promise<ApiResult<SpaceExportJob>> {
    return this.request(`/v1/spaces/${spaceId}/exports`, { method: 'POST' })
  }
  deleteSpace(spaceId: string, confirmation: string): Promise<ApiResult<{ deletionId: string; scheduledAt: string }>> {
    return this.request(`/v1/spaces/${spaceId}`, { method: 'DELETE', body: JSON.stringify({ confirmation }) })
  }

  private async request<T>(path: string, init: RequestInit = {}, authenticate = true): Promise<ApiResult<T>> {
    try {
      const headers = new Headers(init.headers)
      headers.set('content-type', 'application/json')
      if (authenticate && this.token) headers.set('authorization', `Bearer ${this.token}`)
      const response = await fetch(path, { ...init, headers, cache: 'no-store' })
      return await response.json() as ApiResult<T>
    } catch {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: '无法连接本地模拟服务，请运行 npm run dev:api', requestId: 'local-network' } }
    }
  }
}

export const localMockCloud = new LocalMockCloudTransport()

export class FormalCloudTransport implements CloudTransport {
  capsules(spaceId:string):Promise<ApiResult<SecureCapsule[]>>{return this.request(`/spaces/${spaceId}/capsules`)}
  createCapsule(spaceId:string,input:{title:string;body:string;unlockAt:string;visibility:'private'|'shared'}):Promise<ApiResult<SecureCapsule>>{return this.request(`/spaces/${spaceId}/capsules`,{method:'POST',body:JSON.stringify(input)})}
  openCapsule(spaceId:string,id:string):Promise<ApiResult<SecureCapsule>>{return this.request(`/spaces/${spaceId}/capsules/${id}`)}
  deleteCapsule(spaceId:string,id:string):Promise<ApiResult<{id:string}>>{return this.request(`/spaces/${spaceId}/capsules/${id}`,{method:'DELETE'})}
  careSignals(spaceId:string):Promise<ApiResult<CareSignal[]>>{return this.request(`/spaces/${spaceId}/care`)}
  publishCare(spaceId:string,input:{need:CareSignal['need'];message:string;hours:number}):Promise<ApiResult<CareSignal>>{return this.request(`/spaces/${spaceId}/care`,{method:'POST',body:JSON.stringify(input)})}
  revokeCare(spaceId:string):Promise<ApiResult<CareSignal>>{return this.request(`/spaces/${spaceId}/care`,{method:'DELETE'})}
  sharing(spaceId:string):Promise<ApiResult<{entities:Array<{entity:'record'|'plan'|'journal';id:string;title:string;visibility:string;revision:number}>;media:Array<{id:string;title:string;visibility:string}>}>>{return this.request(`/spaces/${spaceId}/sharing`)}
  withdraw(spaceId:string,entity:string,entityId:string,revision:number):Promise<ApiResult<{withdrawn:boolean;revision:number}>>{return this.request(`/spaces/${spaceId}/withdraw`,{method:'POST',body:JSON.stringify({entity,entityId,revision})})}
  withdrawMedia(id:string):Promise<ApiResult<{mediaId:string;visibility:string}>>{return this.request(`/media/${id}/withdraw`,{method:'POST'})}
  leaveSpace(spaceId:string,confirmation:string):Promise<ApiResult<{left:boolean;spaceId:string;remainingMember:boolean;cleanupPending?:boolean}>>{return this.request(`/spaces/${spaceId}/leave`,{method:'POST',body:JSON.stringify({confirmation})})}
  deleteAccount(password:string,confirmation:string):Promise<ApiResult<{accountDeleted:boolean;cleanupPending?:boolean}>>{return this.request('/account',{method:'DELETE',body:JSON.stringify({password,confirmation})})}
  companion(spaceId:string):Promise<ApiResult<CompanionState>> {return this.request(`/spaces/${spaceId}/companion`)}
  companionAction(spaceId:string,action:CompanionAction,expectedUserId?:string):Promise<ApiResult<CompanionState>> {return this.request(`/spaces/${spaceId}/companion/actions`,{method:'POST',body:JSON.stringify({...action,expectedUserId})})}
  authConfig():Promise<ApiResult<{developmentMailbox:boolean}>> { return this.request('/auth/config') }
  resendVerification(email:string):Promise<ApiResult<{sent:boolean}>> { return this.request('/auth/email/resend',{method:'POST',body:JSON.stringify({email})}) }
  register(email: string, password: string, displayName: string): Promise<ApiResult<AuthSession>> {
    return this.request('/auth/register', { method: 'POST', body: JSON.stringify({ email, password, displayName }) })
  }
  login(email: string, password: string): Promise<ApiResult<AuthSession>> {
    return this.request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
  }
  logout(): Promise<ApiResult<{ loggedOut: boolean }>> { return this.request('/auth/logout', { method: 'POST' }) }
  requestEmailVerification(): Promise<ApiResult<{ sent:boolean }>> { return this.request('/auth/email/verify/request',{method:'POST'}) }
  verifyEmail(token:string): Promise<ApiResult<{ verified:boolean }>> { return this.request('/auth/email/verify',{method:'POST',body:JSON.stringify({token})}) }
  forgotPassword(email:string): Promise<ApiResult<{ sent:boolean }>> { return this.request('/auth/password/forgot',{method:'POST',body:JSON.stringify({email})}) }
  resetPassword(token:string,password:string): Promise<ApiResult<{ reset:boolean }>> { return this.request('/auth/password/reset',{method:'POST',body:JSON.stringify({token,password})}) }
  listDeviceSessions(): Promise<ApiResult<DeviceSession[]>> { return this.request('/auth/sessions') }
  revokeDeviceSession(id:string): Promise<ApiResult<{revoked:boolean;current:boolean}>> { return this.request(`/auth/sessions/${id}`,{method:'DELETE'}) }
  listSessions(): Promise<ApiResult<DeviceSession[]>> { return this.request('/auth/sessions') }
  revokeSession(id:string): Promise<ApiResult<{revoked:boolean;current:boolean}>> { return this.request(`/auth/sessions/${id}`,{method:'DELETE'}) }
  devLatestToken(email:string,purpose:'verify_email'|'reset_password'): Promise<ApiResult<{token:string;expiresAt:string}>> { return this.request(`/dev/mailbox/latest?email=${encodeURIComponent(email)}&purpose=${purpose}`) }
  getSession(): Promise<ApiResult<AuthSession | null>> { return this.request('/session') }
  getCurrentSpace(): Promise<ApiResult<{ space: CoupleSpace; members: SpaceMember[] } | null>> { return this.request('/spaces/current') }
  createSpace(input: { name: string; selfDisplayName: string }): Promise<ApiResult<{ space: CoupleSpace; member: SpaceMember }>> { return this.request('/spaces', { method: 'POST', body: JSON.stringify(input) }) }
  createInvite(spaceId: string, ttlHours: number): Promise<ApiResult<SpaceInvite>> { return this.request(`/spaces/${spaceId}/invites`, { method: 'POST', body: JSON.stringify({ ttlHours }) }) }
  acceptInvite(code: string, displayName: string): Promise<ApiResult<{ space: CoupleSpace; members: SpaceMember[] }>> { return this.request(`/invites/${encodeURIComponent(code.trim().toUpperCase())}/accept`, { method: 'POST', body: JSON.stringify({ displayName }) }) }
  revokeInvite(spaceId: string, inviteId: string): Promise<ApiResult<SpaceInvite>> { return this.request(`/spaces/${spaceId}/invites/${inviteId}`, { method: 'DELETE' }) }
  listMembers(spaceId: string): Promise<ApiResult<SpaceMember[]>> { return this.request(`/spaces/${spaceId}/members`) }
  sync(spaceId: string, commands: SyncCommand[],expectedUserId?:string): Promise<ApiResult<SyncBatchResult>> { return this.request(`/spaces/${spaceId}/sync`, { method: 'POST', body: JSON.stringify({ commands,expectedUserId }) }) }
  changes(spaceId: string, cursor = ''): Promise<ApiResult<ChangePage>> { return this.request(`/spaces/${spaceId}/changes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`) }
  syncStatus(spaceId:string):Promise<ApiResult<SyncServerStatus>> { return this.request(`/spaces/${spaceId}/sync/status`) }
  createUpload(spaceId: string, input: UploadIntent): Promise<ApiResult<UploadGrant>> { return this.request(`/spaces/${spaceId}/uploads`, { method: 'POST', body: JSON.stringify(input) }) }
  completeUpload(spaceId: string, mediaId: string): Promise<ApiResult<{ mediaId: string; privateUrl: string }>> { return this.request(`/spaces/${spaceId}/uploads/${mediaId}/complete`, { method: 'POST' }) }
  async uploadImage(spaceId:string,file:File,scope:'private'|'shared'='shared',attachment?:{entityType:'record'|'journal';entityId:string}):Promise<ApiResult<MediaUploadResult>> {
    const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer())
    const sha256=[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('')
    const grant=await this.createUpload(spaceId,{filename:file.name,contentType:file.type,size:file.size,sha256,scope,...attachment})
    if(!grant.ok)return grant
    try{
      const response=await fetch(`/formal${grant.data.uploadUrl}`,{method:'PUT',headers:grant.data.headers,body:file,credentials:'include',cache:'no-store'})
      return await response.json() as ApiResult<MediaUploadResult>
    }catch{return{ok:false,error:{code:'INTERNAL_ERROR',message:'图片上传失败，请检查正式本地 API',requestId:'formal-media-network'}}}
  }
  mediaUrl(serverPath:string):string { return `/formal${serverPath}` }
  deleteMedia(mediaId:string):Promise<ApiResult<{mediaId:string;deleted:boolean}>> { return this.request(`/media/${encodeURIComponent(mediaId)}`,{method:'DELETE'}) }
  cleanupMedia(spaceId:string):Promise<ApiResult<{removed:number}>> { return this.request(`/spaces/${spaceId}/media/cleanup`,{method:'POST'}) }
  maintenanceStatus():Promise<ApiResult<MaintenanceStatus|null>> { return this.request('/maintenance/status') }
  systemAlerts():Promise<ApiResult<SystemAlert[]>> { return this.request('/system/alerts') }
  notifications():Promise<ApiResult<NotificationJob[]>> { return this.request('/notifications') }
  exportSpace(spaceId: string): Promise<ApiResult<SpaceExportJob>> { return this.request(`/spaces/${spaceId}/exports`, { method: 'POST' }) }
  deleteSpace(spaceId: string, confirmation: string): Promise<ApiResult<{ deletionId: string; scheduledAt: string }>> { return this.request(`/spaces/${spaceId}`, { method: 'DELETE', body: JSON.stringify({ confirmation }) }) }
  deletionStatus(spaceId:string):Promise<ApiResult<SpaceDeletion|null>> { return this.request(`/spaces/${spaceId}/deletion`) }
  cancelDeletion(spaceId:string):Promise<ApiResult<SpaceDeletion>> { return this.request(`/spaces/${spaceId}/deletion/cancel`,{method:'POST'}) }
  deleteSpaceNow(spaceId:string,confirmation:string):Promise<ApiResult<{deleted:boolean;spaceId:string}>> { return this.request(`/spaces/${spaceId}/deletion/now`,{method:'DELETE',body:JSON.stringify({confirmation})}) }
  exportDownloadUrl(path:string):string{return`/formal${path}`}

  private async request<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
    try {
      const headers = new Headers(init.headers); headers.set('content-type', 'application/json')
      const response = await fetch(`/formal/v1${path}`, { ...init, headers, credentials: 'include', cache: 'no-store' })
      return await response.json() as ApiResult<T>
    } catch {
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: '正式本地 API 未启动，请运行 npm run dev:api:postgres-local', requestId: 'formal-network' } }
    }
  }
}

export const formalCloud = new FormalCloudTransport()
