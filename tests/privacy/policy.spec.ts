import {test,expect} from '@playwright/test'
import {createEmptyStore} from '../../src/data'
import {stageLocalChanges} from '../../src/sync-queue'
import {emptySyncState} from '../../src/sync-state'
import {pruneQueuedChanges,privateEntityKeys} from '../../shared/sync-policy.mjs'
const fixture=()=>{const store=createEmptyStore();store.records=[{id:'r1',title:'等待发送',body:'旧的正文',source:'本人',date:'2026-10-30',kind:'回忆',status:'confirmed'}];return store}

test('尚未发送的私人记录、删除记录和关联日程从旧队列剔除',()=>{
 for(const change of ['private','delete','pending','image']){
  const store=fixture();store.plans=[{id:'record-r1',title:'一起去公园',date:'2026-11-01',time:'',kind:'计划',status:'todo'}]
  const queued=stageLocalChanges(emptySyncState(),store);expect(queued.queue).toHaveLength(2)
  if(change==='delete')store.records=[];else if(change==='private')store.records[0].sensitive=true;else if(change==='pending')store.records[0].status='pending';else store.records[0].mediaScope='private'
  expect(pruneQueuedChanges(queued.queue,store)).toHaveLength(0);expect(stageLocalChanges(queued,store).queue).toHaveLength(0)
 }
})
test('正文更新用新命令替换旧内容，内容未变保持幂等编号',()=>{
 const store=fixture(),queued=stageLocalChanges(emptySyncState(),store),id=queued.queue[0].command.commandId
 expect(stageLocalChanges(queued,store)).toBe(queued)
 store.records[0].body='新正文';expect(pruneQueuedChanges(queued.queue,store)).toHaveLength(0)
 const next=stageLocalChanges(queued,store);expect(next.queue).toHaveLength(1);expect(next.queue[0].command.commandId).not.toBe(id);expect(next.queue[0].command.payload).toMatchObject({body:'新正文'})
})
test('私人草稿与胶囊退出队列，旧冲突不重新带出私人正文',()=>{
 const store=fixture(),queued=stageLocalChanges(emptySyncState(),store)
 queued.conflicts=[{commandId:'c',entity:'record',entityId:'r1',actualRevision:2,expectedRevision:1,serverValue:{},key:'record:r1',localPayload:store.records[0],detectedAt:new Date().toISOString()}]
 store.records[0].sensitive=true;expect(stageLocalChanges(queued,store).conflicts).toHaveLength(0);expect(privateEntityKeys(store).has('record:r1')).toBe(true)
 store.journals=[{id:'j',type:'信件',title:'普通信',body:'待发送',date:'2026-10-30'}];const q=stageLocalChanges(emptySyncState(),store)
 store.journals[0].type='时光胶囊';expect(pruneQueuedChanges(q.queue,store)).toHaveLength(0)
 store.journals[0].type='日常';store.journals[0].title='私人草稿 · 自己看';expect(pruneQueuedChanges(q.queue,store)).toHaveLength(0)
})
test('已有远端版本的删除命令只含标记，重新公开会取消旧删除',()=>{
 const store=fixture(),base=emptySyncState();base.revisions['record:r1']=1;store.records[0].sensitive=true
 const queued=stageLocalChanges(base,store);expect(queued.queue[0].command).toMatchObject({operation:'withdraw',payload:{visibility:'shared'}})
 expect(JSON.stringify(queued.queue)).not.toContain('旧的正文');store.records[0].sensitive=false
 expect(pruneQueuedChanges(queued.queue,store)).toHaveLength(0)
})

test('服务端原本私有的记录不误当作共享撤回删除，私有信件不共享',()=>{
 const store=fixture(),base=emptySyncState();store.records[0].sensitive=true;base.revisions['record:r1']=2;base.hashes['record:r1']='__private__'
 store.journals=[{id:'private-letter',title:'私人信',body:'自己看',type:'信件',date:'2026-10-30',sensitive:true}]
 expect(stageLocalChanges(base,store).queue).toHaveLength(0)
})
