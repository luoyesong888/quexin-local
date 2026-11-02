export function transition(userId,current,command,fail){
 const deny=(code,message,status=403)=>{throw fail(code,message,status)}
 if(!['record','plan','journal'].includes(command.entity)||!['create','update','delete','withdraw','publish'].includes(command.operation))deny('VALIDATION_FAILED','同步操作类型无效',400)
 if(current&&current.visibility!=='shared'&&current.ownerId!==userId)deny('NOT_FOUND','资料不存在或无权访问',404)
 const requested=command.payload?.visibility??'shared'
 if(!['shared','private','pending_partner','sealed_secret'].includes(requested))deny('VALIDATION_FAILED','共享范围无效',400)
 const withdrawing=command.operation==='withdraw'||Boolean(current&&current.visibility==='shared'&&requested!=='shared'&&command.operation!=='delete')
 if((withdrawing||command.operation==='publish')&&current?.ownerId!==userId)deny('FORBIDDEN','只有资料作者可以撤回或重新共享')
 if(current?.deletedAt&&current.revision===command.expectedRevision&&!['delete','publish'].includes(command.operation))deny('ENTITY_DELETED','资料已删除，请重新创建或由作者明确恢复',409)
 if(current&&!current.deletedAt&&current.visibility!=='shared'&&requested==='shared'&&!['publish','delete','withdraw'].includes(command.operation))deny('EXPLICIT_PUBLISH_REQUIRED','资料已撤回，不能用旧同步操作重新共享',409)
 const valid=command.operation==='create'?!current&&command.expectedRevision===null:current&&(withdrawing?!current.deletedAt:current.revision===command.expectedRevision)
 const {spaceId:_space,ownerId:_owner,visibility:_scope,revision:_revision,updatedAt:_at,deletedAt:_deleted,...oldPayload}=current??{}
 return {valid,withdrawing,noop:command.operation==='withdraw'&&current?.visibility!=='shared'&&!current?.deletedAt,visibility:command.operation==='delete'?current?.visibility??'shared':withdrawing?'private':requested,payload:command.operation==='delete'?{}:command.operation==='withdraw'?oldPayload:command.payload,eventOperation:withdrawing?'delete':command.operation==='publish'?'update':command.operation,eventVisibility:withdrawing?'shared':command.operation==='delete'?current?.visibility??'shared':requested}
}
