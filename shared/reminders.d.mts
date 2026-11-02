import type {PlanItem} from '../src/domain'
export type ReminderOccurrence={key:string;planId:string;title:string;date:string;time:string;timezone:string;eventAt:number;reminderAt:number}
export function validTimeZone(zone:string):boolean
export function recurrenceDates(plan:PlanItem,from:string,to:string,limit?:number):string[]
export function zonedDateTimeEpoch(date:string,time:string,zone:string):number
export function reminderOccurrences(plan:PlanItem,now?:number,catchUpMs?:number):ReminderOccurrence[]
export function recurrenceLabel(plan:PlanItem):string
