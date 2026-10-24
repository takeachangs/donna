import {expect,it} from 'vitest';
import {holdReason,openQuestion,type Floor} from '../apps/server/src/agency/briefings';
const base:Floor={now:100000,heldSince:100000,voiceBusy:false,userSpeaking:false,playing:false,userAt:0,voiceAt:0,question:false};
const ago=(f:Partial<Floor>,heldMs=0)=>holdReason({...base,...f,heldSince:base.now-heldMs});
it('speaks when everything has been quiet for a long time',()=>{expect(ago({})).toBeUndefined();});
it('never cuts Donna off or talks over the user, even past the cap',()=>{
 expect(ago({voiceBusy:true})).toBe('Donna is mid-turn');expect(ago({voiceBusy:true},60000)).toBe('Donna is mid-turn');
 expect(ago({userSpeaking:true})).toBe('user is speaking');expect(ago({userSpeaking:true},60000)).toBe('user is speaking');
});
it('waits for 2.5 s of quiet after Donna spoke',()=>{
 expect(ago({voiceAt:base.now-2000})).toBe('waiting for quiet');expect(ago({voiceAt:base.now-2500})).toBeUndefined();
});
it('holds when the user spoke under 3 s ago, however long Donna has been quiet',()=>{
 expect(ago({userAt:base.now-2000,voiceAt:base.now-60000})).toBe('user spoke recently');expect(ago({userAt:base.now-3000,voiceAt:base.now-60000})).toBeUndefined();
});
it('holds for an open question for 6 s, then releases',()=>{
 expect(ago({question:true,voiceAt:base.now-5000})).toBe('Donna asked a question');expect(ago({question:true,voiceAt:base.now-6500})).toBeUndefined();
});
it('the 10 s cap releases soft holds but not hard ones',()=>{
 expect(ago({question:true,voiceAt:base.now-3000},10000)).toBeUndefined();
 expect(ago({playing:true})).toBe('Donna audio still playing');expect(ago({playing:true},9000)).toBe('Donna audio still playing');expect(ago({playing:true},10000)).toBeUndefined();
});
it.each([['How can I help you today?',false],['Anything else?',false],["What's next?",false],['Would you like anything else?',false],['Should I use blue or green?',true],['Do you want the dark theme?',true],['Which file first?',true],['Tea or coffee?',true],['Done. Should I ship it?',true],['Done.',false]])('openQuestion(%s)=%s',(s,want)=>{expect(openQuestion(s)).toBe(want);});
