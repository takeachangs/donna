import {describe,expect,it} from 'vitest'
import {callControls,drawerSections,reportActions,redials,backoff,keyAction} from '../apps/web/src/agency/call'
const c=(o:Partial<Parameters<typeof callControls>[0]>={})=>callControls({socket:false,ringing:false,mic:'muted',...o})
describe('callControls',()=>{
 it('offers connect when idle and answer when ringing',()=>{expect(c().connect).toBe('agency.connect');expect(c().onCall).toBe(false);expect(c({ringing:true}).connect).toBe('agency.answer_call')})
 it('offers hang up and hides board actions while connected, ringing or not',()=>{for(const ringing of [false,true]){const x=c({socket:true,ringing});expect(x.connect).toBe('agency.hang_up');expect(x.onCall).toBe(true)}})
 it('labels mute for a live mic',()=>{const x=c({mic:'live'});expect(x.mic).toBe('agency.mute');expect(x.idle).toBe('agency.ready');expect(x.typeOpen).toBe(false)})
 it('labels unmute for a muted mic',()=>expect(c({mic:'muted'}).mic).toBe('agency.unmute'))
 it('falls back to typing when the mic is blocked',()=>{const x=c({mic:'blocked'});expect(x.mic).toBe('agency.mic_on');expect(x.idle).toBe('agency.mic_blocked');expect(x.typeOpen).toBe(true)})
 it('picks the pill for every combination',()=>{
  for(const socket of [false,true])for(const ringing of [false,true])for(const reconnecting of [false,true]){
   const expected=reconnecting?'reconnecting':socket?'on_call':ringing?'ringing':'available',x=c({socket,ringing,reconnecting})
   expect(x.pill).toBe(expected);expect(x.pillLabel).toBe(`agency.pill_${expected}`)
  }
 })
 it('shows available, ringing, on call and reconnecting',()=>{expect(c().pill).toBe('available');expect(c({ringing:true}).pill).toBe('ringing');expect(c({socket:true}).pill).toBe('on_call');expect(c({socket:true,ringing:true}).pill).toBe('on_call')})
 it('reconnecting wins, on a call (redial, voice down) or off one (offline), and a redial still offers hang up',()=>{expect(c({reconnecting:true}).pill).toBe('reconnecting');expect(c({socket:true,reconnecting:true}).pill).toBe('reconnecting');expect(c({socket:true,reconnecting:true}).connect).toBe('agency.hang_up')})
})
describe('drawerSections',()=>{
 const d=(o:Partial<Parameters<typeof drawerSections>[0]>={})=>drawerSections({onCall:false,view:'command',pane:'reports',questions:0,...o})
 it('shows only the report list by default, with no back button',()=>expect(d()).toEqual({questions:false,reports:true,report:false,room:false,engine:false,back:false}))
 it('shows questions only off a call and only when there are some',()=>{expect(d({questions:2}).questions).toBe(true);expect(d({questions:2,onCall:true}).questions).toBe(false);expect(d({questions:2,onCall:true}).reports).toBe(true);expect(d({questions:0}).questions).toBe(false)})
 it('opens a report with back',()=>expect(d({pane:'report',questions:2})).toEqual({questions:false,reports:false,report:true,room:false,engine:false,back:true}))
 it('opens the engine pane with back, ahead of everything else',()=>{for(const view of ['command','secretary','project'] as const)expect(d({pane:'engine',view})).toEqual({questions:false,reports:false,report:false,room:false,engine:true,back:true})})
 it('shows the selected room with back, and no questions',()=>expect(d({view:'project',questions:3})).toEqual({questions:false,reports:false,report:false,room:true,engine:false,back:true}))
 it('lets a report win over the room',()=>{const x=d({view:'project',pane:'report'});expect(x.report).toBe(true);expect(x.room).toBe(false)})
})
describe('reportActions',()=>{
 it('lets Donna read unread reports on a call, and marks read off a call',()=>{expect(reportActions(true,'queued')).toEqual({ask:true,markRead:false});expect(reportActions(false,'queued')).toEqual({ask:false,markRead:true})})
 it('offers neither for a report already read',()=>{for(const onCall of [false,true])expect(reportActions(onCall,'presented')).toEqual({ask:false,markRead:false})})
})
describe('redials',()=>{
 it('redials after an abnormal close',()=>expect(redials({code:1006},false)).toBe(true))
 it('does not redial after a clean close',()=>expect(redials({code:1005},false)).toBe(false))
 it('does not redial after hang up',()=>expect(redials({code:1006},true)).toBe(false))
 it('does not redial after a policy close or a normal close',()=>{for(const code of [1000,1001,1008])expect(redials({code},false)).toBe(false)})
})
describe('backoff',()=>{
 it('doubles from 1 s, caps at 15 s, then gives up',()=>expect([0,1,2,3,4,5,6].map(n=>backoff(n))).toEqual([1000,2000,4000,8000,15000,15000,undefined]))
 it('never gives up with Infinity',()=>{for(const n of [6,20,1000])expect(backoff(n,Infinity)).toBe(15000)})
})
describe('keyAction',()=>{
 const k=(o:Partial<Parameters<typeof keyAction>[0]>={})=>keyAction({key:' ',typing:false,dialog:false,onCall:true,...o})
 it('toggles the mic with Space on a call',()=>expect(k()).toBe('ptt'))
 it('leaves Space alone while typing',()=>expect(k({typing:true})).toBeUndefined())
 it('leaves Space alone off a call',()=>expect(k({onCall:false})).toBeUndefined())
 it('holds on with Escape on a call, even while typing',()=>{expect(k({key:'Escape'})).toBe('interrupt');expect(k({key:'Escape',typing:true})).toBe('interrupt')})
 it('ignores Escape off a call',()=>expect(k({key:'Escape',onCall:false})).toBeUndefined())
 it('ignores every key while a dialog is open',()=>{expect(k({dialog:true})).toBeUndefined();expect(k({key:'Escape',dialog:true})).toBeUndefined()})
 it('ignores other keys',()=>expect(k({key:'a'})).toBeUndefined())
})
