import type {View} from './types'
export type Mic='live'|'muted'|'blocked'
export type Pill='available'|'ringing'|'on_call'|'reconnecting'
export type Pane='reports'|'report'|'engine'
/** A call is a call: while connected the call bar offers Hang up, Hold on and Mute; typing is a collapsed fallback and board actions wait until after the call. `socket` is true for a live or redialing call. Returns i18n keys plus the pill state. */
export function callControls(s:{socket:boolean;ringing:boolean;mic:Mic;reconnecting?:boolean}){const pill:Pill=s.reconnecting?'reconnecting':s.socket?'on_call':s.ringing?'ringing':'available';return {connect:s.socket?'agency.hang_up':s.ringing?'agency.answer_call':'agency.connect',mic:s.mic==='live'?'agency.mute':s.mic==='muted'?'agency.unmute':'agency.mic_on',idle:s.mic==='blocked'?'agency.mic_blocked':'agency.ready',onCall:s.socket,typeOpen:s.mic==='blocked',pill,pillLabel:`agency.pill_${pill}`}}
/** Which drawer sections show: engine and report panes win, then the selected room, else the report list (plus open questions, but never during a call). */
export function drawerSections(s:{onCall:boolean;view:View;pane:Pane;questions:number}){const engine=s.pane==='engine',report=!engine&&s.pane==='report',room=!engine&&!report&&s.view==='project',list=!engine&&!report&&!room;return {questions:list&&!s.onCall&&s.questions>0,reports:list,report,room,engine,back:!list}}
/** Report detail buttons: Donna reads only unread reports and only on a call; marking read is for off-call. */
export function reportActions(onCall:boolean,status:string){return {ask:onCall&&status==='queued',markRead:!onCall&&status==='queued'}}
/** Redial only after an abnormal close (1006: network or server crash); the server's deliberate closes (stop, "bye", shutdown) are 1005 and Hang up never redials. */
export function redials(e:{code:number},hungUp:boolean){return !hungUp&&e.code===1006}
/** Reconnect delay in ms (1s doubling, capped at 15s) or undefined once `max` attempts are spent; pass Infinity to never give up. */
export function backoff(attempt:number,max=6):number|undefined{return attempt<max?Math.min(15000,1000*2**attempt):undefined}
/** Keyboard on a call: Space toggles the mic (push-to-talk style) unless typing, Escape means Hold on; nothing fires with a dialog open. */
export function keyAction(s:{key:string;typing:boolean;dialog:boolean;onCall:boolean}):'ptt'|'interrupt'|undefined{if(s.dialog)return;if(s.key==='Escape')return s.onCall?'interrupt':undefined;if(s.key===' ')return s.onCall&&!s.typing?'ptt':undefined}
