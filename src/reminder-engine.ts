import {useEffect,useRef} from 'react'
import type {PlanItem} from './domain'
import {reminderOccurrences,type ReminderOccurrence} from '../shared/reminders.mjs'

const DB='quexin-reminder-state',STORE='sent'
const request=<T,>(value:IDBRequest<T>)=>new Promise<T>((resolve,reject)=>{value.onsuccess=()=>resolve(value.result);value.onerror=()=>reject(value.error)})
async function database(){const open=indexedDB.open(DB,1);open.onupgradeneeded=()=>open.result.createObjectStore(STORE,{keyPath:'key'});return request(open)}
async function lock<T>(action:()=>Promise<T>):Promise<T|undefined>{return navigator.locks?navigator.locks.request('quexin-reminder-delivery',{ifAvailable:true},async value=>value?action():undefined):action()}
async function notification(item:ReminderOccurrence){
 if(typeof Notification==='undefined'||Notification.permission!=='granted'||!window.isSecureContext)return false
 const registration=await navigator.serviceWorker?.getRegistration('/')
 if(registration){let delivered=false;try{await registration.showNotification(`鹊信提醒 · ${item.title}`,{body:`${item.date} ${item.time} · ${item.timezone}`,tag:item.key,data:{url:'#planner',planId:item.planId}});delivered=true}catch{}window.dispatchEvent(new CustomEvent('quexin-reminder-notification',{detail:{...item,delivered}}));return delivered}
 return false
}
export async function runReminderCheck(plans:PlanItem[],onDue:(item:ReminderOccurrence)=>void,now=Date.now()){
 return lock(async()=>{const db=await database();try{const read=db.transaction(STORE,'readonly'),all=await request(read.objectStore(STORE).getAll()) as Array<{key:string;sentAt:number}>,sent=new Set(all.map(row=>row.key)),due=plans.flatMap(plan=>reminderOccurrences(plan,now)).filter(item=>!sent.has(item.key));for(const item of due){onDue(item);await notification(item)}const write=db.transaction(STORE,'readwrite'),store=write.objectStore(STORE);for(const item of due)store.put({key:item.key,sentAt:now});for(const row of all)if(row.sentAt<now-400*86400000)store.delete(row.key);await new Promise<void>((resolve,reject)=>{write.oncomplete=()=>resolve();write.onerror=()=>reject(write.error);write.onabort=()=>reject(write.error)});return due}finally{db.close()}})
}
export function useReminderEngine(plans:PlanItem[],onDue:(item:ReminderOccurrence)=>void){
 const callback=useRef(onDue);callback.current=onDue
 useEffect(()=>{let active=true;const run=()=>{if(active)void runReminderCheck(plans,item=>callback.current(item)).catch(()=>{})};run();const interval=window.setInterval(run,30_000),visible=()=>{if(document.visibilityState==='visible')run()};document.addEventListener('visibilitychange',visible);return()=>{active=false;window.clearInterval(interval);document.removeEventListener('visibilitychange',visible)}},[JSON.stringify(plans)])
}
export function notificationPermission():NotificationPermission|'unsupported'{return typeof Notification==='undefined'?'unsupported':Notification.permission}
export async function requestReminderPermission(){if(typeof Notification==='undefined')return'unsupported' as const;return Notification.requestPermission()}
