import type { DemoStore, Journal, PlanItem, RecordItem } from './domain'

const DATABASE_NAME = 'quexin-web'
const DATABASE_VERSION = 1
const META_STORE = 'meta'
const ENTITY_STORES = ['records', 'plans', 'journals', 'logs'] as const

type EntityStore = typeof ENTITY_STORES[number]
type MetaEntry = { key: string; value: unknown }

export type RepositoryInfo = {
  backend: 'indexeddb'
  revision: number
  savedAt: string
  localUserId: string
}

export type EntityPatch<T extends { id: string }> = { upsert: T[]; remove: string[]; expected: Record<string, T | null> }
export type StorePatch = {
  version: DemoStore['version']
  records: EntityPatch<RecordItem>
  plans: EntityPatch<PlanItem>
  journals: EntityPatch<Journal>
  logs: EntityPatch<DemoStore['logs'][number]>
  settings?: DemoStore['settings']
  expectedSettings?: DemoStore['settings']
  care?: DemoStore['care']
  expectedCare?: DemoStore['care']
  pet?: DemoStore['pet']
  expectedPet?: DemoStore['pet']
  importDraft?: DemoStore['importDraft'] | null
  expectedImportDraft?: DemoStore['importDraft'] | null
  agentRuns?: NonNullable<DemoStore['agentRuns']>
  expectedAgentRuns?: NonNullable<DemoStore['agentRuns']>
  assistantMessages?: NonNullable<DemoStore['assistantMessages']>
  expectedAssistantMessages?: NonNullable<DemoStore['assistantMessages']>
}
export type RepositoryChange = RepositoryInfo & { sourceId: string }
export type RepositoryConflict = { store: EntityStore | 'settings' | 'care' | 'pet' | 'importDraft'|'agentRuns'|'assistantMessages'; id: string; label: string }

export class RepositoryConflictError extends Error {
  readonly conflicts: RepositoryConflict[]
  constructor(conflicts: RepositoryConflict[]) {
    super('同一份资料已在另一个标签页发生变化')
    this.name = 'RepositoryConflictError'
    this.conflicts = conflicts
  }
}

export interface QuexinRepository {
  load(): Promise<{ snapshot: unknown | null; info: RepositoryInfo | null }>
  save(snapshot: DemoStore): Promise<RepositoryInfo>
  applyPatch(patch: StorePatch): Promise<RepositoryInfo>
  subscribe(listener: (change: RepositoryChange) => void): () => void
  clear(): Promise<void>
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('浏览器数据库操作失败'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('浏览器数据库事务已取消'))
    transaction.onerror = () => reject(transaction.error ?? new Error('浏览器数据库事务失败'))
  })
}

function localUserId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function openDatabase(databaseName=DATABASE_NAME): Promise<IDBDatabase> {
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('当前浏览器不支持 IndexedDB'))
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      for (const name of ENTITY_STORES) {
        if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(META_STORE)) database.createObjectStore(META_STORE, { keyPath: 'key' })
    }
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => database.close()
      resolve(database)
    }
    request.onblocked = () => reject(new Error('浏览器数据库正在被另一个旧页面占用，请关闭其他鹊信页面后重试'))
    request.onerror = () => reject(request.error ?? new Error('无法打开浏览器数据库'))
  })
}

async function readMeta(store: IDBObjectStore, key: string): Promise<unknown> {
  const entry = await requestResult(store.get(key)) as MetaEntry | undefined
  return entry?.value
}

export class IndexedDbRepository implements QuexinRepository {
  private readonly sourceId = localUserId()
  private readonly listeners = new Set<(change: RepositoryChange) => void>()
  private readonly channel: BroadcastChannel | null

  constructor(private readonly databaseName=DATABASE_NAME) {
    this.channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel(`quexin-repository-v1:${databaseName}`)
    if (this.channel) this.channel.onmessage = event => {
      const change = event.data as Partial<RepositoryChange> & { type?: string }
      if (change.type !== 'saved' || change.sourceId === this.sourceId || typeof change.revision !== 'number') return
      const normalized: RepositoryChange = {
        backend: 'indexeddb', sourceId: String(change.sourceId), revision: change.revision,
        savedAt: String(change.savedAt ?? ''), localUserId: String(change.localUserId ?? ''),
      }
      for (const listener of this.listeners) listener(normalized)
    }
  }

  private publish(info: RepositoryInfo): void {
    this.channel?.postMessage({ type: 'saved', sourceId: this.sourceId, ...info })
  }

