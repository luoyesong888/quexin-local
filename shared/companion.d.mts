import type { DemoStore } from '../src/domain'
export type CompanionAction={commandId:string;kind:'touch'|'feed'|'rest'|'wake'|'rename'|'room'|'journey'|'profile'|'preen'|'deliver'|'explore'|'memory_growth';name?:string;room?:DemoStore['pet']['room'];title?:string;sourceId?:string;contribution?:number;profile?:{selfName:string;partnerName:string;since:string}}
export type CompanionState={revision:number;profile:{ownerName:string;partnerName:string;since:string};pet:DemoStore['pet'];events:Array<{id:string;actorId:string;actorName:string;kind:string;at:string;text:string;sourceId?:string;contribution?:number}>;growthSources?:Array<{sourceId:string;title:string;contribution:number;addedAt:string}>}
export function memoryContribution(payload:unknown):number
export function initialCompanion(members:Array<{role:string;displayName:string}>,createdAt:string):CompanionState
export function applyCompanionAction(current:CompanionState,action:CompanionAction,actor:{userId:string;displayName:string;role:string},now?:string):CompanionState
