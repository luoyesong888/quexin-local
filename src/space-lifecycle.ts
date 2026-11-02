import type {DemoStore} from './domain'

export function archiveSpace(store:DemoStore,spaceId:string):DemoStore{
 return {...store,settings:{...store.settings,boundSpaceId:spaceId},records:store.records.map(item=>({...item,sensitive:true})),plans:store.plans.map(item=>({...item,sensitive:true})),journals:store.journals.map(item=>({...item,sensitive:true}))}
}
export function bindSpace(store:DemoStore,spaceId:string):DemoStore{
 const old=store.settings.boundSpaceId
 const base=old&&old!==spaceId?archiveSpace(store,old):store
 return {...base,settings:{...base.settings,boundSpaceId:spaceId}}
}