  subscribe(listener: (change: RepositoryChange) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async load(): Promise<{ snapshot: unknown | null; info: RepositoryInfo | null }> {
    const database = await openDatabase(this.databaseName)
    try {
      const transaction = database.transaction([...ENTITY_STORES, META_STORE], 'readonly')
      const arrays = await Promise.all(ENTITY_STORES.map(name => requestResult(transaction.objectStore(name).getAll())))
      const meta = transaction.objectStore(META_STORE)
      const [settings, care, pet, importDraft,agentRuns,assistantMessages, app] = await Promise.all([
        readMeta(meta, 'settings'), readMeta(meta, 'care'), readMeta(meta, 'pet'), readMeta(meta,'importDraft'),readMeta(meta,'agentRuns'),readMeta(meta,'assistantMessages'), readMeta(meta, 'app'),
      ])
      await transactionDone(transaction)
      if (!app || typeof app !== 'object') return { snapshot: null, info: null }
      const appMeta = app as Partial<RepositoryInfo> & { version?: number }
      const snapshot = {
        version: appMeta.version,
        records: arrays[0], plans: arrays[1], journals: arrays[2], logs: arrays[3],
        settings, care, pet,agentRuns:Array.isArray(agentRuns)?agentRuns:[],assistantMessages:Array.isArray(assistantMessages)?assistantMessages:[], ...(importDraft===undefined?{}:{importDraft}),
      }
      const info: RepositoryInfo = {
        backend: 'indexeddb',
        revision: typeof appMeta.revision === 'number' ? appMeta.revision : 0,
        savedAt: typeof appMeta.savedAt === 'string' ? appMeta.savedAt : '',
        localUserId: typeof appMeta.localUserId === 'string' ? appMeta.localUserId : localUserId(),
      }
      return { snapshot, info }
    } finally {
      database.close()
    }
  }

  async save(snapshot: DemoStore): Promise<RepositoryInfo> {
    const database = await openDatabase(this.databaseName)
    try {
      const transaction = database.transaction([...ENTITY_STORES, META_STORE], 'readwrite', { durability: 'strict' })
      const meta = transaction.objectStore(META_STORE)
      const oldApp = await requestResult(meta.get('app')) as MetaEntry | undefined
      const previous = oldApp?.value && typeof oldApp.value === 'object' ? oldApp.value as Partial<RepositoryInfo> : {}
      const info: RepositoryInfo = {
        backend: 'indexeddb', revision: (previous.revision ?? 0) + 1,
        savedAt: new Date().toISOString(), localUserId: previous.localUserId ?? localUserId(),
      }
      const values: Record<EntityStore, Array<{ id: string }>> = {
        records: snapshot.records, plans: snapshot.plans, journals: snapshot.journals, logs: snapshot.logs,
      }
      for (const name of ENTITY_STORES) {
        const store = transaction.objectStore(name)
        store.clear()
        for (const item of values[name]) store.put(structuredClone(item))
      }
      meta.put({ key: 'settings', value: structuredClone(snapshot.settings) })
      meta.put({ key: 'care', value: structuredClone(snapshot.care) })
      meta.put({ key: 'pet', value: structuredClone(snapshot.pet) })
      meta.put({key:'agentRuns',value:structuredClone(snapshot.agentRuns??[])})
      meta.put({key:'assistantMessages',value:structuredClone(snapshot.assistantMessages??[])})
      if(snapshot.importDraft)meta.put({key:'importDraft',value:structuredClone(snapshot.importDraft)});else meta.delete('importDraft')
      meta.put({ key: 'app', value: { ...info, version: snapshot.version } })
      await transactionDone(transaction)
      this.publish(info)
      return info
    } finally {
      database.close()
    }
  }

  async applyPatch(patch: StorePatch): Promise<RepositoryInfo> {
    const database = await openDatabase(this.databaseName)
    try {
      const transaction = database.transaction([...ENTITY_STORES, META_STORE], 'readwrite', { durability: 'strict' })
      const meta = transaction.objectStore(META_STORE)
      const oldApp = await requestResult(meta.get('app')) as MetaEntry | undefined
      const previous = oldApp?.value && typeof oldApp.value === 'object' ? oldApp.value as Partial<RepositoryInfo> : {}
      const info: RepositoryInfo = {
        backend: 'indexeddb', revision: (previous.revision ?? 0) + 1,
        savedAt: new Date().toISOString(), localUserId: previous.localUserId ?? localUserId(),
      }
      const patches: Pick<StorePatch, EntityStore> = {
        records: patch.records, plans: patch.plans, journals: patch.journals, logs: patch.logs,
      }
      const checks: Array<Promise<RepositoryConflict | null>> = []
      for (const name of ['records', 'plans', 'journals'] as const) {
        const store = transaction.objectStore(name)
        for (const [id, expected] of Object.entries(patches[name].expected)) {
          const deleting = patches[name].remove.includes(id)
          const incoming = patches[name].upsert.find(item => item.id === id) as ({ expectedVersion?: number; entityVersion?: number; title?: string } | undefined)
          checks.push(requestResult(store.get(id)).then(current => {
            if (deleting && current === undefined) return null
            if (incoming?.expectedVersion !== undefined && current !== undefined) {
              const currentVersion = typeof current.entityVersion === 'number' ? current.entityVersion : 0
              if (currentVersion !== incoming.expectedVersion) return { store: name, id, label: incoming.title ?? id }
            }
            if (JSON.stringify(current ?? null) === JSON.stringify(expected)) return null
            const label = expected && typeof expected === 'object' && 'title' in expected ? String(expected.title) : id
            return { store: name, id, label }
          }))
        }
      }
      const metaChecks: Array<[keyof Pick<StorePatch, 'settings' | 'care' | 'pet' | 'importDraft'|'agentRuns'|'assistantMessages'>, unknown, unknown]> = [
        ['settings', patch.settings, patch.expectedSettings],
        ['care', patch.care, patch.expectedCare],
        ['pet', patch.pet, patch.expectedPet],
        ['importDraft',patch.importDraft,patch.expectedImportDraft],
        ['agentRuns',patch.agentRuns,patch.expectedAgentRuns],
        ['assistantMessages',patch.assistantMessages,patch.expectedAssistantMessages],
      ]
      for (const [name, value, expected] of metaChecks) {
        if (value === undefined) continue
        checks.push(requestResult(meta.get(name)).then(entry => {
          const current = name==='importDraft'?((entry as MetaEntry|undefined)?.value??null):name==='agentRuns'||name==='assistantMessages'?((entry as MetaEntry|undefined)?.value??[]):(entry as MetaEntry | undefined)?.value
          return JSON.stringify(current) === JSON.stringify(expected) ? null : { store: name, id: name, label: name }
        }))
      }
      const conflicts = (await Promise.all(checks)).filter((item): item is RepositoryConflict => item !== null)
      if (conflicts.length) {
        transaction.abort()
        throw new RepositoryConflictError(conflicts)
      }
      for (const name of ENTITY_STORES) {
        const store = transaction.objectStore(name)
        for (const id of patches[name].remove) store.delete(id)
        for (const item of patches[name].upsert) {
          const { expectedVersion: _expectedVersion, ...persisted } = item as { expectedVersion?: number; [key: string]: unknown }
          store.put(structuredClone(persisted))
        }
      }
      if (patch.settings) meta.put({ key: 'settings', value: structuredClone(patch.settings) })
      if (patch.care) meta.put({ key: 'care', value: structuredClone(patch.care) })
      if (patch.pet) meta.put({ key: 'pet', value: structuredClone(patch.pet) })
      if(patch.agentRuns)meta.put({key:'agentRuns',value:structuredClone(patch.agentRuns)})
      if(patch.assistantMessages)meta.put({key:'assistantMessages',value:structuredClone(patch.assistantMessages)})
      if(patch.importDraft!==undefined){if(patch.importDraft===null)meta.delete('importDraft');else meta.put({key:'importDraft',value:structuredClone(patch.importDraft)})}
      meta.put({ key: 'app', value: { ...info, version: patch.version } })
      await transactionDone(transaction)
      this.publish(info)
      return info
    } finally {
      database.close()
    }
  }

  async clear(): Promise<void> {
    const database = await openDatabase(this.databaseName)
    try {
      const transaction = database.transaction([...ENTITY_STORES, META_STORE], 'readwrite')
      for (const name of [...ENTITY_STORES, META_STORE]) transaction.objectStore(name).clear()
      await transactionDone(transaction)
    } finally {
      database.close()
    }
  }
}

export const localRepository: QuexinRepository = new IndexedDbRepository()
const accounts=new Map<string,QuexinRepository>()
export function repositoryFor(accountId:string):QuexinRepository{
  if(!accountId)return localRepository
  if(!accounts.has(accountId))accounts.set(accountId,new IndexedDbRepository(`quexin-web-account-${accountId}`))
  return accounts.get(accountId)!
}
