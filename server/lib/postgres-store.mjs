import pg from 'pg'
import { createHash, randomUUID } from 'node:crypto'
import { StoreError } from './memory-store.mjs'
import { initialCompanion,applyCompanionAction,memoryContribution } from '../../shared/companion.mjs'
import {transition} from './sharing-rules.mjs'

const { Pool } = pg
const inviteHash = code => createHash('sha256').update(code).digest('hex')
const iso = value => value instanceof Date ? value.toISOString() : String(value)
const memberRow = row => ({ spaceId: row.space_id, userId: row.user_id, role: row.role, displayName: row.display_name, joinedAt: iso(row.joined_at) })
const spaceRow = row => ({ id: row.id, name: row.name, createdAt: iso(row.created_at), revision: Number(row.revision) })
const inviteRow = (row, code = '') => ({ id: row.id, code, spaceId: row.space_id, status: row.status, expiresAt: iso(row.expires_at), createdBy: row.created_by })
const entityRow = row => ({ ...row.payload, id: row.entity_id, spaceId: row.space_id, ownerId: row.owner_id, visibility: row.visibility, revision: row.revision, updatedAt: iso(row.updated_at), deletedAt: row.deleted_at ? iso(row.deleted_at) : null })
const mediaRow = row => ({
  id: row.id, spaceId: row.space_id, ownerId: row.owner_id, visibility: row.visibility,
  originalFilename: row.original_filename, objectKey: row.object_key, thumbnailKey: row.thumbnail_key,
  entityType: row.entity_type, entityId: row.entity_id,
  contentType: row.content_type, byteSize: Number(row.byte_size), sha256: row.sha256, status: row.status,
  outputContentType: row.output_content_type, storedByteSize: row.stored_byte_size === null ? null : Number(row.stored_byte_size),
  width: row.width, height: row.height, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
})
const exportJobRow=row=>({id:row.id,spaceId:row.space_id,requestedBy:row.requested_by,status:row.status,objectKey:row.object_key,sha256:row.sha256,byteSize:row.byte_size===null?null:Number(row.byte_size),createdAt:iso(row.created_at),completedAt:row.completed_at?iso(row.completed_at):null,expiresAt:iso(row.expires_at)})
const deletionRow=row=>({id:row.id,spaceId:row.space_id,requestedBy:row.requested_by,scheduledAt:iso(row.scheduled_at),createdAt:iso(row.created_at),cancelledAt:row.cancelled_at?iso(row.cancelled_at):null})

