import { randomUUID } from 'node:crypto'
import { initialCompanion,applyCompanionAction,memoryContribution } from '../../shared/companion.mjs'
import {transition} from './sharing-rules.mjs'

export class StoreError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status }
}

export class MemoryStore {
  constructor() {
    this.users = new Map(); this.usersByEmail = new Map(); this.sessions = new Map()
    this.spaces = new Map(); this.members = new Map(); this.invites = new Map()
    this.entities = new Map(); this.events = new Map(); this.commands = new Map()
    this.media = new Map()
    this.exportJobs = new Map(); this.deletionRequests = new Map()
    this.notifications=[]
    this.companions=new Map();this.companionCommands=new Map()
    this.careSignals=new Map()
    this.capsules=new Map()
    this.growthSources=new Map()
  }

  async close() {}
  async health(){return true}
  async createCapsule(userId,spaceId,input,encrypted){this.requireMember(userId,spaceId);const id=randomUUID(),now=new Date().toISOString(),capsule={id,spaceId,ownerId:userId,title:input.title,unlockAt:input.unlockAt,visibility:input.visibility,...encrypted,createdAt:now,openedAt:null,deletedAt:null};this.capsules.set(id,capsule);return capsule}
  async capsulesFor(userId,spaceId){this.requireMember(userId,spaceId);return[...this.capsules.values()].filter(item=>item.spaceId===spaceId&&!item.deletedAt&&(item.visibility==='shared'||item.ownerId===userId)).map(item=>({id:item.id,spaceId,title:item.title,ownerId:item.ownerId,visibility:item.visibility,unlockAt:item.unlockAt,createdAt:item.createdAt,canOpen:item.unlockAt<=new Date().toISOString()}))}
  async capsuleForOpen(userId,spaceId,id){this.requireMember(userId,spaceId);const item=this.capsules.get(id);if(!item||item.spaceId!==spaceId||item.deletedAt||(item.visibility!=='shared'&&item.ownerId!==userId))throw new StoreError('NOT_FOUND','胶囊不存在或无权查看',404);if(item.unlockAt>new Date().toISOString())throw new StoreError('CAPSULE_LOCKED','还没有到约定开启时间',423);item.openedAt??=new Date().toISOString();return item}
  async deleteCapsule(userId,spaceId,id){this.requireMember(userId,spaceId);const item=this.capsules.get(id);if(!item||item.spaceId!==spaceId||item.ownerId!==userId||item.deletedAt)throw new StoreError('NOT_FOUND','胶囊不存在或无权删除',404);item.deletedAt=new Date().toISOString();return item}
  async publishCare(userId,spaceId,input){
    const actor=this.requireMember(userId,spaceId),needs=['想安静','想聊聊','想被听见','一起想办法'],hours=Math.max(1,Math.min(72,Number(input.hours)||8)),message=String(input.message??'').trim()
    if(!needs.includes(input.need)||message.length>280)throw new StoreError('VALIDATION_FAILED','请检查需要类型和分享文字',400)
    const key=`${spaceId}:${userId}`,current=this.careSignals.get(key),now=new Date(),signal={spaceId,userId,displayName:actor.displayName,need:input.need,message,expiresAt:new Date(now.getTime()+hours*3600000).toISOString(),version:(current?.version??0)+1,createdAt:current?.createdAt??now.toISOString(),updatedAt:now.toISOString(),revokedAt:null};this.careSignals.set(key,signal);return signal
  }
  async careSignalsFor(userId,spaceId){this.requireMember(userId,spaceId);const now=new Date().toISOString();return[...this.careSignals.values()].filter(item=>item.spaceId===spaceId&&!item.revokedAt&&item.expiresAt>now)}
  async revokeCare(userId,spaceId){this.requireMember(userId,spaceId);const item=this.careSignals.get(`${spaceId}:${userId}`);if(!item||item.revokedAt)throw new StoreError('NOT_FOUND','没有可撤回的关怀分享',404);item.revokedAt=new Date().toISOString();item.updatedAt=item.revokedAt;item.version++;return item}
  bumpPrivacy(spaceId){const space=this.spaces.get(spaceId);if(space)space.privacyRevision=(space.privacyRevision??0)+1}
  eventId(spaceId){const space=this.spaces.get(spaceId);space.eventSequence=(space.eventSequence??0)+1;return String(space.eventSequence)}
  async sharing(userId,spaceId){
    this.requireMember(userId,spaceId)
    return {entities:[...this.entities.get(spaceId).entries()].filter(([,e])=>e.ownerId===userId&&!e.deletedAt).map(([key,e])=>({entity:key.split(':')[0],id:e.id,title:e.title??'未命名资料',visibility:e.visibility,revision:e.revision})),media:[...this.media.values()].filter(m=>m.spaceId===spaceId&&m.ownerId===userId&&!m.deletedAt&&m.status==='ready').map(m=>({id:m.id,title:m.originalFilename,visibility:m.visibility}))}
  }
  async withdrawMedia(userId,mediaId){
    const media=await this.mediaForRead(userId,mediaId)
    if(media.ownerId!==userId)throw new StoreError('FORBIDDEN','只有上传者可以撤回照片',403)
    media.visibility='private';this.bumpPrivacy(media.spaceId)
    for(const [key,e] of this.entities.get(media.spaceId))if(e.ownerId===userId&&!e.deletedAt&&e.visibility==='shared'&&(e.mediaId===mediaId||media.entityId===e.id&&media.entityType===key.split(':')[0])){e.visibility='private';e.mediaScope='private';e.revision++;e.updatedAt=new Date().toISOString();this.events.get(media.spaceId).push({id:this.eventId(media.spaceId),entity:key.split(':')[0],entityId:e.id,revision:e.revision,operation:'delete',visibility:'shared',ownerId:userId,updatedAt:e.updatedAt})}
    return media
  }
  async endMembership(userId,removeAccount=false){
    const user=this.users.get(userId);if(!user)throw new StoreError('NOT_FOUND','账号不存在',404)
    const current=this.membershipForUser(userId);let media=[],exports=[],remainingMember=false
    if(current){
      const spaceId=current.spaceId,survivor=this.members.get(spaceId).find(m=>m.userId!==userId)
      if(!survivor){const removed=await this.deleteSpaceNow(userId,spaceId);media=removed.media;exports=removed.exports}
      else{
        remainingMember=true;media=[...this.media.values()].filter(m=>m.spaceId===spaceId&&m.ownerId===userId);exports=[...this.exportJobs.values()].filter(j=>j.spaceId===spaceId)
        const now=new Date().toISOString(),entities=this.entities.get(spaceId)
        const wasShared=new Set(this.events.get(spaceId).filter(e=>e.visibility==='shared').map(e=>e.entity+':'+e.entityId))
        this.events.set(spaceId,this.events.get(spaceId).filter(e=>e.ownerId!==userId))
        for(const [key,e] of entities)if(e.ownerId===userId){const next={id:e.id,spaceId,ownerId:survivor.userId,visibility:'shared',revision:e.revision+1,updatedAt:now,deletedAt:now};entities.set(key,next);if(e.visibility==='shared'||wasShared.has(key))this.events.get(spaceId).push({id:this.eventId(spaceId),entity:key.split(':')[0],entityId:e.id,revision:next.revision,operation:'delete',updatedAt:now,ownerId:survivor.userId,visibility:'shared'})}
        for(const m of media)this.media.delete(m.id);for(const j of exports)this.exportJobs.delete(j.id)
        for(const [code,invite] of this.invites)if(invite.spaceId===spaceId)this.invites.delete(code)
        for(const [key,actor] of this.companionCommands)if(actor===userId)this.companionCommands.delete(key)
        survivor.role='owner';this.members.set(spaceId,[survivor]);this.deletionRequests.delete(spaceId);this.spaces.get(spaceId).name='留存的空间';this.bumpPrivacy(spaceId)
        this.careSignals.delete(`${spaceId}:${userId}`)
        const companion=this.companions.get(spaceId);if(companion){companion.profile.ownerName=survivor.displayName;companion.profile.partnerName='';companion.events=[];companion.pet.log=['空间成员已变更，小鹊继续由留下的成员照顾。']}
      }
    }
    if(removeAccount){this.users.delete(userId);this.usersByEmail.delete(user.email);for(const [key,s] of this.sessions)if(s.userId===userId)this.sessions.delete(key);for(const [key,t] of this.accountTokens??[])if(t.userId===userId)this.accountTokens.delete(key);this.notifications=this.notifications.filter(n=>n.recipient!==user.email)}
    return {spaceId:current?.spaceId??null,remainingMember,media,exports,accountDeleted:removeAccount}
  }
  async companion(userId,spaceId){
    this.requireMember(userId,spaceId)
    const state=this.companions.get(spaceId)??initialCompanion(this.members.get(spaceId),this.spaces.get(spaceId).createdAt),growthSources=[...(this.growthSources.get(spaceId)?.values()??[])].filter(item=>!item.revokedAt).map(({credited:_credited,revokedAt:_revoked,...item})=>item)
    return{...state,growthSources}
  }
  applyMemoryGrowth(spaceId,userId,command,entity){if(command.entity!=='record')return;const sources=this.growthSources.get(spaceId)??new Map();this.growthSources.set(spaceId,sources);const current=sources.get(command.entityId),active=!entity.deletedAt&&entity.visibility==='shared'&&entity.status==='confirmed';if(!active){if(current)current.revokedAt=new Date().toISOString();const state=this.companions.get(spaceId);if(state)state.events=state.events.filter(event=>event.sourceId!==command.entityId);return}const contribution=memoryContribution(entity),now=new Date().toISOString();if(current){Object.assign(current,{title:entity.title,contribution,revokedAt:null});return}const actor=this.requireMember(userId,spaceId),state=this.companions.get(spaceId)??initialCompanion(this.members.get(spaceId),this.spaces.get(spaceId).createdAt),next=applyCompanionAction(state,{commandId:`memory:${command.entityId}`,kind:'memory_growth',sourceId:command.entityId,title:entity.title,contribution},actor,now);this.companions.set(spaceId,next);sources.set(command.entityId,{sourceId:command.entityId,title:entity.title,contribution,addedAt:now,credited:true,revokedAt:null})}
  async companionAction(userId,spaceId,action){
    const actor=this.requireMember(userId,spaceId),key=`${spaceId}:${action.commandId}`
    const current=this.companions.get(spaceId)??initialCompanion(this.members.get(spaceId),this.spaces.get(spaceId).createdAt)
    if(this.companionCommands.has(key))return current
    let next;try{next=applyCompanionAction(current,action,actor)}catch(error){throw new StoreError('VALIDATION_FAILED',error.message)}
    this.companions.set(spaceId,next);this.companionCommands.set(key,userId);return next
  }
  async createUser({ email, displayName, passwordHash }) {
    if (this.usersByEmail.has(email)) throw new StoreError('EMAIL_EXISTS', '这个邮箱已经注册', 409)
    const user = { id: randomUUID(), email, displayName, passwordHash, emailVerifiedAt: null, createdAt: new Date().toISOString() }
    this.users.set(user.id, user); this.usersByEmail.set(email, user.id)
    return user
  }
  async userByEmail(email) { const id = this.usersByEmail.get(email); return id ? this.users.get(id) : null }
  async userById(id) { return this.users.get(id) ?? null }
  async createSession({ userId, tokenHash, expiresAt, userAgent = '', ipHash = '' }) {
    const session = { id: randomUUID(), userId, expiresAt, userAgent, ipHash, createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), revokedAt: null }
    this.sessions.set(tokenHash, session); return session
  }
  async sessionByHash(tokenHash) {
    const session = this.sessions.get(tokenHash)
    if (!session || session.revokedAt || session.expiresAt <= new Date().toISOString()) return null
    session.lastSeenAt = new Date().toISOString()
    const user = this.users.get(session.userId)
    return user ? { session, user } : null
  }
  async deleteSession(tokenHash) { this.sessions.delete(tokenHash) }
  async listSessions(userId) { return [...this.sessions.entries()].filter(([,session]) => session.userId === userId && !session.revokedAt && session.expiresAt > new Date().toISOString()).map(([tokenHash, session]) => ({ ...session, tokenHash })) }
  async revokeSession(userId, sessionId) { const found = [...this.sessions.values()].find(session => session.id === sessionId && session.userId === userId); if (!found) throw new StoreError('NOT_FOUND', '没有找到这个登录设备', 404); found.revokedAt = new Date().toISOString() }
  async revokeAllSessions(userId) { for (const session of this.sessions.values()) if (session.userId === userId) session.revokedAt = new Date().toISOString() }
  async createAccountToken({ userId, purpose, tokenHash, expiresAt }) { this.accountTokens ??= new Map(); for (const token of this.accountTokens.values()) if (token.userId === userId && token.purpose === purpose && !token.usedAt) token.usedAt = new Date().toISOString(); this.accountTokens.set(tokenHash, { id: randomUUID(), userId, purpose, expiresAt, usedAt: null, createdAt: new Date().toISOString() }) }
  async consumeAccountToken(tokenHash, purpose) { const token = this.accountTokens?.get(tokenHash); if (!token || token.purpose !== purpose || token.usedAt || token.expiresAt <= new Date().toISOString()) return null; token.usedAt = new Date().toISOString(); return this.users.get(token.userId) ?? null }
  async verifyUser(userId) { const user = this.users.get(userId); if (user) user.emailVerifiedAt = new Date().toISOString(); return user }
  async updatePassword(userId, passwordHash) { const user = this.users.get(userId); if (!user) throw new StoreError('NOT_FOUND', '账号不存在', 404); user.passwordHash = passwordHash; return user }
  async verifyEmailToken(tokenHash) {
    return this.applyAccountToken(tokenHash, 'verify_email')
  }
  async resetPasswordWithToken(tokenHash, passwordHash) {
    if(typeof passwordHash!=='string'||!passwordHash)throw new Error('密码摘要不能为空')
    return this.applyAccountToken(tokenHash, 'reset_password', passwordHash)
  }
  applyAccountToken(tokenHash, purpose, passwordHash) {
    const token=this.accountTokens?.get(tokenHash),now=new Date().toISOString()
    if(!token||token.purpose!==purpose||token.usedAt||token.expiresAt<=now)return null
    const user=this.users.get(token.userId)
    if(!user)return null
    if(purpose==='verify_email')user.emailVerifiedAt??=now
    else { user.passwordHash=passwordHash;for(const session of this.sessions.values())if(session.userId===user.id)session.revokedAt=now }
    token.usedAt=now
    return user
  }
  membershipForUser(userId) {
    for (const [spaceId, members] of this.members) { const member = members.find(item => item.userId === userId); if (member) return { spaceId, member } }
    return null
  }
  async currentSpace(userId) {
    const found = this.membershipForUser(userId)
    return found ? { space: this.spaces.get(found.spaceId), members: this.members.get(found.spaceId) } : null
  }
  async createSpace(userId, { name, displayName }) {
    if (this.membershipForUser(userId)) throw new StoreError('ALREADY_IN_SPACE', '当前账号已经加入一个空间', 409)
    const id = randomUUID(), createdAt = new Date().toISOString()
    const space = { id, name, createdAt, revision: 0 }
    const member = { spaceId: id, userId, role: 'owner', displayName, joinedAt: createdAt }
    this.spaces.set(id, space); this.members.set(id, [member]); this.entities.set(id, new Map()); this.events.set(id, []); this.commands.set(id, new Map())
    this.growthSources.set(id,new Map())
    return { space, member }
  }
  requireMember(userId, spaceId, owner = false) {
    const member = (this.members.get(spaceId) ?? []).find(item => item.userId === userId)
    if (!member || (owner && member.role !== 'owner')) throw new StoreError('FORBIDDEN', owner ? '只有空间创建者可以执行此操作' : '你不是这个空间的成员', 403)
    return member
  }
  async listMembers(userId, spaceId) { this.requireMember(userId, spaceId); return this.members.get(spaceId) }
  async createInvite(userId, spaceId, ttlHours) {
    this.requireMember(userId, spaceId, true)
    for (const invite of this.invites.values()) if (invite.spaceId === spaceId && invite.status === 'pending') invite.status = 'revoked'
    let code; do { code = Math.random().toString(36).slice(2, 8).toUpperCase() } while (this.invites.has(code))
    const invite = { id: randomUUID(), code, spaceId, status: 'pending', createdBy: userId, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + ttlHours * 3_600_000).toISOString() }
    this.invites.set(code, invite); return invite
  }
  async revokeInvite(userId, spaceId, inviteId) {
    this.requireMember(userId, spaceId, true)
    const invite = [...this.invites.values()].find(item => item.id === inviteId && item.spaceId === spaceId)
    if (!invite) throw new StoreError('NOT_FOUND', '没有找到这个邀请', 404)
    invite.status = 'revoked'; return invite
  }
  async acceptInvite(userId, code, displayName) {
    if (this.membershipForUser(userId)) throw new StoreError('ALREADY_IN_SPACE', '当前账号已经加入一个空间', 409)
    const invite = this.invites.get(code)
    if (!invite || invite.status !== 'pending' || invite.expiresAt <= new Date().toISOString()) throw new StoreError('INVITE_EXPIRED', '邀请码无效或已经过期', 410)
    const members = this.members.get(invite.spaceId) ?? []
    if (members.length >= 2) throw new StoreError('SPACE_FULL', '这个空间已经有两位成员', 409)
    const member = { spaceId: invite.spaceId, userId, role: 'partner', displayName, joinedAt: new Date().toISOString() }
    members.push(member); invite.status = 'accepted'; invite.acceptedBy = userId
    const companion=this.companions.get(invite.spaceId);if(companion&&companion.profile.partnerName===''){companion.profile.partnerName=displayName;companion.revision++}
    return { space: this.spaces.get(invite.spaceId), members }
  }
  async sync(userId, spaceId, commands) {
    this.requireMember(userId, spaceId)
    const entities = this.entities.get(spaceId), processed = this.commands.get(spaceId), events = this.events.get(spaceId), space = this.spaces.get(spaceId)
    const accepted = [], conflicts = []
    for (const command of commands.slice(0, 100)) {
      if (!command?.commandId || !command.entityId) continue
      if (processed.has(command.commandId)) { accepted.push(processed.get(command.commandId)); continue }
      const key = `${command.entity}:${command.entityId}`, current = entities.get(key), actualRevision = current?.revision ?? 0
      const change=transition(userId,current,command,(...args)=>new StoreError(...args))
      if (!change.valid) { conflicts.push({ commandId: command.commandId, entity: command.entity, entityId: command.entityId, expectedRevision: command.expectedRevision ?? null, actualRevision, serverValue: current ?? null }); continue }
      if(change.noop){const result={commandId:command.commandId,entityId:command.entityId,revision:current.revision,updatedAt:current.updatedAt};processed.set(command.commandId,result);accepted.push(result);continue}
      const revision = actualRevision + 1, updatedAt = new Date().toISOString()
      const visibility=change.visibility
      const next={...change.payload,id:command.entityId,ownerId:current?.ownerId??userId,spaceId,visibility,revision,updatedAt,deletedAt:command.operation==='delete'?updatedAt:null}
      entities.set(key, next)
      this.applyMemoryGrowth(spaceId,userId,command,next)
      if(change.withdrawing||command.operation==='delete')for(const media of this.media.values())if(media.spaceId===spaceId&&(media.entityType===command.entity&&media.entityId===command.entityId||media.id===current?.mediaId)&&media.ownerId===userId)media.visibility='private'
      this.bumpPrivacy(spaceId)
      const event = { id: this.eventId(spaceId), entity: command.entity, entityId: command.entityId, revision, operation: change.eventOperation, updatedAt, ownerId: current?.ownerId??userId, visibility:change.eventVisibility }
      events.push(event); space.revision += 1
      const result = { commandId: command.commandId, entityId: command.entityId, revision, updatedAt }
      processed.set(command.commandId, result); accepted.push(result)
    }
    return { accepted, conflicts, cursor: String(space.eventSequence??events.length) }
  }
  async changes(userId, spaceId, cursor = 0) {
    this.requireMember(userId, spaceId)
    const entities = this.entities.get(spaceId), allEvents = this.events.get(spaceId)
    const events = allEvents.filter(event=>Number(event.id)>cursor).filter(event => event.visibility === 'shared' || event.ownerId === userId)
    const ids = { record: new Set(), plan: new Set(), journal: new Set() }
    for (const event of events) ids[event.entity]?.add(event.entityId)
    const collect = type => [...ids[type]].map(id => entities.get(`${type}:${id}`)).filter(entity => entity && (entity.visibility === 'shared' || entity.ownerId === userId))
    return { records: collect('record'), plans: collect('plan'), journals: collect('journal'), events, nextCursor: String(Math.max(cursor,this.spaces.get(spaceId).eventSequence??0)) }
  }
  async syncStatus(userId, spaceId) {
    this.requireMember(userId, spaceId)
    const entities=[...(this.entities.get(spaceId)?.values()??[])].filter(e=>e.visibility==='shared'||e.ownerId===userId),media=[...this.media.values()].filter(item=>item.spaceId===spaceId&&!item.deletedAt&&(item.visibility==='shared'||item.ownerId===userId))
    const counts={record:0,plan:0,journal:0}
    for(const entity of entities)if(!entity.deletedAt&&entity.id){for(const type of Object.keys(counts)){if(this.entities.get(spaceId)?.get(`${type}:${entity.id}`)===entity)counts[type]+=1}}
    return{cursor:String(this.spaces.get(spaceId)?.eventSequence??0),entities:counts,pendingUploads:media.filter(item=>item.status==='pending').length,readyMedia:media.filter(item=>item.status==='ready').length}
  }
  async createMedia(userId, spaceId, input) {
    this.requireMember(userId, spaceId)
    const parent=input.entityType?this.entities.get(spaceId).get(`${input.entityType}:${input.entityId}`):null
    if(parent&&parent.ownerId!==userId)throw new StoreError('FORBIDDEN','只能为自己创建的资料上传关联照片',403)
    if(parent&&(parent.visibility!=='shared'||parent.deletedAt)&&input.visibility==='shared')throw new StoreError('VALIDATION_FAILED','该记录未共享，请把照片设为仅自己，或先明确重新共享记录')
    const id = randomUUID(), now = new Date().toISOString()
    const media = {
      id, spaceId, ownerId: userId, visibility: input.visibility, status: 'pending',
      originalFilename: input.filename, objectKey: `pending/${id}`, thumbnailKey: null,
      entityType: input.entityType ?? null, entityId: input.entityId ?? null,
      contentType: input.contentType, byteSize: input.byteSize, sha256: input.sha256,
      outputContentType: null, storedByteSize: null, width: null, height: null,
      createdAt: now, updatedAt: now,
    }
    this.media.set(id, media)
    this.bumpPrivacy(spaceId)
    return media
  }
  async mediaForUpload(userId, mediaId) {
    const media = this.media.get(mediaId)
    if (!media) throw new StoreError('NOT_FOUND', '没有找到这次上传', 404)
    if (media.ownerId !== userId) throw new StoreError('NOT_FOUND', '没有找到这次上传', 404)
    if (media.status !== 'pending') throw new StoreError('UPLOAD_COMPLETED', '这次上传已经完成', 409)
    return media
  }
  async completeMedia(userId, mediaId, stored) {
    const media = await this.mediaForUpload(userId, mediaId)
    Object.assign(media, stored, { status: 'ready', updatedAt: new Date().toISOString() })
    this.bumpPrivacy(media.spaceId)
    return media
  }
  async mediaForRead(userId, mediaId) {
    const media = this.media.get(mediaId)
    if (!media || media.status !== 'ready' || media.deletedAt) throw new StoreError('NOT_FOUND', '图片不存在或尚未处理完成', 404)
    const isMember = (this.members.get(media.spaceId) ?? []).some(item => item.userId === userId)
    if (!isMember || (media.visibility !== 'shared' && media.ownerId !== userId)) throw new StoreError('NOT_FOUND', '图片不存在或无权访问', 404)
    return media
  }
  async deleteMedia(userId, mediaId) {
    const media = this.media.get(mediaId)
    if (!media || media.ownerId !== userId) throw new StoreError('NOT_FOUND', '图片不存在或无权删除', 404)
    media.deletedAt ??= new Date().toISOString(); media.updatedAt = new Date().toISOString()
    this.bumpPrivacy(media.spaceId)
    return media
  }
  async cleanupMedia(userId,spaceId,limit=100){
    this.requireMember(userId,spaceId,true)
    const stale=[...this.media.values()].filter(item=>item.spaceId===spaceId&&item.deletedAt).slice(0,limit)
    for(const media of stale)this.media.delete(media.id)
    return stale
  }
  async exportSnapshot(userId,spaceId){
    this.requireMember(userId,spaceId)
    const visible=entity=>!entity.deletedAt&&(entity.visibility==='shared'||entity.ownerId===userId),entities=[...(this.entities.get(spaceId)?.values()??[])].filter(visible)
    const collect=type=>entities.filter(entity=>this.entities.get(spaceId)?.get(`${type}:${entity.id}`)===entity)
    const media=[...this.media.values()].filter(item=>item.spaceId===spaceId&&item.status==='ready'&&!item.deletedAt&&(item.visibility!=='private'||item.ownerId===userId))
    return{space:this.spaces.get(spaceId),members:this.members.get(spaceId)??[],records:collect('record'),plans:collect('plan'),journals:collect('journal'),media}
  }
  async createExportJob(userId,spaceId){
    this.requireMember(userId,spaceId);const now=new Date(),job={id:randomUUID(),spaceId,requestedBy:userId,privacyRevision:this.spaces.get(spaceId).privacyRevision??0,status:'pending',objectKey:null,sha256:null,byteSize:null,createdAt:now.toISOString(),completedAt:null,expiresAt:new Date(now.getTime()+24*60*60_000).toISOString()};this.exportJobs.set(job.id,job);return job
  }
  async completeExportJob(userId,jobId,stored){const job=this.exportJobs.get(jobId);if(!job||job.requestedBy!==userId)throw new StoreError('NOT_FOUND','导出任务不存在',404);this.requireMember(userId,job.spaceId);if(job.privacyRevision!==(this.spaces.get(job.spaceId).privacyRevision??0))throw new StoreError('EXPORT_REVOKED','资料已变化，请重新生成数据包',410);Object.assign(job,stored,{status:'ready',completedAt:new Date().toISOString()});return job}
  async exportJobForRead(userId,jobId){const job=this.exportJobs.get(jobId);if(!job||job.requestedBy!==userId||job.status!=='ready'||job.expiresAt<=new Date().toISOString())throw new StoreError('NOT_FOUND','导出文件不存在或已经过期',404);this.requireMember(userId,job.spaceId);if(job.privacyRevision!==(this.spaces.get(job.spaceId).privacyRevision??0))throw new StoreError('EXPORT_REVOKED','资料或共享范围已变化，旧数据包已失效',410);return job}
  async deletionStatus(userId,spaceId){this.requireMember(userId,spaceId);const request=this.deletionRequests.get(spaceId);return request&&!request.cancelledAt?request:null}
  async scheduleDeletion(userId,spaceId){this.requireMember(userId,spaceId,true);const existing=this.deletionRequests.get(spaceId);if(existing&&!existing.cancelledAt)return existing;const now=new Date(),request={id:randomUUID(),spaceId,requestedBy:userId,createdAt:now.toISOString(),scheduledAt:new Date(now.getTime()+7*24*60*60_000).toISOString(),cancelledAt:null};this.deletionRequests.set(spaceId,request);return request}
  async cancelDeletion(userId,spaceId){this.requireMember(userId,spaceId,true);const request=this.deletionRequests.get(spaceId);if(!request||request.cancelledAt)throw new StoreError('NOT_FOUND','没有待撤销的删除预约',404);request.cancelledAt=new Date().toISOString();return request}
  async deleteSpaceNow(userId,spaceId){
    this.requireMember(userId,spaceId,true);const media=[...this.media.values()].filter(item=>item.spaceId===spaceId),exports=[...this.exportJobs.values()].filter(item=>item.spaceId===spaceId)
    this.spaces.delete(spaceId);this.members.delete(spaceId);this.entities.delete(spaceId);this.events.delete(spaceId);this.commands.delete(spaceId);this.deletionRequests.delete(spaceId)
    this.companions.delete(spaceId);for(const key of this.companionCommands.keys())if(key.startsWith(`${spaceId}:`))this.companionCommands.delete(key)
    this.growthSources.delete(spaceId)
    for(const key of this.careSignals.keys())if(key.startsWith(`${spaceId}:`))this.careSignals.delete(key)
    for(const [id,item] of this.capsules)if(item.spaceId===spaceId)this.capsules.delete(id)
    for(const [code,invite] of this.invites)if(invite.spaceId===spaceId)this.invites.delete(code)
    for(const item of media)this.media.delete(item.id);for(const item of exports)this.exportJobs.delete(item.id)
    return{media,exports}
  }
  async maintenanceStatus(){return null}
  async systemAlerts(){return[]}
  async enqueueNotification(input){const job={id:randomUUID(),...input,status:'pending',attempts:0,createdAt:new Date().toISOString(),sentAt:null,lastError:null};this.notifications.push(job);return job}
  async notificationStatus(_userId,email){return this.notifications.filter(job=>job.recipient===email).slice(-10).reverse().map(job=>({id:job.id,recipient:job.recipient,kind:job.kind,status:job.status,attempts:job.attempts,createdAt:job.createdAt,sentAt:job.sentAt,lastAttemptAt:job.lastAttemptAt??null,lastError:job.lastError,provider:job.provider??null,providerMessageId:job.providerMessageId??null,accepted:job.accepted??null,rejected:job.rejected??null}))}
}
