import { useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { themeOptions } from './domain'
import type { DemoStore, Journal, RecordItem, RecordKind } from './domain'
import { repositoryFor, RepositoryConflictError } from './repository'
import type { RepositoryConflict, RepositoryInfo, StorePatch } from './repository'

export const STORAGE_KEY = 'quexin-interactive-demo-v1'
export const DATABASE_NAME = 'quexin-web'

export type PersistenceState = {
  status: 'loading' | 'ready' | 'saving' | 'error'
  backend: 'indexeddb' | 'legacy' | 'memory'
  revision: number
  savedAt: string
  migrated: boolean
  externalSyncAt?: string
  conflict?: RepositoryConflict[]
}

export type RepositoryActions = { reloadLatest: () => Promise<void>; overwriteCurrent: () => Promise<void> }

export function today(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function shiftDate(date: string, days: number): string {
  const parsed = new Date(`${date}T12:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

export function dayDiff(date: string): number {
  if (!isDate(date)) return 0
  return Math.round((Date.parse(`${today()}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`)) / 86_400_000)
}

function nextAnniversary(): string {
  const now = today()
  const month = new Date(`${now.slice(0, 7)}-21T12:00:00Z`)
  if (month.toISOString().slice(0, 10) < now) month.setUTCMonth(month.getUTCMonth() + 1)
  return month.toISOString().slice(0, 10)
}

const currentDay = today()

export const initialStore: DemoStore = {
  version: 1,
  settings: {
    theme: 'paper', selfName: '阿澄', partnerName: '小满', since: '2026-06-21',
    aiMode: 'demo', aiModelConsent:false, wechatDemo: false, syncDemo: false,
    moduleCare: true, modulePet: true, reduceMotion: false, onboardingCompleted: true, sampleMode: true, assistantChatVersion: 2,
  },
  care: {
    need: '想安静', shared: false,
    draft: '今天有一点累。我想先安静一会儿，等准备好了再和你聊聊。',
    followups: [], cycleStart: '',
  },
  agentRuns: [],
  assistantMessages: [],
  pet: {
    name: '小鹊', energy: 78, curiosity: 72, comfort: 76, feathers: 36,
    room: 'study', pose: 'idle',
    log: ['小鹊搬进了我们的书房，正在好奇地打量这里。'],
  },
  records: [
    {
      id: 'pending-interview-note', title: '面试前，那句让我安心的话',
      body: '明天下午有面试，还是有点紧张。但想到你说“你已经很棒了”，就安心多了。等面试完，我们去吃那家想了很久的川菜吧。',
      date: currentDay, kind: '回忆', status: 'pending', sensitive: true,
      source: `示例聊天 · ${currentDay} 21:17 · 小满：明天下午有面试，还是有点紧张。但想到你说“你已经很棒了”，就安心多了。等面试完，我们去吃那家想了很久的川菜吧。`,
    },
    {
      id: 'pending-coast-wish', title: '下周，一起去看看海',
      body: '下周想一起去海边，具体哪天我们再商量。不赶行程，就沿着海岸慢慢走。',
      date: '', kind: '心愿', status: 'pending', sensitive: true,
      source: `示例聊天 · ${currentDay} 19:42 · 阿澄：下周想一起去海边，具体哪天我们再商量。`,
    },
    {
      id: 'pending-interview-plan', title: '小满的重要面试',
      body: '明天下午两点有一个重要面试。提前鼓励一句就好，结束后想先休息一下。',
      date: shiftDate(currentDay, 1), kind: '计划', status: 'pending',
      source: `示例聊天 · ${currentDay} 09:00 · 小满：明天下午两点有一个重要面试。提前鼓励一句就好，结束后想先休息一下。`,
    },
    {
      id: 'pending-coffee-preference', title: '最近更喜欢低咖啡因',
      body: '最近晚上想早点睡，下午的咖啡换成低咖啡因吧。只是近期的偏好，以后可能会改变。',
      date: currentDay, kind: '偏好', status: 'pending',
      source: `示例聊天 · ${currentDay} 14:06 · 小满：最近晚上想早点睡，下午的咖啡换成低咖啡因吧。`,
    },
    {
      id: 'pending-bookstore', title: '雨天躲进一家旧书店',
      body: '昨天躲雨时走进那家旧书店，我们各自挑了一本书，又交换着看了一路。',
      date: shiftDate(currentDay, -1), kind: '回忆', status: 'pending',
      source: `示例聊天 · ${currentDay} 08:45 · 阿澄：昨天躲雨时走进那家旧书店，我们各自挑了一本书，又交换着看了一路。`,
    },
    {
      id: 'memory-coast', title: '把日落装进口袋',
      body: '沿着海边慢慢走，没有目的地。你说今天的落日像一颗溏心蛋，我笑了一路。',
      date: shiftDate(currentDay, -3), kind: '回忆', status: 'confirmed',
      image: '/assets/coast.jpg', source: '示例手记 · 阿澄：沿着海边慢慢走，直到天色一点点暗下来。',
    },
    {
      id: 'memory-cafe', title: '雨天，也有好天气',
      body: '在街角的咖啡馆躲了一下午的雨。一本书，两杯咖啡，窗外是慢下来的世界。',
      date: shiftDate(currentDay, -9), kind: '回忆', status: 'confirmed',
      image: '/assets/cafe.jpg', source: '示例手记 · 小满：两杯拿铁，一本看到一半的书。今天就这样很好。',
    },
    {
      id: 'memory-mountain', title: '一起走过的山路',
      body: '爬到山顶时已经气喘吁吁，但看到远处的云，觉得每一步都值得。下次还一起出发。',
      date: shiftDate(currentDay, -22), kind: '回忆', status: 'confirmed',
      image: '/assets/mountain.jpg', source: '示例手记 · 阿澄：山顶的风很大。一起带回来的，还有相机里满满的云。',
    },
    {
      id: 'memory-dinner', title: '第一次成功的晚餐',
      body: '番茄意面终于没有煮过头。虽然厨房还是一团乱，但我们认真碰了杯。普通的一天，也值得记住。',
      date: shiftDate(currentDay, -37), kind: '回忆', status: 'confirmed',
      source: '示例手记 · 小满：今天的意面九十分，剩下十分留给下次。',
    },
  ],
  plans: [
    { id: 'plan-interview', title: '面试前，给小满一句鼓励', date: shiftDate(currentDay, 1), time: '13:30', kind: '提醒', status: 'todo' },
    { id: 'plan-film', title: '一起看一场老电影', date: shiftDate(currentDay, 3), time: '19:30', kind: '心愿', status: 'todo' },
    { id: 'plan-anniversary', title: '我们的月纪念日', date: nextAnniversary(), time: '', kind: '纪念日', status: 'todo' },
    { id: 'plan-photos', title: '整理这个月的照片', date: shiftDate(currentDay, 2), time: '20:00', kind: '待办', status: 'todo' },
    { id: 'plan-coast-cancelled', title: '这次海边旅行', date: shiftDate(currentDay, 6), time: '', kind: '计划', status: 'cancelled' },
  ],
  journals: [
    {
      id: 'journal-letter', title: '写给今天的你', type: '信件', date: shiftDate(currentDay, -2),
      body: '小满：\n\n谢谢你把那些普通的日子，变成了我愿意一遍遍想起的故事。\n\n不用每天都很精彩。一起吃晚饭、散步，或者安静地待一会儿，就已经很好。\n\n阿澄',
    },
    {
      id: 'journal-capsule', title: '留给一年后的我们', type: '时光胶囊', date: currentDay,
      unlockDate: shiftDate(currentDay, 365),
      body: '嗨，一年后的我们。\n\n希望你们还记得今天想一起做的事：去看海、学会一道拿手菜、认真听对方说话。\n\n如果还没有全部做到，也没关系。我们还有很多个明天。',
    },
  ],
  logs: [{ id: 'log-welcome', time: '刚刚', text: '已载入本地交互示例。AI、微信与双人同步均未连接真实服务。' }],
}

export function createEmptyStore(): DemoStore {
  return {
    version: 1,
    settings: {
      theme: 'paper', selfName: '我', partnerName: 'TA', since: today(), aiMode: 'demo',
      wechatDemo: false, syncDemo: false, moduleCare: true, modulePet: true, reduceMotion: false,
      onboardingCompleted: false, sampleMode: false, assistantChatVersion: 2,
    },
    care: { need: '想安静', shared: false, draft: '', followups: [], cycleStart: '' },
    pet: {
      name: '小鹊', energy: 72, curiosity: 66, comfort: 70, feathers: 0,
      room: 'study', pose: 'idle', log: ['小鹊正在等待搬进你们的本地空间。'],
    },
    records: [], plans: [], journals: [], agentRuns: [], assistantMessages: [], logs: [],
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function chatRefValid(value:unknown):boolean{
 return value===undefined||(object(value)
  && ['ownerId','spaceId','conversationId','messageId','timestamp','chunkFile','manifestDigest','extractorVersion'].every(key=>typeof value[key]==='string')
  && Number.isSafeInteger(value.chunkLine)&&Number(value.chunkLine)>0)
}

function optionalDate(value: unknown): value is string {
  return value === '' || isDate(value)
}

function itemHasId(value: unknown): value is Record<string, unknown> & { id: string; title: string } {
  return object(value) && typeof value.id === 'string' && value.id.length > 0 && typeof value.title === 'string'
}

const agentSkillIds=['command-inbox','personal-memory','personal-planner','personal-journal','discover-imports','image-to-memory-plan','plan-follow-up','calendar-draft','email-draft','relationship-review']
function agentProposalValid(proposal:unknown):boolean{
 if(!object(proposal)||typeof proposal.id!=='string'||!['memory_draft','plan_draft','journal_draft','care_draft','calendar_draft','email_draft','product_action'].includes(String(proposal.kind))||typeof proposal.title!=='string'||!['L0','L1','L2','L3'].includes(String(proposal.riskLevel))||!Array.isArray(proposal.sourceIds)||!proposal.sourceIds.every(id=>typeof id==='string')||!['pending','approved','rejected','failed'].includes(String(proposal.status))||(proposal.result!==undefined&&typeof proposal.result!=='string')||!object(proposal.fields))return false
 const fields=proposal.fields
 return ['title','body','date','time','recurrenceUntil','description','subject','recipient','toolTarget','toolValue'].every(key=>fields[key]===undefined||typeof fields[key]==='string')&&(fields.reminderMinutes===undefined||typeof fields.reminderMinutes==='number')&&(fields.recordKind===undefined||['回忆','心愿','计划','偏好'].includes(String(fields.recordKind)))&&(fields.planKind===undefined||['心愿','计划','待办','提醒','纪念日'].includes(String(fields.planKind)))&&(fields.journalType===undefined||['信件','日常','年度回顾'].includes(String(fields.journalType)))&&(fields.recurrence===undefined||['none','daily','weekly','monthly','yearly'].includes(String(fields.recurrence)))&&(fields.careNeed===undefined||['想安静','想聊聊','想被听见','一起想办法'].includes(String(fields.careNeed)))&&(fields.productTool===undefined||['open-page','pet-touch','pet-feed','pet-rest','pet-wake','change-theme','toggle-care','toggle-pet','export-backup','export-museum'].includes(String(fields.productTool)))
}
function agentRunValid(run:unknown):boolean{
 if(!object(run)||typeof run.id!=='string'||typeof run.goal!=='string'||!['command','discover','image','followup','review','custom'].includes(String(run.mode))||!['awaiting_approval','needs_input','completed','failed','cancelled'].includes(String(run.status))||!Array.isArray(run.selectedSkills)||!run.selectedSkills.every(id=>agentSkillIds.includes(String(id)))||typeof run.summary!=='string'||!Array.isArray(run.sourceIds)||!run.sourceIds.every(id=>typeof id==='string')||typeof run.followUpQuestion!=='string'||typeof run.uncertainty!=='string'||typeof run.createdAt!=='string'||typeof run.updatedAt!=='string')return false
 if(!Array.isArray(run.steps)||!run.steps.every(step=>object(step)&&typeof step.id==='string'&&agentSkillIds.includes(String(step.skillId))&&typeof step.title==='string'&&typeof step.reason==='string'&&['ready','completed','blocked'].includes(String(step.status))))return false
 if(!Array.isArray(run.proposals)||!run.proposals.every(agentProposalValid))return false
 return Array.isArray(run.conversation)&&run.conversation.every(turn=>object(turn)&&['user','assistant'].includes(String(turn.role))&&typeof turn.text==='string'&&typeof turn.at==='string')
}

export function isDemoStore(value: unknown): value is DemoStore {
  if (!object(value) || value.version !== 1) return false
  const { records, plans, journals, pet, settings, care, agentRuns, assistantMessages, logs, importDraft } = value
  if (!Array.isArray(records) || !records.every((record) => itemHasId(record)
    && typeof record.body === 'string' && optionalDate(record.date)
    && ['回忆', '心愿', '计划', '偏好'].includes(String(record.kind))
    && ['pending', 'confirmed', 'ignored'].includes(String(record.status))
    && typeof record.source === 'string'
    && (record.image === undefined || typeof record.image === 'string')
    && (record.imageThumbnail === undefined || typeof record.imageThumbnail === 'string')
    && (record.mediaId === undefined || typeof record.mediaId === 'string')
    && (record.mediaScope === undefined || ['shared','private'].includes(String(record.mediaScope)))
    && (record.sensitive === undefined || typeof record.sensitive === 'boolean')
    && (record.needsDateReview === undefined || typeof record.needsDateReview === 'boolean')
    && (record.provenance === undefined || (object(record.provenance)
      && ['text','txt','json','csv','html','image-manual','image-ocr','audio-transcript','sample','workbuddy-chat'].includes(String(record.provenance.type))
      && ['batchId','label','original','mapped','importedAt','baseDate'].every(key=>typeof (record.provenance as Record<string,unknown>)[key]==='string')
      && typeof record.provenance.line==='number' && Number.isInteger(record.provenance.line) && record.provenance.line>0
      && chatRefValid(record.provenance.chatRef)))
    && (record.entityVersion === undefined || typeof record.entityVersion === 'number')
    && (record.expectedVersion === undefined || typeof record.expectedVersion === 'number'))) return false
  if (!Array.isArray(plans) || !plans.every((plan) => itemHasId(plan) && optionalDate(plan.date)
    && (plan.sourceRecordId===undefined||typeof plan.sourceRecordId==='string')
    && (plan.sensitive===undefined||typeof plan.sensitive==='boolean')
    && (plan.timezone===undefined||typeof plan.timezone==='string')
    && (plan.recurrence===undefined||['none','daily','weekly','monthly','yearly'].includes(String(plan.recurrence)))
    && (plan.recurrenceUntil===undefined||optionalDate(plan.recurrenceUntil))
    && (plan.reminderMinutes===undefined||plan.reminderMinutes===null||[0,10,30,60,1440].includes(Number(plan.reminderMinutes)))
    && (plan.completedOccurrences===undefined||Array.isArray(plan.completedOccurrences)&&plan.completedOccurrences.every(isDate))
    && typeof plan.time === 'string' && (plan.time === '' || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(plan.time))
    && ['心愿', '计划', '待办', '提醒', '纪念日'].includes(String(plan.kind))
    && ['todo', 'done', 'cancelled'].includes(String(plan.status))
    && (plan.entityVersion === undefined || typeof plan.entityVersion === 'number')
    && (plan.expectedVersion === undefined || typeof plan.expectedVersion === 'number'))) return false
  if (!Array.isArray(journals) || !journals.every((journal) => itemHasId(journal)
    && typeof journal.body === 'string' && isDate(journal.date)
    && ['信件', '时光胶囊', '日常', '年度回顾'].includes(String(journal.type))
    && (journal.unlockDate === undefined || optionalDate(journal.unlockDate))
    && (journal.unlockAt===undefined||typeof journal.unlockAt==='string'&&!Number.isNaN(Date.parse(journal.unlockAt)))
    && (journal.sensitive === undefined || typeof journal.sensitive === 'boolean')
    && (journal.entityVersion === undefined || typeof journal.entityVersion === 'number')
    && (journal.expectedVersion === undefined || typeof journal.expectedVersion === 'number'))) return false
  if (!object(pet) || typeof pet.name !== 'string' || !strings(pet.log)
    || !['energy', 'curiosity', 'comfort'].every((key) => typeof pet[key] === 'number' && Number.isFinite(pet[key]) && Number(pet[key]) >= 0 && Number(pet[key]) <= 100)
    || typeof pet.feathers !== 'number' || !Number.isFinite(pet.feathers) || pet.feathers < 0
    || !['study', 'garden', 'cosmos'].includes(String(pet.room))
    || !['idle', 'happy', 'eat', 'sleep'].includes(String(pet.pose))) return false
  if (!object(settings) || !themeOptions.some((theme) => theme.id === settings.theme)
    || typeof settings.selfName !== 'string' || typeof settings.partnerName !== 'string' || !isDate(settings.since)
    || !['demo','model','off'].includes(String(settings.aiMode))
    || (settings.aiModelConsent!==undefined&&typeof settings.aiModelConsent!=='boolean')
    || !['wechatDemo', 'syncDemo', 'moduleCare', 'modulePet', 'reduceMotion'].every((key) => typeof settings[key] === 'boolean')
    || (settings.onboardingCompleted !== undefined && typeof settings.onboardingCompleted !== 'boolean')
    || (settings.sampleMode !== undefined && typeof settings.sampleMode !== 'boolean')
    || (settings.assistantChatVersion !== undefined && (!Number.isInteger(settings.assistantChatVersion) || Number(settings.assistantChatVersion) < 1))) return false
  if(settings.boundSpaceId!==undefined&&typeof settings.boundSpaceId!=='string')return false
  if (!object(care) || typeof care.need !== 'string' || typeof care.shared !== 'boolean'
    || typeof care.draft !== 'string' || !strings(care.followups) || !optionalDate(care.cycleStart)) return false
  if(importDraft!==undefined&&(!object(importDraft)||![1,2].includes(Number(importDraft.step))||!['text','file','wechat'].includes(String(importDraft.tab))||typeof importDraft.text!=='string'||importDraft.text.length>100000||!isDate(importDraft.baseDate)||typeof importDraft.selfAlias!=='string'||typeof importDraft.partnerAlias!=='string'||!Array.isArray(importDraft.checkedLines)||!importDraft.checkedLines.every(line=>Number.isInteger(line)&&line>=0)||typeof importDraft.fileName!=='string'||!['text','txt','json','csv','html','image-manual','image-ocr','audio-transcript','sample'].includes(String(importDraft.sourceType))||typeof importDraft.savedAt!=='string'||(importDraft.binaryRequired!==undefined&&typeof importDraft.binaryRequired!=='boolean')))return false
  if(agentRuns!==undefined&&(!Array.isArray(agentRuns)||!agentRuns.every(agentRunValid)))return false
  if(assistantMessages!==undefined&&(!Array.isArray(assistantMessages)||!assistantMessages.every(message=>object(message)&&typeof message.id==='string'&&['user','assistant','system'].includes(String(message.role))&&['text','attachment','source_scope','agent_run','tool_result','error'].includes(String(message.kind))&&typeof message.text==='string'&&typeof message.createdAt==='string'&&(message.status===undefined||['pending','running','completed','failed','cancelled'].includes(String(message.status)))&&(message.runId===undefined||typeof message.runId==='string')&&(message.sourceIds===undefined||Array.isArray(message.sourceIds)&&message.sourceIds.every(id=>typeof id==='string'))&&(message.planIds===undefined||Array.isArray(message.planIds)&&message.planIds.every(id=>typeof id==='string'))&&(message.citationIds===undefined||Array.isArray(message.citationIds)&&message.citationIds.every(id=>typeof id==='string'))&&(message.suggestedCommands===undefined||Array.isArray(message.suggestedCommands)&&message.suggestedCommands.every(command=>typeof command==='string'))&&(message.operation===undefined||['question','agent-discover','agent-followup','agent-review','agent-custom'].includes(String(message.operation)))&&(message.query===undefined||typeof message.query==='string')&&(message.attachmentName===undefined||typeof message.attachmentName==='string'))))return false
  if (!Array.isArray(logs) || !logs.every((log) => object(log) && typeof log.id === 'string' && typeof log.time === 'string' && typeof log.text === 'string')) return false
  return true
}

function readLegacyStore(key=STORAGE_KEY,fallback=createEmptyStore()): { store: DemoStore; error: string; found: boolean } {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return { store: fallback, error: '', found: false }
    const restored: unknown = JSON.parse(raw)
    if (!isDemoStore(restored)) throw new Error('Invalid backup structure')
    return { store: restored, error: '', found: true }
  } catch {
    return { store: fallback, error: '无法读取旧版浏览器数据，暂时显示示例。原存储尚未覆盖。', found: true }
  }
}

type HydratedStore = { store: DemoStore; error: string; persistence: PersistenceState }

function entityPatch<T extends { id: string }>(before: T[], after: T[]): { upsert: T[]; remove: string[]; expected: Record<string, T | null> } {
  const previous = new Map(before.map(item => [item.id, item]))
  const current = new Map(after.map(item => [item.id, item]))
  const changed = after.filter(item => JSON.stringify(previous.get(item.id)) !== JSON.stringify(item))
  const removed = before.filter(item => !current.has(item.id))
  const expected = Object.fromEntries([...changed.map(item => [item.id, previous.get(item.id) ?? null]), ...removed.map(item => [item.id, item])])
  return {
    upsert: changed,
    remove: removed.map(item => item.id),
    expected,
  }
}

function storePatch(before: DemoStore, after: DemoStore): StorePatch {
  return {
    version: after.version,
    records: entityPatch(before.records, after.records),
    plans: entityPatch(before.plans, after.plans),
    journals: entityPatch(before.journals, after.journals),
    logs: entityPatch(before.logs, after.logs),
    settings: JSON.stringify(before.settings) === JSON.stringify(after.settings) ? undefined : after.settings,
    expectedSettings: JSON.stringify(before.settings) === JSON.stringify(after.settings) ? undefined : before.settings,
    care: JSON.stringify(before.care) === JSON.stringify(after.care) ? undefined : after.care,
    expectedCare: JSON.stringify(before.care) === JSON.stringify(after.care) ? undefined : before.care,
    pet: JSON.stringify(before.pet) === JSON.stringify(after.pet) ? undefined : after.pet,
    expectedPet: JSON.stringify(before.pet) === JSON.stringify(after.pet) ? undefined : before.pet,
    importDraft: JSON.stringify(before.importDraft??null)===JSON.stringify(after.importDraft??null)?undefined:after.importDraft??null,
    expectedImportDraft: JSON.stringify(before.importDraft??null)===JSON.stringify(after.importDraft??null)?undefined:before.importDraft??null,
    agentRuns: JSON.stringify(before.agentRuns??[])===JSON.stringify(after.agentRuns??[])?undefined:after.agentRuns??[],
    expectedAgentRuns: JSON.stringify(before.agentRuns??[])===JSON.stringify(after.agentRuns??[])?undefined:before.agentRuns??[],
    assistantMessages: JSON.stringify(before.assistantMessages??[])===JSON.stringify(after.assistantMessages??[])?undefined:after.assistantMessages??[],
    expectedAssistantMessages: JSON.stringify(before.assistantMessages??[])===JSON.stringify(after.assistantMessages??[])?undefined:before.assistantMessages??[],
  }
}

function cleanSnapshot(snapshot: DemoStore): DemoStore {
  const clean = <T extends { expectedVersion?: number }>(items: T[]): T[] => items.map(item => {
    const { expectedVersion: _expectedVersion, ...persisted } = item
    return persisted as T
  })
  return { ...snapshot,agentRuns:snapshot.agentRuns??[],assistantMessages:snapshot.assistantMessages??[], records: clean(snapshot.records), plans: clean(snapshot.plans), journals: clean(snapshot.journals) }
}

async function hydrateStore(accountId=''): Promise<HydratedStore> {
  const localRepository=repositoryFor(accountId)
  const empty=createEmptyStore();if(accountId)empty.settings.onboardingCompleted=true
  const legacy = accountId?readLegacyStore(`${STORAGE_KEY}:${accountId}`,empty):readLegacyStore()
  try {
    const loaded = await localRepository.load()
    if (loaded.snapshot !== null) {
      if (!isDemoStore(loaded.snapshot)) throw new Error('IndexedDB 中的数据结构无法识别')
      const normalized={...loaded.snapshot,agentRuns:loaded.snapshot.agentRuns??[],assistantMessages:loaded.snapshot.assistantMessages??[]}
      const info = loaded.info
      return {
        store: normalized,
        error: '',
        persistence: { status: 'ready', backend: 'indexeddb', revision: info?.revision ?? 0, savedAt: info?.savedAt ?? '', migrated: false },
      }
    }
    const seed = legacy.found ? structuredClone(legacy.store) : empty
    const info = await localRepository.save(seed)
    return {
      store: seed,
      error: legacy.error,
      persistence: { status: 'ready', backend: 'indexeddb', revision: info.revision, savedAt: info.savedAt, migrated: legacy.found && !legacy.error },
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '未知错误'
    return {
      store: structuredClone(legacy.store),
      error: `IndexedDB 暂时不可用，已切换到兼容存储：${message}`,
      persistence: { status: 'error', backend: 'legacy', revision: 0, savedAt: '', migrated: false },
    }
  }
}

export function useDemoStore(accountId=''): [DemoStore, Dispatch<SetStateAction<DemoStore>>, string, PersistenceState, RepositoryActions] {
  const localRepository=repositoryFor(accountId)
  const [store, setStore] = useState<DemoStore>(createEmptyStore)
  const [error, setError] = useState('')
  const [persistence, setPersistence] = useState<PersistenceState>({ status: 'loading', backend: 'memory', revision: 0, savedAt: '', migrated: false })
  const hydrated = useRef(false)
  const backend = useRef<PersistenceState['backend']>('memory')
  const lastSaved = useRef('')
  const lastSnapshot = useRef<DemoStore>(createEmptyStore())
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve())
  const saveSequence = useRef(0)
  const persistenceRef = useRef(persistence)
  const storeRef = useRef(store)

  useEffect(() => { persistenceRef.current = persistence }, [persistence])
  useEffect(() => { storeRef.current = store }, [store])

  useEffect(() => {
    let cancelled = false
    void hydrateStore(accountId).then(result => {
      if (cancelled) return
      backend.current = result.persistence.backend
      lastSaved.current = JSON.stringify(result.store)
      lastSnapshot.current = structuredClone(result.store)
      setStore(result.store)
      setError(result.error)
      setPersistence(result.persistence)
      hydrated.current = true
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!hydrated.current || persistenceRef.current.conflict) return
    const rawSnapshot = structuredClone(store)
    const snapshot = cleanSnapshot(rawSnapshot)
    const serialized = JSON.stringify(snapshot)
    if (serialized === lastSaved.current) return
    const sequence = ++saveSequence.current
    setPersistence(current => ({ ...current, status: 'saving' }))
    saveQueue.current = saveQueue.current.catch(() => undefined).then(async () => {
      if (backend.current === 'indexeddb') {
        // Earlier writes in this page may still be queued. Compare against their
        // committed result, while applyPatch still checks other tabs atomically.
        const patch = storePatch(lastSnapshot.current, rawSnapshot)
        const info: RepositoryInfo = await localRepository.applyPatch(patch)
        lastSaved.current = serialized
        lastSnapshot.current = structuredClone(snapshot)
        setStore(current => JSON.stringify(current) === JSON.stringify(rawSnapshot) && JSON.stringify(current) !== serialized ? snapshot : current)
        setError('')
        if (sequence === saveSequence.current) setPersistence(current => ({ ...current, status: 'ready', backend: 'indexeddb', revision: info.revision, savedAt: info.savedAt }))
        return
      }
      localStorage.setItem(accountId?`${STORAGE_KEY}:${accountId}`:STORAGE_KEY, serialized)
      lastSaved.current = serialized
      lastSnapshot.current = structuredClone(snapshot)
      setStore(current => JSON.stringify(current) === JSON.stringify(rawSnapshot) && JSON.stringify(current) !== serialized ? snapshot : current)
      if (sequence === saveSequence.current) setPersistence(current => ({ ...current, status: 'ready', backend: 'legacy', savedAt: new Date().toISOString() }))
    }).catch(cause => {
      if (cause instanceof RepositoryConflictError) {
        setError('另一标签页修改了同一份资料。请选择载入最新版本，或确认以此页版本覆盖。')
        if (sequence === saveSequence.current) setPersistence(current => ({ ...current, status: 'error', conflict: cause.conflicts }))
        return
      }
      const message = cause instanceof Error ? cause.message : '未知错误'
      setError(`保存失败：${message}。当前操作仍保留在页面中，请立即导出备份。`)
      if (sequence === saveSequence.current) setPersistence(current => ({ ...current, status: 'error' }))
    })
  }, [store])

  useEffect(() => localRepository.subscribe(change => {
    if (!hydrated.current || backend.current !== 'indexeddb' || persistenceRef.current.conflict || change.revision <= persistenceRef.current.revision) return
    saveQueue.current = saveQueue.current.catch(() => undefined).then(async () => {
      const loaded = await localRepository.load()
      if (!loaded.snapshot || !isDemoStore(loaded.snapshot) || !loaded.info) return
      const serialized = JSON.stringify(loaded.snapshot)
      lastSaved.current = serialized
      lastSnapshot.current = structuredClone(loaded.snapshot)
      setStore(loaded.snapshot)
      setError('')
      setPersistence(current => ({
        ...current, status: 'ready', backend: 'indexeddb', revision: loaded.info!.revision,
        savedAt: loaded.info!.savedAt, externalSyncAt: new Date().toISOString(), conflict: undefined,
      }))
    }).catch(cause => {
      const message = cause instanceof Error ? cause.message : '未知错误'
      setError(`读取另一标签页的更新失败：${message}`)
    })
  }), [])

  const reloadLatest = async (): Promise<void> => {
    const loaded = await localRepository.load()
    if (!loaded.snapshot || !loaded.info || !isDemoStore(loaded.snapshot)) throw new Error('资料库中没有可读取的最新版本')
    const serialized = JSON.stringify(loaded.snapshot)
    ++saveSequence.current
    lastSaved.current = serialized
    lastSnapshot.current = structuredClone(loaded.snapshot)
    storeRef.current = loaded.snapshot
    setStore(loaded.snapshot)
    setError('')
    setPersistence(current => ({ ...current, status: 'ready', backend: 'indexeddb', revision: loaded.info!.revision, savedAt: loaded.info!.savedAt, conflict: undefined, externalSyncAt: new Date().toISOString() }))
  }

  const overwriteCurrent = async (): Promise<void> => {
    const snapshot = cleanSnapshot(structuredClone(storeRef.current))
    const info = await localRepository.save(snapshot)
    const serialized = JSON.stringify(snapshot)
    ++saveSequence.current
    lastSaved.current = serialized
    lastSnapshot.current = structuredClone(snapshot)
    setError('')
    setPersistence(current => ({ ...current, status: 'ready', backend: 'indexeddb', revision: info.revision, savedAt: info.savedAt, conflict: undefined }))
  }

  useEffect(() => {
    if (persistence.migrated) {
      const timer = window.setTimeout(() => setPersistence(current => ({ ...current, migrated: false })), 6000)
      return () => window.clearTimeout(timer)
    }
  }, [persistence.migrated])

  return [store, setStore, error, persistence, { reloadLatest, overwriteCurrent }]
}

export function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function fullDateIn(text: string): string {
  const match = text.match(/(20\d{2})[-/年](\d{1,2})[-/月](\d{1,2})日?/)
  if (!match) return ''
  const date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
  return isDate(date) ? date : ''
}

function eventDate(body: string, base: string): { date: string; uncertain: boolean } {
  const explicitDates=[...new Set(body.match(/20\d{2}[-/年]\d{1,2}[-/月]\d{1,2}日?/g)??[])]
  const relativeDates=[...new Set(body.match(/前天|昨天|昨日|今天|今日|明天|明日|后天/g)??[])]
  if(explicitDates.length>1||relativeDates.length>1)return{date:'',uncertain:true}
  const full = fullDateIn(body)
  if (full) return { date: full, uncertain: false }
  const monthDay = body.match(/(?:^|[^\d])(\d{1,2})月(\d{1,2})[日号]?/)
  if (monthDay) {
    const date = `${base.slice(0, 4)}-${monthDay[1].padStart(2, '0')}-${monthDay[2].padStart(2, '0')}`
    return { date: isDate(date) ? date : '', uncertain: true }
  }
  if (/前天/.test(body)) return { date: shiftDate(base, -2), uncertain: false }
  if (/昨天|昨日/.test(body)) return { date: shiftDate(base, -1), uncertain: false }
  if (/后天/.test(body)) return { date: shiftDate(base, 2), uncertain: false }
  if (/明天|明日/.test(body)) return { date: shiftDate(base, 1), uncertain: false }
  if (/今天|今日/.test(body)) return { date: base, uncertain: false }
  if (/下周|这周|本周|上周|周[一二三四五六日天末]|下个?月|上个?月|月底|月初|以后|改天|有空|哪天|下次|等.*以后|过几天|某天/.test(body)) return { date: '', uncertain: true }
  return { date: '', uncertain: true }
}

function guessKind(body: string): RecordKind {
  if (/喜欢|不喜欢|偏好|不喝|少喝|低咖啡因|口味|不吃|忌口|过敏/.test(body)
    && !/一起.*(?:去了|吃了|喝了|看了)|昨天.*(?:去了|吃了|喝了|看了)/.test(body)) return '偏好'
  if (/取消|面试|考试|出差|航班|预约|已经订|订好了|约好了|定在|安排在|记得|提醒|截止/.test(body)) return '计划'
  if (/想去|想一起|希望一起|想和你|想跟你|下次|以后一起|有空一起|下周.*一起|周末.*一起|下个?月.*一起/.test(body)) return '心愿'
  return '回忆'
}

export function extractCandidates(text: string, baseDate: string): RecordItem[] {
  const base = isDate(baseDate) ? baseDate : today()
  const seen = new Set<string>()
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^[-=_*]{3,}$/.test(line)).flatMap((line) => {
    const normalized = line.replace(/\s+/g, '')
    if (seen.has(normalized)) return []
    seen.add(normalized)
    const timestamp = line.match(/^\[?(20\d{2}[-/年]\d{1,2}[-/月]\d{1,2}日?)(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\]?\s*/)
    const reference = timestamp ? fullDateIn(timestamp[1]) || base : base
    const body = (timestamp ? line.slice(timestamp[0].length) : line)
      .replace(/^\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*/, '')
      .replace(/^[^：:\d]{1,12}[：:]\s*/, '').trim()
    if (!body) return []
    const { date, uncertain } = eventDate(body, reference)
    const kind = guessKind(body)
    const phrase = body.split(/[。！？!?\n]/)[0].trim()
    const title = phrase.length > 24 ? `${phrase.slice(0, 24)}…` : phrase
    const sensitive = /紧张|焦虑|难过|不舒服|生理|月经|周期|药|医院|体检|私密|私人|不想分享|不要告诉/.test(body)
    return [{ id: makeId(), title: title || '一段值得核对的记录', body, date, kind, source: line, status: 'pending' as const, sensitive, needsDateReview:uncertain }]
  })
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
}

function download(content: string, filename: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

export function exportBackup(store: DemoStore): void {
  download(JSON.stringify(store, null, 2), `鹊信备份-${today()}.json`, 'application/json;charset=utf-8')
}

async function offlineImage(path?: string): Promise<string> {
  if (!path) return ''
  if (/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z\d+/=\s]+$/i.test(path)) return path
  try {
    const url = new URL(path, window.location.href)
    if (url.origin !== window.location.origin || !['http:', 'https:'].includes(url.protocol)) return ''
    const response = await fetch(url.href)
    if (!response.ok) return ''
    const blob = await response.blob()
    if (!/^image\/(?:png|jpe?g|webp|gif)$/.test(blob.type)) return ''
    return await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
      reader.onerror = () => resolve('')
      reader.readAsDataURL(blob)
    })
  } catch {
    return ''
  }
}

export async function exportMuseum(records: RecordItem[], journals: Journal[] = [], includeSources = true): Promise<void> {
  const selected = records.filter((record) => record.status === 'confirmed').sort((a, b) => b.date.localeCompare(a.date))
  const images = await Promise.all(selected.map((record) => offlineImage(record.image)))
  const omittedImages = selected.filter((record, index) => record.image && !images[index]).length
  const cards = selected.map((record, index) => `<article>${images[index] ? `<img class="photo" src="${escapeHtml(images[index])}" alt="${escapeHtml(record.title)}">` : ''}<div class="story"><div class="meta">${escapeHtml(record.date || '日期待补充')} · ${escapeHtml(record.kind)}</div><h2>${escapeHtml(record.title)}</h2><p>${escapeHtml(record.body)}</p>${includeSources && record.source ? `<details><summary>查看记录来源</summary><p>${escapeHtml(record.source)}</p></details>` : ''}</div></article>`).join('\n')
  const journalCards = journals.map((journal) => {
    const unlock=journal.unlockAt??journal.unlockDate??'',locked=journal.type==='时光胶囊'&&Boolean(unlock)&&(journal.unlockAt?Date.parse(journal.unlockAt)>Date.now():unlock>today())
    return `<article class="letter"><div class="story"><div class="meta">${escapeHtml(journal.date)} · ${escapeHtml(journal.type)}</div><h2>${escapeHtml(journal.title)}</h2>${locked ? `<p>这封时光胶囊将在 ${escapeHtml(unlock)} 开启。尚未到开启时间，正文未包含在本次纪念馆中。</p>` : `<p>${escapeHtml(journal.body)}</p>`}</div></article>`
  }).join('\n')
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>鹊信 · 我们的纪念馆</title><style>*{box-sizing:border-box}body{margin:0;padding:70px 24px;background:#f6f0e5;color:#3e3830;font:16px/1.9 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}main{max-width:800px;margin:auto}header{padding:20px 0 48px;border-bottom:1px solid #ddceba;margin-bottom:36px}.mark{font-size:14px;color:#a13b29;letter-spacing:.2em}.meta,small{color:#88725d;font-size:13px;letter-spacing:.05em}h1{font-family:"Songti SC",serif;font-size:42px;line-height:1.4;margin:16px 0}h2{font-family:"Songti SC",serif;font-size:25px;margin:10px 0}p{white-space:pre-wrap;overflow-wrap:anywhere}article{overflow:hidden;margin-bottom:28px;background:#fffcf6;border:1px solid #e5d6c1;border-radius:12px}.story{padding:30px}.photo{display:block;width:100%;max-height:500px;object-fit:cover}.letter{background:#f9f0dd}details{padding-top:16px;margin-top:22px;border-top:1px solid #eee3d1;font-size:13px;color:#83715f}summary{cursor:pointer}footer{padding:30px 0;color:#8d7b68;text-align:center;font-size:12px}section>h2{margin:48px 0 22px}.note{font-size:13px;color:#8d6f51}@media(max-width:520px){body{padding:32px 16px}h1{font-size:32px}.story{padding:22px}}@media print{body{background:white;padding:0}article{break-inside:avoid}details{display:none}}</style></head><body><main><header><div class="mark">鹊信 · 把喜欢写进日常</div><h1>普通日子，也值得珍藏。</h1><p>${selected.length} 段被认真记住的时光，${journals.length} 篇写给彼此的话。</p><small>导出于 ${today()} · 可独立离线阅读</small></header><section>${cards || '<article><div class="story"><p>我们的故事，还在慢慢发生。</p></div></article>'}</section>${journals.length ? `<section><h2>写给彼此的话</h2>${journalCards}</section>` : ''}${omittedImages ? `<p class="note">有 ${omittedImages} 张图片暂时无法读取；对应文字已完整保存。</p>` : ''}<footer>鹊信 · 我们的纪念馆<br>本文件不需要网络、远程字体或外部脚本。已包含可读取的本地照片。</footer></main></body></html>`
  download(html, `鹊信纪念馆-${today()}.html`, 'text/html;charset=utf-8')
}