export class PostgresStore {
  constructor(connectionString) {
    this.pool = new Pool({ connectionString, max: Number(process.env.PG_POOL_MAX ?? 10), idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 })
    this.pool.on('error', error => console.error('PostgreSQL idle client error', error))
  }
  async close() { await this.pool.end() }
  async health(){await this.pool.query('SELECT 1');return true}
  async createCapsule(userId,spaceId,input,encrypted){return this.withUser(userId,async client=>{await this.requireMember(client,userId,spaceId);const row=(await client.query(`INSERT INTO quexin.sealed_capsules(space_id,owner_id,title,ciphertext,iv,auth_tag,unlock_at,visibility) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[spaceId,userId,input.title,encrypted.ciphertext,encrypted.iv,encrypted.authTag,input.unlockAt,input.visibility])).rows[0];return{id:row.id,spaceId:row.space_id,ownerId:row.owner_id,title:row.title,ciphertext:row.ciphertext,iv:row.iv,authTag:row.auth_tag,visibility:row.visibility,unlockAt:iso(row.unlock_at),createdAt:iso(row.created_at),openedAt:null,deletedAt:null}})}
  async capsulesFor(userId,spaceId){return this.withUser(userId,async client=>{await this.requireMember(client,userId,spaceId);return(await client.query(`SELECT id,space_id,owner_id,title,visibility,unlock_at,created_at,unlock_at<=now() AS can_open FROM quexin.sealed_capsules WHERE space_id=$1 AND deleted_at IS NULL ORDER BY unlock_at`,[spaceId])).rows.map(row=>({id:row.id,spaceId:row.space_id,ownerId:row.owner_id,title:row.title,visibility:row.visibility,unlockAt:iso(row.unlock_at),createdAt:iso(row.created_at),canOpen:row.can_open}))})}
  async capsuleForOpen(userId,spaceId,id){return this.withUser(userId,async client=>{await this.requireMember(client,userId,spaceId);const row=(await client.query(`SELECT * FROM quexin.sealed_capsules WHERE id=$1 AND space_id=$2 AND deleted_at IS NULL AND unlock_at<=now()`,[id,spaceId])).rows[0];if(!row){const exists=await client.query('SELECT 1 FROM quexin.sealed_capsules WHERE id=$1 AND space_id=$2 AND deleted_at IS NULL',[id,spaceId]);throw new StoreError(exists.rowCount?'CAPSULE_LOCKED':'NOT_FOUND',exists.rowCount?'还没有到约定开启时间':'胶囊不存在或无权查看',exists.rowCount?423:404)}return{id:row.id,spaceId:row.space_id,ownerId:row.owner_id,title:row.title,ciphertext:row.ciphertext,iv:row.iv,authTag:row.auth_tag,visibility:row.visibility,unlockAt:iso(row.unlock_at),createdAt:iso(row.created_at),openedAt:row.opened_at?iso(row.opened_at):null}})}
  async deleteCapsule(userId,spaceId,id){return this.withUser(userId,async client=>{await this.requireMember(client,userId,spaceId);const row=(await client.query('UPDATE quexin.sealed_capsules SET deleted_at=now() WHERE id=$1 AND space_id=$2 AND owner_id=$3 AND deleted_at IS NULL RETURNING id',[id,spaceId,userId])).rows[0];if(!row)throw new StoreError('NOT_FOUND','胶囊不存在或无权删除',404);return{id:row.id}})}
  async publishCare(userId,spaceId,input){return this.withUser(userId,async client=>{
    const actor=memberRow(await this.requireMember(client,userId,spaceId)),needs=['想安静','想聊聊','想被听见','一起想办法'],hours=Math.max(1,Math.min(72,Number(input.hours)||8)),message=String(input.message??'').trim();if(!needs.includes(input.need)||message.length>280)throw new StoreError('VALIDATION_FAILED','请检查需要类型和分享文字',400)
    const row=(await client.query(`INSERT INTO quexin.care_signals(space_id,user_id,need,message,expires_at) VALUES($1,$2,$3,$4,now()+($5||' hours')::interval) ON CONFLICT(space_id,user_id) DO UPDATE SET need=EXCLUDED.need,message=EXCLUDED.message,expires_at=EXCLUDED.expires_at,version=quexin.care_signals.version+1,updated_at=now(),revoked_at=NULL RETURNING *`,[spaceId,userId,input.need,message,String(hours)])).rows[0];return{spaceId:row.space_id,userId:row.user_id,displayName:actor.displayName,need:row.need,message:row.message,expiresAt:iso(row.expires_at),version:row.version,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at),revokedAt:null}
  })}
  async careSignalsFor(userId,spaceId){return this.withUser(userId,async client=>{await this.requireMember(client,userId,spaceId);return(await client.query(`SELECT c.*,m.display_name FROM quexin.care_signals c JOIN quexin.space_members m USING(space_id,user_id) WHERE c.space_id=$1 AND c.revoked_at IS NULL AND c.expires_at>now() ORDER BY c.updated_at DESC`,[spaceId])).rows.map(row=>({spaceId:row.space_id,userId:row.user_id,displayName:row.display_name,need:row.need,message:row.message,expiresAt:iso(row.expires_at),version:row.version,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at),revokedAt:null}))})}
  async revokeCare(userId,spaceId){return this.withUser(userId,async client=>{await this.requireMember(client,userId,spaceId);const row=(await client.query('UPDATE quexin.care_signals SET revoked_at=now(),updated_at=now(),version=version+1 WHERE space_id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING *',[spaceId,userId])).rows[0];if(!row)throw new StoreError('NOT_FOUND','没有可撤回的关怀分享',404);return{spaceId:row.space_id,userId:row.user_id,need:row.need,message:row.message,expiresAt:iso(row.expires_at),version:row.version,updatedAt:iso(row.updated_at),revokedAt:iso(row.revoked_at)}})}
  async sharing(userId,spaceId){return this.withUser(userId,async client=>{
    await this.requireMember(client,userId,spaceId)
    const entities=(await client.query('SELECT * FROM quexin.sync_entities WHERE space_id=$1 AND owner_id=$2 AND deleted_at IS NULL',[spaceId,userId])).rows.map(r=>({entity:r.entity_type,id:r.entity_id,title:r.payload.title??'未命名资料',visibility:r.visibility,revision:r.revision}))
    const media=(await client.query("SELECT * FROM quexin.media_objects WHERE space_id=$1 AND owner_id=$2 AND deleted_at IS NULL AND status='ready'",[spaceId,userId])).rows.map(r=>({id:r.id,title:r.original_filename,visibility:r.visibility}))
    return{entities,media}
  })}
  async withdrawMedia(userId,mediaId){return this.withUser(userId,async client=>{
    const media=(await client.query('SELECT * FROM quexin.media_objects WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL',[mediaId,userId])).rows[0]
    if(!media)throw new StoreError('NOT_FOUND','照片不存在或无权撤回',404)
    await client.query('SELECT id FROM quexin.couple_spaces WHERE id=$1 FOR UPDATE',[media.space_id]);await this.requireMember(client,userId,media.space_id)
    const records=(await client.query("UPDATE quexin.sync_entities SET visibility='private',payload=jsonb_set(payload,'{mediaScope}','\"private\"'),revision=revision+1,updated_at=now() WHERE space_id=$1 AND owner_id=$2 AND visibility='shared' AND deleted_at IS NULL AND (payload->>'mediaId'=$3 OR (entity_type=$4 AND entity_id=$5)) RETURNING *",[media.space_id,userId,mediaId,media.entity_type,media.entity_id])).rows
    for(const record of records)await client.query("INSERT INTO quexin.sync_events(space_id,entity_type,entity_id,revision,operation,owner_id,visibility) VALUES($1,$2,$3,$4,'delete',$5,'shared')",[media.space_id,record.entity_type,record.entity_id,record.revision,userId])
    return mediaRow((await client.query("UPDATE quexin.media_objects SET visibility='private',updated_at=now() WHERE id=$1 RETURNING *",[mediaId])).rows[0])
  })}
  async endMembership(userId,removeAccount=false){return this.withUser(userId,async client=>{
    const result=(await client.query('SELECT quexin.end_membership($1) AS result',[removeAccount])).rows[0].result
    return{...result,media:result.media.map(mediaRow),exports:result.exports.map(exportJobRow)}
  })}
  async companion(userId,spaceId){return this.withUser(userId,async client=>{
    await this.requireMember(client,userId,spaceId)
    const row=(await client.query('SELECT state FROM quexin.companion_state WHERE space_id=$1',[spaceId])).rows[0],members=(await client.query('SELECT * FROM quexin.space_members WHERE space_id=$1',[spaceId])).rows.map(memberRow),space=(await client.query('SELECT created_at FROM quexin.couple_spaces WHERE id=$1',[spaceId])).rows[0]
    const state=row?.state??initialCompanion(members,iso(space.created_at)),growthSources=(await client.query('SELECT entity_id AS "sourceId",title,contribution,added_at AS "addedAt" FROM quexin.companion_growth_sources WHERE space_id=$1 AND revoked_at IS NULL ORDER BY added_at DESC LIMIT 50',[spaceId])).rows.map(item=>({...item,addedAt:iso(item.addedAt)}))
    return{...state,growthSources}
  })}
  async companionAction(userId,spaceId,action){return this.withUser(userId,async client=>{
    const actor=memberRow(await this.requireMember(client,userId,spaceId))
    const space=(await client.query('SELECT created_at FROM quexin.couple_spaces WHERE id=$1 FOR UPDATE',[spaceId])).rows[0]
    const row=(await client.query('SELECT state FROM quexin.companion_state WHERE space_id=$1',[spaceId])).rows[0]
    const members=(await client.query('SELECT * FROM quexin.space_members WHERE space_id=$1',[spaceId])).rows.map(memberRow)
    const current=row?.state??initialCompanion(members,iso(space.created_at))
    if((await client.query('SELECT 1 FROM quexin.companion_commands WHERE space_id=$1 AND command_id=$2',[spaceId,action.commandId])).rowCount)return current
    let next;try{next=applyCompanionAction(current,action,actor)}catch(error){throw new StoreError('VALIDATION_FAILED',error.message)}
    await client.query('INSERT INTO quexin.companion_state(space_id,state) VALUES($1,$2) ON CONFLICT(space_id) DO UPDATE SET state=EXCLUDED.state',[spaceId,next])
    await client.query('INSERT INTO quexin.companion_commands(space_id,command_id,user_id) VALUES($1,$2,$3)',[spaceId,action.commandId,userId])
    return next
  })}
  async withUser(userId, callback) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`SELECT set_config('app.user_id',$1,true)`, [userId])
      const result = await callback(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally { client.release() }
  }
  async createUser({ email, displayName, passwordHash }) {
    try {
      const result = await this.pool.query(`INSERT INTO quexin.app_users(email,display_name,password_hash) VALUES($1,$2,$3) RETURNING id,email,display_name,password_hash,email_verified_at,created_at`, [email, displayName, passwordHash])
      const row = result.rows[0]
      return { id: row.id, email: row.email, displayName: row.display_name, passwordHash: row.password_hash, emailVerifiedAt: row.email_verified_at ? iso(row.email_verified_at) : null, createdAt: iso(row.created_at) }
    } catch (error) {
      if (error.code === '23505') throw new StoreError('EMAIL_EXISTS', '这个邮箱已经注册', 409)
      throw error
    }
  }
  async userByEmail(email) {
    const result = await this.pool.query(`SELECT id,email,display_name,password_hash,email_verified_at,created_at FROM quexin.app_users WHERE email=$1`, [email])
    const row = result.rows[0]
    return row ? { id: row.id, email: row.email, displayName: row.display_name, passwordHash: row.password_hash, emailVerifiedAt: row.email_verified_at ? iso(row.email_verified_at) : null, createdAt: iso(row.created_at) } : null
  }
  async userById(id) {
    const result = await this.pool.query(`SELECT id,email,display_name,password_hash,email_verified_at,created_at FROM quexin.app_users WHERE id=$1`, [id])
    const row = result.rows[0]
    return row ? { id: row.id, email: row.email, displayName: row.display_name, passwordHash: row.password_hash, emailVerifiedAt: row.email_verified_at ? iso(row.email_verified_at) : null, createdAt: iso(row.created_at) } : null
  }
  async createSession({ userId, tokenHash, expiresAt, userAgent = '', ipHash = '' }) {
    const result = await this.pool.query(`INSERT INTO quexin.auth_sessions(token_hash,user_id,expires_at,user_agent,ip_hash) VALUES($1,$2,$3,$4,$5) RETURNING id,user_id,expires_at,user_agent,ip_hash,created_at,last_seen_at,revoked_at`, [tokenHash, userId, expiresAt, userAgent, ipHash || null])
    const row=result.rows[0]
    return { id:row.id,userId:row.user_id,expiresAt:iso(row.expires_at),userAgent:row.user_agent,ipHash:row.ip_hash,createdAt:iso(row.created_at),lastSeenAt:iso(row.last_seen_at),revokedAt:null }
  }
  async sessionByHash(tokenHash) {
    const result = await this.pool.query(`UPDATE quexin.auth_sessions s SET last_seen_at=now() FROM quexin.app_users u WHERE s.user_id=u.id AND s.token_hash=$1 AND s.expires_at>now() AND s.revoked_at IS NULL RETURNING s.id,s.user_id,s.expires_at,s.user_agent,s.ip_hash,s.created_at,s.last_seen_at,u.email,u.display_name,u.password_hash,u.email_verified_at,u.created_at AS user_created_at`, [tokenHash])
    const row = result.rows[0]
    return row ? { session: { id: row.id, userId: row.user_id, expiresAt: iso(row.expires_at), userAgent: row.user_agent, ipHash: row.ip_hash, createdAt: iso(row.created_at), lastSeenAt: iso(row.last_seen_at) }, user: { id: row.user_id, email: row.email, displayName: row.display_name, passwordHash: row.password_hash, emailVerifiedAt: row.email_verified_at ? iso(row.email_verified_at) : null, createdAt: iso(row.user_created_at) } } : null
  }
  async deleteSession(tokenHash) { await this.pool.query(`DELETE FROM quexin.auth_sessions WHERE token_hash=$1`, [tokenHash]) }
  async listSessions(userId) { return (await this.pool.query(`SELECT id,user_id,expires_at,user_agent,ip_hash,created_at,last_seen_at,revoked_at FROM quexin.auth_sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now() ORDER BY last_seen_at DESC`, [userId])).rows.map(row => ({ id: row.id, userId: row.user_id, expiresAt: iso(row.expires_at), userAgent: row.user_agent, ipHash: row.ip_hash, createdAt: iso(row.created_at), lastSeenAt: iso(row.last_seen_at), revokedAt: null })) }
  async revokeSession(userId, sessionId) { const result=await this.pool.query(`UPDATE quexin.auth_sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id`,[sessionId,userId]);if(!result.rowCount)throw new StoreError('NOT_FOUND','没有找到这个登录设备',404) }
  async revokeAllSessions(userId) { await this.pool.query(`UPDATE quexin.auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, [userId]) }
  async createAccountToken({ userId, purpose, tokenHash, expiresAt }) {
    const client=await this.pool.connect()
    try{await client.query('BEGIN');await client.query(`UPDATE quexin.account_tokens SET used_at=now() WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL`,[userId,purpose]);await client.query(`INSERT INTO quexin.account_tokens(user_id,purpose,token_hash,expires_at) VALUES($1,$2,$3,$4)`,[userId,purpose,tokenHash,expiresAt]);await client.query('COMMIT')}
    catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  }
  async consumeAccountToken(tokenHash, purpose) { const result=await this.pool.query(`UPDATE quexin.account_tokens t SET used_at=now() FROM quexin.app_users u WHERE t.user_id=u.id AND t.token_hash=$1 AND t.purpose=$2 AND t.used_at IS NULL AND t.expires_at>now() RETURNING u.id,u.email,u.display_name,u.password_hash,u.email_verified_at,u.created_at`,[tokenHash,purpose]);const row=result.rows[0];return row?{id:row.id,email:row.email,displayName:row.display_name,passwordHash:row.password_hash,emailVerifiedAt:row.email_verified_at?iso(row.email_verified_at):null,createdAt:iso(row.created_at)}:null }
  async verifyUser(userId) { const result=await this.pool.query(`UPDATE quexin.app_users SET email_verified_at=coalesce(email_verified_at,now()) WHERE id=$1 RETURNING id,email,display_name,password_hash,email_verified_at,created_at`,[userId]);const row=result.rows[0];return row?{id:row.id,email:row.email,displayName:row.display_name,passwordHash:row.password_hash,emailVerifiedAt:iso(row.email_verified_at),createdAt:iso(row.created_at)}:null }
  async updatePassword(userId,passwordHash){const result=await this.pool.query(`UPDATE quexin.app_users SET password_hash=$2 WHERE id=$1 RETURNING id`,[userId,passwordHash]);if(!result.rowCount)throw new StoreError('NOT_FOUND','账号不存在',404)}
  async verifyEmailToken(tokenHash) { return this.applyAccountToken(tokenHash,'verify_email') }
  async resetPasswordWithToken(tokenHash,passwordHash) { return this.applyAccountToken(tokenHash,'reset_password',passwordHash) }
  async applyAccountToken(tokenHash,purpose,passwordHash) {
    const client=await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result=await client.query(`UPDATE quexin.account_tokens SET used_at=now() WHERE token_hash=$1 AND purpose=$2 AND used_at IS NULL AND expires_at>now() RETURNING user_id`,[tokenHash,purpose])
      const token=result.rows[0]
      if(!token){await client.query('COMMIT');return null}
      if(purpose==='verify_email')await client.query(`UPDATE quexin.app_users SET email_verified_at=coalesce(email_verified_at,now()) WHERE id=$1`,[token.user_id])
      else {
        await client.query(`UPDATE quexin.app_users SET password_hash=$2 WHERE id=$1`,[token.user_id,passwordHash])
        await client.query(`UPDATE quexin.auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`,[token.user_id])
      }
      await client.query('COMMIT')
      return {id:token.user_id}
    } catch(error) { await client.query('ROLLBACK');throw error }
    finally { client.release() }
  }
  async createSpace(userId, { name, displayName }) {
    return this.withUser(userId, async client => {
      const existing = await client.query(`SELECT 1 FROM quexin.space_members WHERE user_id=$1`, [userId])
      if (existing.rowCount) throw new StoreError('VALIDATION_FAILED', '当前账号已经加入一个空间', 409)
      const spaceResult = await client.query(`INSERT INTO quexin.couple_spaces(name,created_by) VALUES($1,$2) RETURNING *`, [name, userId])
      const space = spaceResult.rows[0]
      const memberResult = await client.query(`INSERT INTO quexin.space_members(space_id,user_id,role,display_name) VALUES($1,$2,'owner',$3) RETURNING *`, [space.id, userId, displayName])
      return { space: spaceRow(space), member: memberRow(memberResult.rows[0]) }
    })
  }
  async currentSpace(userId) {
    return this.withUser(userId, async client => {
      const result = await client.query(`SELECT s.* FROM quexin.couple_spaces s JOIN quexin.space_members m ON m.space_id=s.id WHERE m.user_id=$1 AND s.deleted_at IS NULL LIMIT 1`, [userId])
      if (!result.rows[0]) return null
      const members = await client.query(`SELECT * FROM quexin.space_members WHERE space_id=$1 ORDER BY joined_at`, [result.rows[0].id])
      return { space: spaceRow(result.rows[0]), members: members.rows.map(memberRow) }
    })
  }
  async requireMember(client, userId, spaceId, owner = false) {
    const result = await client.query(`SELECT * FROM quexin.space_members WHERE space_id=$1 AND user_id=$2`, [spaceId, userId])
    const member = result.rows[0]
    if (!member || (owner && member.role !== 'owner')) throw new StoreError('FORBIDDEN', owner ? '只有空间创建者可以执行此操作' : '你不是这个空间的成员', 403)
    return member
  }
  async listMembers(userId, spaceId) { return this.withUser(userId, async client => { await this.requireMember(client,userId,spaceId); return (await client.query(`SELECT * FROM quexin.space_members WHERE space_id=$1 ORDER BY joined_at`,[spaceId])).rows.map(memberRow) }) }
  async createInvite(userId, spaceId, ttlHours) {
    return this.withUser(userId, async client => {
      await this.requireMember(client,userId,spaceId,true)
      await client.query(`UPDATE quexin.space_invites SET status='revoked' WHERE space_id=$1 AND status='pending'`,[spaceId])
      let code, hash
      do { code=Math.random().toString(36).slice(2,8).toUpperCase(); hash=inviteHash(code) } while ((await client.query(`SELECT 1 FROM quexin.space_invites WHERE code_hash=$1`,[hash])).rowCount)
      const result=await client.query(`INSERT INTO quexin.space_invites(code_hash,code_preview,space_id,status,created_by,expires_at) VALUES($1,$2,$3,'pending',$4,now()+($5||' hours')::interval) RETURNING *`,[hash,code.slice(-2),spaceId,userId,String(ttlHours)])
      return inviteRow(result.rows[0],code)
    })
  }
  async revokeInvite(userId,spaceId,inviteId){return this.withUser(userId,async client=>{await this.requireMember(client,userId,spaceId,true);const result=await client.query(`UPDATE quexin.space_invites SET status='revoked' WHERE id=$1 AND space_id=$2 RETURNING *`,[inviteId,spaceId]);if(!result.rowCount)throw new StoreError('NOT_FOUND','没有找到这个邀请',404);return inviteRow(result.rows[0])})}
  async acceptInvite(userId,code,displayName){return this.withUser(userId,async client=>{
    if((await client.query(`SELECT 1 FROM quexin.space_members WHERE user_id=$1`,[userId])).rowCount)throw new StoreError('VALIDATION_FAILED','当前账号已经加入一个空间',409)
    const result=await client.query(`SELECT * FROM quexin.space_invites WHERE code_hash=$1 FOR UPDATE`,[inviteHash(code)]),invite=result.rows[0]
    if(!invite||invite.status!=='pending'||invite.expires_at<=new Date())throw new StoreError('INVITE_EXPIRED','邀请码无效或已经过期',410)
    if(Number((await client.query(`SELECT quexin.space_member_count($1) AS count`,[invite.space_id])).rows[0].count)>=2)throw new StoreError('SPACE_FULL','这个空间已经有两位成员',409)
    await client.query(`INSERT INTO quexin.space_members(space_id,user_id,role,display_name) VALUES($1,$2,'partner',$3)`,[invite.space_id,userId,displayName])
    await client.query(`UPDATE quexin.space_invites SET status='accepted',accepted_by=$1 WHERE id=$2`,[userId,invite.id])
    await client.query("UPDATE quexin.companion_state SET state=jsonb_set(jsonb_set(state,'{profile,partnerName}',to_jsonb($2::text)),'{revision}',to_jsonb(coalesce((state->>'revision')::integer,0)+1)) WHERE space_id=$1 AND state->'profile'->>'partnerName'=''",[invite.space_id,displayName])
    const space=(await client.query(`SELECT * FROM quexin.couple_spaces WHERE id=$1`,[invite.space_id])).rows[0],members=(await client.query(`SELECT * FROM quexin.space_members WHERE space_id=$1 ORDER BY joined_at`,[invite.space_id])).rows
    return{space:spaceRow(space),members:members.map(memberRow)}
  })}
  async applyMemoryGrowth(client,actor,spaceId,command,entity){
    if(command.entity!=='record')return
    const existing=(await client.query('SELECT * FROM quexin.companion_growth_sources WHERE space_id=$1 AND entity_id=$2 FOR UPDATE',[spaceId,command.entityId])).rows[0],active=!entity.deletedAt&&entity.visibility==='shared'&&entity.status==='confirmed'
    if(!active){if(existing){await client.query('UPDATE quexin.companion_growth_sources SET revoked_at=now() WHERE space_id=$1 AND entity_id=$2',[spaceId,command.entityId]);const state=(await client.query('SELECT state FROM quexin.companion_state WHERE space_id=$1',[spaceId])).rows[0]?.state;if(state){state.events=(state.events??[]).filter(event=>event.sourceId!==command.entityId);await client.query('UPDATE quexin.companion_state SET state=$2 WHERE space_id=$1',[spaceId,state])}}return}
    const contribution=memoryContribution(entity)
    if(existing){await client.query('UPDATE quexin.companion_growth_sources SET title=$3,contribution=$4,revoked_at=NULL WHERE space_id=$1 AND entity_id=$2',[spaceId,command.entityId,entity.title,contribution]);return}
    const row=(await client.query('SELECT state FROM quexin.companion_state WHERE space_id=$1',[spaceId])).rows[0],members=(await client.query('SELECT * FROM quexin.space_members WHERE space_id=$1',[spaceId])).rows.map(memberRow),space=(await client.query('SELECT created_at FROM quexin.couple_spaces WHERE id=$1',[spaceId])).rows[0],current=row?.state??initialCompanion(members,iso(space.created_at)),now=new Date().toISOString(),next=applyCompanionAction(current,{commandId:`memory:${command.entityId}`,kind:'memory_growth',sourceId:command.entityId,title:entity.title,contribution},actor,now)
    await client.query('INSERT INTO quexin.companion_growth_sources(space_id,entity_id,title,contribution,added_at) VALUES($1,$2,$3,$4,$5)',[spaceId,command.entityId,entity.title,contribution,now]);await client.query('INSERT INTO quexin.companion_state(space_id,state) VALUES($1,$2) ON CONFLICT(space_id) DO UPDATE SET state=EXCLUDED.state',[spaceId,next])
  }
  async sync(userId,spaceId,commands){return this.withUser(userId,async client=>{
    await client.query('SELECT id FROM quexin.couple_spaces WHERE id=$1 FOR UPDATE',[spaceId]);const actor=memberRow(await this.requireMember(client,userId,spaceId)),accepted=[],conflicts=[]
    for(const command of commands.slice(0,100)){
      if(!command?.commandId||!command.entityId)continue
      const done=await client.query(`SELECT result FROM quexin.processed_commands WHERE space_id=$1 AND command_id=$2`,[spaceId,command.commandId]);if(done.rowCount){accepted.push(done.rows[0].result);continue}
      const currentResult=await client.query(`SELECT * FROM quexin.sync_entities WHERE space_id=$1 AND entity_type=$2 AND entity_id=$3 FOR UPDATE`,[spaceId,command.entity,command.entityId]),current=currentResult.rows[0],actual=current?.revision??0
      const change=transition(userId,current?entityRow(current):null,command,(...args)=>new StoreError(...args))
      if(!change.valid){conflicts.push({commandId:command.commandId,entity:command.entity,entityId:command.entityId,expectedRevision:command.expectedRevision??null,actualRevision:actual,serverValue:current?entityRow(current):null});continue}
      if(change.noop){const result={commandId:command.commandId,entityId:command.entityId,revision:actual,updatedAt:iso(current.updated_at)};await client.query('INSERT INTO quexin.processed_commands(space_id,command_id,result) VALUES($1,$2,$3)',[spaceId,command.commandId,result]);accepted.push(result);continue}
      const revision=actual+1,updatedAt=new Date().toISOString(),visibility=change.visibility
      if(command.operation==='delete')await client.query(`UPDATE quexin.sync_entities SET payload='{}',revision=$4,updated_at=$5,deleted_at=$5 WHERE space_id=$1 AND entity_type=$2 AND entity_id=$3`,[spaceId,command.entity,command.entityId,revision,updatedAt])
      else await client.query(`INSERT INTO quexin.sync_entities(space_id,entity_type,entity_id,owner_id,visibility,revision,payload,updated_at,deleted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL) ON CONFLICT(space_id,entity_type,entity_id) DO UPDATE SET visibility=EXCLUDED.visibility,revision=EXCLUDED.revision,payload=EXCLUDED.payload,updated_at=EXCLUDED.updated_at,deleted_at=NULL`,[spaceId,command.entity,command.entityId,current?.owner_id??userId,visibility,revision,change.payload,updatedAt])
      await this.applyMemoryGrowth(client,actor,spaceId,command,{...change.payload,id:command.entityId,visibility,deletedAt:command.operation==='delete'?updatedAt:null})
      if(change.withdrawing||command.operation==='delete')await client.query("UPDATE quexin.media_objects SET visibility='private',updated_at=now() WHERE space_id=$1 AND owner_id=$2 AND ((entity_type=$3 AND entity_id=$4) OR id::text=$5)",[spaceId,userId,command.entity,command.entityId,current?.payload?.mediaId??''])
      await client.query(`INSERT INTO quexin.sync_events(space_id,entity_type,entity_id,revision,operation,owner_id,visibility,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[spaceId,command.entity,command.entityId,revision,change.eventOperation,userId,change.eventVisibility,updatedAt])
      await client.query(`UPDATE quexin.couple_spaces SET revision=revision+1 WHERE id=$1`,[spaceId])
      const result={commandId:command.commandId,entityId:command.entityId,revision,updatedAt};await client.query(`INSERT INTO quexin.processed_commands(space_id,command_id,result) VALUES($1,$2,$3)`,[spaceId,command.commandId,result]);accepted.push(result)
    }
    const cursor=(await client.query(`SELECT coalesce(max(sequence),0)::text AS cursor FROM quexin.sync_events WHERE space_id=$1`,[spaceId])).rows[0].cursor
    return{accepted,conflicts,cursor}
  })}
  async changes(userId,spaceId,cursor=0){return this.withUser(userId,async client=>{
    await this.requireMember(client,userId,spaceId)
    const eventRows=(await client.query(`SELECT * FROM quexin.sync_events WHERE space_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 500`,[spaceId,cursor])).rows
    const groups={record:new Set(),plan:new Set(),journal:new Set()};for(const row of eventRows)groups[row.entity_type]?.add(row.entity_id)
    const collect=async type=>{const ids=[...groups[type]];if(!ids.length)return[];return(await client.query(`SELECT * FROM quexin.sync_entities WHERE space_id=$1 AND entity_type=$2 AND entity_id=ANY($3::text[])`,[spaceId,type,ids])).rows.map(entityRow)}
    return{records:await collect('record'),plans:await collect('plan'),journals:await collect('journal'),events:eventRows.map(row=>({id:String(row.sequence),entity:row.entity_type,entityId:row.entity_id,revision:row.revision,operation:row.operation,updatedAt:iso(row.updated_at)})),nextCursor:eventRows.length?String(eventRows.at(-1).sequence):String(cursor)}
  })}
  async syncStatus(userId,spaceId){return this.withUser(userId,async client=>{
    await this.requireMember(client,userId,spaceId)
    const entityRows=(await client.query(`SELECT entity_type,count(*)::integer AS count FROM quexin.sync_entities WHERE space_id=$1 AND deleted_at IS NULL GROUP BY entity_type`,[spaceId])).rows
    const mediaRows=(await client.query(`SELECT status,count(*)::integer AS count FROM quexin.media_objects WHERE space_id=$1 AND deleted_at IS NULL GROUP BY status`,[spaceId])).rows
    const cursor=(await client.query(`SELECT coalesce(max(sequence),0)::text AS cursor FROM quexin.sync_events WHERE space_id=$1`,[spaceId])).rows[0].cursor
    const entities={record:0,plan:0,journal:0};for(const row of entityRows)if(row.entity_type in entities)entities[row.entity_type]=row.count
    const media=Object.fromEntries(mediaRows.map(row=>[row.status,row.count]))
    return{cursor,entities,pendingUploads:media.pending??0,readyMedia:media.ready??0}
  })}
  async createMedia(userId,spaceId,input){return this.withUser(userId,async client=>{
    await client.query('SELECT id FROM quexin.couple_spaces WHERE id=$1 FOR UPDATE',[spaceId])
    await this.requireMember(client,userId,spaceId)
    const parent=input.entityType?(await client.query('SELECT owner_id,visibility,deleted_at FROM quexin.sync_entities WHERE space_id=$1 AND entity_type=$2 AND entity_id=$3',[spaceId,input.entityType,input.entityId])).rows[0]:null
    if(parent&&parent.owner_id!==userId)throw new StoreError('FORBIDDEN','只能为自己创建的资料上传关联照片',403)
    if(parent&&(parent.visibility!=='shared'||parent.deleted_at)&&input.visibility==='shared')throw new StoreError('VALIDATION_FAILED','该记录未共享，请把照片设为仅自己，或先明确重新共享记录')
    const id=randomUUID(),objectKey=`pending/${id}`
    const result=await client.query(`INSERT INTO quexin.media_objects(id,space_id,owner_id,visibility,original_filename,object_key,content_type,byte_size,sha256,status,entity_type,entity_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11) RETURNING *`,[id,spaceId,userId,input.visibility,input.filename,objectKey,input.contentType,input.byteSize,input.sha256,input.entityType??null,input.entityId??null])
    return mediaRow(result.rows[0])
  })}
  async mediaForUpload(userId,mediaId){return this.withUser(userId,async client=>{
    const result=await client.query(`SELECT * FROM quexin.media_objects WHERE id=$1 AND owner_id=$2`,[mediaId,userId])
    const media=result.rows[0]
    if(!media)throw new StoreError('NOT_FOUND','没有找到这次上传',404)
    if(media.status!=='pending')throw new StoreError('UPLOAD_COMPLETED','这次上传已经完成',409)
    return mediaRow(media)
  })}
  async completeMedia(userId,mediaId,stored){return this.withUser(userId,async client=>{
    await client.query('SELECT s.id FROM quexin.couple_spaces s JOIN quexin.media_objects m ON m.space_id=s.id WHERE m.id=$1 AND m.owner_id=$2 FOR UPDATE OF s',[mediaId,userId])
    const result=await client.query(`UPDATE quexin.media_objects SET object_key=$3,thumbnail_key=$4,output_content_type=$5,stored_byte_size=$6,width=$7,height=$8,status='ready',updated_at=now() WHERE id=$1 AND owner_id=$2 AND status='pending' RETURNING *`,[mediaId,userId,stored.objectKey,stored.thumbnailKey,stored.outputContentType,stored.storedByteSize,stored.width,stored.height])
    if(!result.rowCount)throw new StoreError('NOT_FOUND','没有找到待完成的上传',404)
    return mediaRow(result.rows[0])
  })}
  async mediaForRead(userId,mediaId){return this.withUser(userId,async client=>{
    const result=await client.query(`SELECT * FROM quexin.media_objects WHERE id=$1 AND status='ready' AND deleted_at IS NULL`,[mediaId])
    if(!result.rowCount)throw new StoreError('NOT_FOUND','图片不存在或尚未处理完成',404)
    return mediaRow(result.rows[0])
  })}
  async deleteMedia(userId,mediaId){return this.withUser(userId,async client=>{
    await client.query('SELECT s.id FROM quexin.couple_spaces s JOIN quexin.media_objects m ON m.space_id=s.id WHERE m.id=$1 AND m.owner_id=$2 FOR UPDATE OF s',[mediaId,userId])
    const result=await client.query(`UPDATE quexin.media_objects SET deleted_at=coalesce(deleted_at,now()),updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING *`,[mediaId,userId])
    if(!result.rowCount)throw new StoreError('NOT_FOUND','图片不存在或无权删除',404)
    return mediaRow(result.rows[0])
  })}
  async cleanupMedia(userId,spaceId,limit=100){return this.withUser(userId,async client=>{
    await this.requireMember(client,userId,spaceId,true)
    const result=await client.query(`DELETE FROM quexin.media_objects WHERE id IN (SELECT id FROM quexin.media_objects WHERE space_id=$1 AND deleted_at IS NOT NULL ORDER BY deleted_at LIMIT $2) RETURNING *`,[spaceId,limit])
    return result.rows.map(mediaRow)
  })}
  async exportSnapshot(userId,spaceId){return this.withUser(userId,async client=>{
    await this.requireMember(client,userId,spaceId)
    const space=(await client.query(`SELECT * FROM quexin.couple_spaces WHERE id=$1`,[spaceId])).rows[0],members=(await client.query(`SELECT * FROM quexin.space_members WHERE space_id=$1 ORDER BY joined_at`,[spaceId])).rows
    const entities=(await client.query(`SELECT * FROM quexin.sync_entities WHERE space_id=$1 AND deleted_at IS NULL ORDER BY entity_type,updated_at`,[spaceId])).rows
    const media=(await client.query(`SELECT * FROM quexin.media_objects WHERE space_id=$1 AND status='ready' AND deleted_at IS NULL ORDER BY created_at`,[spaceId])).rows
    const collect=type=>entities.filter(row=>row.entity_type===type).map(entityRow)
    return{space:spaceRow(space),members:members.map(memberRow),records:collect('record'),plans:collect('plan'),journals:collect('journal'),media:media.map(mediaRow)}
  })}
  async createExportJob(userId,spaceId){return this.withUser(userId,async client=>{
    await this.requireMember(client,userId,spaceId);const result=await client.query(`INSERT INTO quexin.data_export_jobs(space_id,requested_by,status,expires_at,privacy_revision) SELECT id,$2,'pending',now()+interval '24 hours',privacy_revision FROM quexin.couple_spaces WHERE id=$1 RETURNING *`,[spaceId,userId]);return exportJobRow(result.rows[0])
  })}
  async completeExportJob(userId,jobId,stored){return this.withUser(userId,async client=>{const result=await client.query(`UPDATE quexin.data_export_jobs SET status='ready',object_key=$3,sha256=$4,byte_size=$5,completed_at=now() WHERE id=$1 AND requested_by=$2 AND privacy_revision=(SELECT privacy_revision FROM quexin.couple_spaces WHERE id=space_id) RETURNING *`,[jobId,userId,stored.objectKey,stored.sha256,stored.byteSize]);if(!result.rowCount)throw new StoreError('NOT_FOUND','导出任务不存在',404);return exportJobRow(result.rows[0])})}
  async exportJobForRead(userId,jobId){return this.withUser(userId,async client=>{const result=await client.query(`SELECT * FROM quexin.data_export_jobs WHERE id=$1 AND requested_by=$2 AND status='ready' AND expires_at>now() AND privacy_revision=(SELECT privacy_revision FROM quexin.couple_spaces WHERE id=space_id)`,[jobId,userId]);if(!result.rowCount)throw new StoreError('NOT_FOUND','导出文件不存在或已经过期',404);return exportJobRow(result.rows[0])})}
  async deletionStatus(userId,spaceId){return this.withUser(userId,async client=>{await this.requireMember(client,userId,spaceId);const result=await client.query(`SELECT * FROM quexin.space_deletion_requests WHERE space_id=$1 AND cancelled_at IS NULL`,[spaceId]);return result.rows[0]?deletionRow(result.rows[0]):null})}
  async scheduleDeletion(userId,spaceId){return this.withUser(userId,async client=>{await this.requireMember(client,userId,spaceId,true);const result=await client.query(`INSERT INTO quexin.space_deletion_requests(space_id,requested_by,scheduled_at) VALUES($1,$2,now()+interval '7 days') ON CONFLICT(space_id) DO UPDATE SET requested_by=EXCLUDED.requested_by,scheduled_at=EXCLUDED.scheduled_at,created_at=now(),cancelled_at=NULL RETURNING *`,[spaceId,userId]);return deletionRow(result.rows[0])})}
  async cancelDeletion(userId,spaceId){return this.withUser(userId,async client=>{await this.requireMember(client,userId,spaceId,true);const result=await client.query(`UPDATE quexin.space_deletion_requests SET cancelled_at=now() WHERE space_id=$1 AND cancelled_at IS NULL RETURNING *`,[spaceId]);if(!result.rowCount)throw new StoreError('NOT_FOUND','没有待撤销的删除预约',404);return deletionRow(result.rows[0])})}
  async deleteSpaceNow(userId,spaceId){return this.withUser(userId,async client=>{
    await this.requireMember(client,userId,spaceId,true)
    const removed=(await client.query('SELECT quexin.delete_owned_space($1) AS result',[spaceId])).rows[0].result
    return{media:removed.media.map(mediaRow),exports:removed.exports.map(exportJobRow)}
  })}
  async maintenanceStatus(userId){return this.withUser(userId,async client=>{const row=(await client.query(`SELECT id,started_at,completed_at,status,expired_exports,deleted_spaces,removed_media,expired_sessions,expired_tokens FROM quexin.maintenance_runs ORDER BY completed_at DESC LIMIT 1`)).rows[0];return row?{id:Number(row.id),startedAt:iso(row.started_at),completedAt:iso(row.completed_at),status:row.status,expiredExports:row.expired_exports,deletedSpaces:row.deleted_spaces,removedMedia:row.removed_media,expiredSessions:row.expired_sessions,expiredTokens:row.expired_tokens}:null})}
  async systemAlerts(userId){return this.withUser(userId,async client=>(await client.query(`SELECT id,severity,source,code,message,created_at FROM quexin.system_alerts WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT 20`)).rows.map(row=>({id:Number(row.id),severity:row.severity,source:row.source,code:row.code,message:row.message,createdAt:iso(row.created_at)})))}
  async enqueueNotification(input){const id=randomUUID(),createdAt=new Date().toISOString();await this.pool.query(`INSERT INTO quexin.notification_jobs(id,recipient,kind,ciphertext,iv,auth_tag,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,input.recipient,input.kind,input.ciphertext,input.iv,input.authTag,createdAt]);return{id,recipient:input.recipient,kind:input.kind,status:'pending',attempts:0,createdAt}}
  async notificationStatus(userId,email){return this.withUser(userId,async client=>(await client.query(`SELECT id,recipient,kind,status,attempts,last_error,created_at,sent_at,last_attempt_at,provider,provider_message_id,accepted,rejected FROM quexin.notification_jobs WHERE recipient=$1 ORDER BY created_at DESC LIMIT 10`,[email])).rows.map(row=>({id:row.id,recipient:row.recipient,kind:row.kind,status:row.status,attempts:row.attempts,lastError:row.last_error,createdAt:iso(row.created_at),sentAt:row.sent_at?iso(row.sent_at):null,lastAttemptAt:row.last_attempt_at?iso(row.last_attempt_at):null,provider:row.provider,providerMessageId:row.provider_message_id,accepted:row.accepted,rejected:row.rejected})))}
}
