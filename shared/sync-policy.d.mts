import type {DemoStore,RecordItem,PlanItem,Journal} from '../src/domain'
import type {SyncQueueEntry} from '../src/sync-state'
export type SyncSnapshot=Pick<DemoStore,'records'|'plans'|'journals'>
export function canCite(record:RecordItem):boolean
export function canSharePlan(plan:PlanItem,records:RecordItem[]):boolean
export function syncPayload(item:RecordItem|PlanItem|Journal):Record<string,unknown>
export function fingerprint(value:unknown):string
export function shareableEntities(store:SyncSnapshot):Array<{entity:'record'|'plan'|'journal';item:RecordItem|PlanItem|Journal}>
export function pruneQueuedChanges(queue:SyncQueueEntry[],store:SyncSnapshot):SyncQueueEntry[]
export function privateEntityKeys(store:SyncSnapshot):Set<string>
