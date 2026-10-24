import {describe,expect,it} from 'vitest'
import {callControls} from '../apps/web/src/agency/call'
const c=(o:Partial<Parameters<typeof callControls>[0]>={})=>callControls({socket:false,ringing:false,mic:'muted',...o})
describe('callControls',()=>{
 it('offers connect when idle and answer when ringing',()=>{expect(c().connect).toBe('agency.connect');expect(c().onCall).toBe(false);expect(c({ringing:true}).connect).toBe('agency.answer_call')})
 it('offers hang up and hides board actions while connected, ringing or not',()=>{for(const ringing of [false,true]){const x=c({socket:true,ringing});expect(x.connect).toBe('agency.hang_up');expect(x.onCall).toBe(true)}})
 it('labels mute for a live mic',()=>{const x=c({mic:'live'});expect(x.mic).toBe('agency.mute');expect(x.idle).toBe('agency.ready');expect(x.typeOpen).toBe(false)})
 it('labels unmute for a muted mic',()=>expect(c({mic:'muted'}).mic).toBe('agency.unmute'))
 it('falls back to typing when the mic is blocked',()=>{const x=c({mic:'blocked'});expect(x.mic).toBe('agency.mic_on');expect(x.idle).toBe('agency.mic_blocked');expect(x.typeOpen).toBe(true)})
})
