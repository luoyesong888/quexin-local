import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'

const paths:Record<string,ReactNode> = {
 home:<><path d="m3 10 9-7 9 7"/><path d="M5 9v12h14V9M9 21v-7h6v7"/></>,
 import:<><path d="M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6"/></>,
 image:<><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/></>,
 calendar:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18M8 14h1m6 0h1m-8 4h1"/></>,
 heart:<path d="M20.8 4.7a5.5 5.5 0 0 0-7.8 0L12 5.8l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.5a5.5 5.5 0 0 0 0-7.8Z"/>,
 bird:<><path d="M3 18c6 0 5-11 11-12 3-1 5 1 5 4l3 1-4 1c-1 5-6 7-11 6l-5 3 3-5"/><path d="M8 15c3 1 6-1 7-4M13 19v3m3-4v3"/><circle cx="16.5" cy="9" r=".5"/></>,
 feather:<><path d="M20 3C9 1 3 8 5 16c7 2 15-3 15-13Z"/><path d="m3 21 13-13M7 17v-6m4 2h6"/></>,
 settings:<><path d="m10 3-1 3-3 1-3 3 2 2-1 4 3 3 3-1 2 3 4-1 1-3 3-1 1-4-3-2-1-3-3-1Z"/><circle cx="12" cy="12" r="3"/></>,
 search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
 plus:<path d="M12 4v16M4 12h16"/>,
 arrow:<path d="M4 12h16m-6-6 6 6-6 6"/>,
 chevron:<path d="m9 5 7 7-7 7"/>,
 close:<path d="m5 5 14 14M5 19 19 5"/>,
 check:<path d="m4 12 5 5L20 6"/>,
 lock:<><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>,
 source:<><path d="m10 14 4-4M8 15l-2 2a3.5 3.5 0 0 1-5-5l5-5a3.5 3.5 0 0 1 5 0M13 17a3.5 3.5 0 0 0 5 0l5-5a3.5 3.5 0 0 0-5-5l-2 2" transform="translate(1 -1) scale(.9)"/></>,
 database:<><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/></>,
 model:<><path d="m12 2 9 5v10l-9 5-9-5V7Z"/><path d="m3 7 9 5 9-5M12 12v10"/></>,
 message:<><path d="M21 15a3 3 0 0 1-3 3H8l-5 4V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3Z"/><path d="M7 8h10M7 12h7"/></>,
 download:<><path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/></>,
 edit:<><path d="m16 3 5 5L8 21H3v-5ZM13 6l5 5"/></>,
 trash:<><path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/></>,
 sun:<><circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/></>,
 moon:<path d="M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12Z"/>,
 gift:<><path d="M3 8h18v4H3zM5 12v9h14v-9M12 8v13"/><path d="M12 8C3 8 5 1 9 4l3 4c9 0 7-7 3-4Z"/></>,
 mail:<><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 6 10 7L22 6"/></>,
 clock:<><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>,
 book:<><path d="M12 5C8 2 4 3 2 4v16c3-2 7-2 10 0 3-2 7-2 10 0V4c-3-1-7-2-10 1ZM12 5v15"/></>,
 cup:<><path d="M4 5h12v9a6 6 0 0 1-12 0ZM16 6h2a3 3 0 0 1 0 6h-2M2 22h18"/></>,
 hand:<><path d="M8 13V5a2 2 0 0 1 4 0v7-9a2 2 0 0 1 4 0v9-6a2 2 0 0 1 4 0v9c0 9-12 9-14 4l-4-6a2 2 0 0 1 3-2l3 3"/></>,
 shell:<><path d="M12 21C7 18 2 13 2 8 2 0 22 0 22 8c0 5-5 10-10 13Z"/><path d="M12 21V4m0 17L6 5m6 16 6-16"/></>,
 bell:<><path d="M4 17h16l-2-3V9a6 6 0 0 0-12 0v5ZM10 21h4"/></>,
 menu:<path d="M4 6h16M4 12h16M4 18h16"/>,
 info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-11v1"/></>,
 refresh:<><path d="M20 5v5h-5M4 19v-5h5"/><path d="M20 10a8 8 0 0 0-14-5M4 14a8 8 0 0 0 14 5"/></>,
 grid:<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
 users:<><circle cx="9" cy="7" r="4"/><path d="M2 21v-3a7 7 0 0 1 14 0v3M17 3a4 4 0 0 1 0 8m2 3a6 6 0 0 1 3 7"/></>,
 palette:<><path d="M12 3a9 9 0 1 0 0 18c3 0 1-4 3-5 2-1 6 1 6-4a9 9 0 0 0-9-9Z"/><circle cx="7" cy="9" r="1"/><circle cx="12" cy="6" r="1"/><circle cx="17" cy="9" r="1"/></>,
 star:<path d="m12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1Z"/>,
 leaf:<><path d="M21 3C6 1 1 8 6 17c8 4 15-1 15-14ZM3 21 17 7"/></>,
 upload:<><path d="M12 17V3m-5 5 5-5 5 5M4 17v4h16v-4"/></>,
 eye:<><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
 chart:<path d="M4 20V9m8 11V3m8 17v-7"/>,
 room:<><path d="m3 10 9-7 9 7M5 9v12h14V9M8 16h8v5M8 13h8"/></>,
 archive:<><path d="M3 3h18v5H3zM5 8v13h14V8M9 12h6"/></>,
 shield:<><path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Z"/><path d="m8 12 3 3 5-6"/></>,
 play:<path d="m7 3 14 9-14 9Z"/>,
 copy:<><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></>,
 arrowLeft:<path d="M20 12H4m6-6-6 6 6 6"/>,
 arrowRight:<path d="M4 12h16m-6-6 6 6-6 6"/>,
 sparkle:<><path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z"/></>,
}
export function Icon({name,size=20}:{name:string;size?:number}) {
 const aliases:Record<string,string>={memories:'image',planner:'calendar',care:'heart',nest:'bird',create:'feather',today:'home',wechat:'message',feed:'cup',pet:'hand',sleep:'moon',decor:'room',chevronRight:'chevron',chevronLeft:'arrowLeft',chevronDown:'chevron',file:'book',save:'check',external:'arrow',camera:'image',send:'arrow',sync:'refresh',spark:'sparkle',activity:'chart',history:'clock',database:'database',eyeoff:'lock',pen:'edit',reset:'refresh'}
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]??paths[aliases[name]]??paths.star}</svg>
}
export function Modal({title,onClose,children,wide=false}:{title:string;onClose:()=>void;children:ReactNode;wide?:boolean}) {
 const ref=useRef<HTMLDialogElement>(null)
 const returnFocus=useRef<HTMLElement|null>(document.activeElement instanceof HTMLElement?document.activeElement:null)
 const titleId=useId()
 useEffect(()=>{const d=ref.current;d?.showModal();return()=>{
  d?.close()
  const trigger=returnFocus.current
  if(trigger?.isConnected&&trigger.getClientRects().length&&!trigger.closest('dialog')&&!document.querySelector('dialog[open]'))trigger.focus({preventScroll:true})
 }},[])
 return <dialog ref={ref} aria-modal="true" aria-labelledby={titleId} className={`modal ${wide?'modal-wide':''}`} onCancel={e=>{e.preventDefault();onClose()}} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onClose()}}}><header className="modal-heading"><h2 id={titleId}>{title}</h2><button type="button" className="icon-btn" onClick={onClose} aria-label="关闭弹窗"><Icon name="close"/></button></header><div className="modal-content">{children}</div></dialog>
}
export function Empty({text,action}:{text:string;action?:ReactNode}) {return <div className="empty"><Icon name="feather" size={32}/><p>{text}</p>{action}</div>}
