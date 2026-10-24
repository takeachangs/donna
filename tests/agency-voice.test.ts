import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {secretaryInstructions,secretaryTools,resolveProjectTarget,hangsUp,pickUpNotice} from '../apps/server/src/agency/secretary';

const transport=vi.hoisted(()=>({sockets:[] as any[],autoReady:true}));
vi.mock('ws',async()=>{
 const {EventEmitter}=await import('node:events');
 class FakeSocket extends EventEmitter{
  static OPEN=1;readyState=1;sent:any[]=[];
  constructor(){super();transport.sockets.push(this);queueMicrotask(()=>{this.emit('open');if(transport.autoReady)this.receive({type:'session.created',session:this.sent[0].session});else this.receive({type:'session.created',session:{instructions:'Provider default'}})})}
  send(text:string){this.sent.push(JSON.parse(text))}
  receive(event:unknown){this.emit('message',Buffer.from(JSON.stringify(event)))}
  close(){this.readyState=3;this.emit('close')}
 }
 return {WebSocket:FakeSocket};
});
import {HiggsColleague} from '../apps/server/src/agency/higgs';
const roots:string[]=[];
afterEach(()=>{vi.unstubAllEnvs();transport.sockets=[];transport.autoReady=true;for(const dir of roots.splice(0)){if(!dir.startsWith(join(tmpdir(),'agency-voice-')))throw Error('Unexpected path');rmSync(dir,{recursive:true,force:true})}});

it('configures only the dynamic secretary and supplies current project memory',async()=>{
 vi.stubEnv('BOSON_API_KEY','offline-fixture');
 const dir=mkdtempSync(join(tmpdir(),'agency-voice-'));roots.push(dir);
 const voice=new HiggsColleague('mara',()=> 'fixture-room',dir,()=>{},()=>({committed:true}),()=>{},()=>{},{instructions:()=>secretaryInstructions,context:()=>({goal:'Prepare launch',checkpoint:'One clear draft'}),tools:secretaryTools,voice:'eleanor'});
 await voice.connect();const socket=transport.sockets[0],session=socket.sent[0].session;
 expect(session.audio.input.turn_detection).toEqual({type:'server_vad',threshold:.65,silence_duration_ms:800,prefix_padding_ms:300});
 // without it Higgs sends no input transcripts, so a spoken "bye" never reaches hangsUp (found by npm run e2e:voice)
 expect(session.audio.input.transcription).toEqual({model:'higgs-stt-3.1'});
 expect(session.instructions).toContain(secretaryInstructions);
 expect(session.instructions).toContain('One clear draft');
 expect(session.tools.map((t:any)=>t.name)).toContain('delegate_work');
 expect(session.tools.map((t:any)=>t.name)).not.toContain('complete_task');
 await voice.ask('Make the plan smaller');
 const request=socket.sent.find((e:any)=>e.type==='conversation.item.create');
 expect(request.item.content[0].text).toBe('Make the plan smaller');
 socket.receive({type:'conversation.item.created',item:{id:request.item.id}});
 expect(socket.sent.at(-1).type).toBe('response.create');
 voice.close();
});

it('lets AGENCY_VAD_SILENCE_MS override the turn silence and keeps the threshold',async()=>{
 vi.stubEnv('BOSON_API_KEY','offline-fixture');vi.stubEnv('AGENCY_VAD_SILENCE_MS','1000');
 const dir=mkdtempSync(join(tmpdir(),'agency-voice-'));roots.push(dir);
 const voice=new HiggsColleague('mara',()=> 'fixture-room',dir,()=>{},()=>({committed:true}),()=>{},()=>{},{instructions:()=>secretaryInstructions,context:()=>({goal:'Prepare launch',checkpoint:'One clear draft'}),tools:secretaryTools,voice:'eleanor'});
 await voice.connect();
 expect(transport.sockets[0].sent[0].session.audio.input.turn_detection).toMatchObject({threshold:.65,silence_duration_ms:1000});voice.close();
});

it('waits for the configured session rather than the initial default session',async()=>{
 vi.stubEnv('BOSON_API_KEY','offline-fixture');transport.autoReady=false;
 const dir=mkdtempSync(join(tmpdir(),'agency-voice-'));roots.push(dir);const events:any[]=[];
 const voice=new HiggsColleague('mara',()=> 'fixture-room',dir,e=>events.push(e),()=>({}),()=>{},()=>{},{instructions:()=>secretaryInstructions,context:()=>({}),tools:secretaryTools,voice:'eleanor'});
 let ready=false;const pending=voice.connect().then(()=>{ready=true});await Promise.resolve();
 expect(ready).toBe(false);expect(events.some(e=>e.type==='colleague_ready')).toBe(false);
 transport.sockets[0].receive({type:'session.updated',session:transport.sockets[0].sent[0].session});await pending;expect(ready).toBe(true);voice.close();
});

it('keeps follow-up text intact, refreshes state separately and links inputs to responses',async()=>{
 vi.stubEnv('BOSON_API_KEY','offline-fixture');
 const dir=mkdtempSync(join(tmpdir(),'agency-voice-'));roots.push(dir);let checkpoint='Draft';
 const voice=new HiggsColleague('mara',()=> 'fixture-room',dir,()=>{},()=>({}),()=>{},()=>{},{instructions:()=>secretaryInstructions,context:()=>({checkpoint}),tools:secretaryTools,voice:'eleanor'});
 await voice.connect();const socket=transport.sockets[0];
 for(const [i,text] of ['Write an opening.','The agency, not hardware.'].entries()){
  checkpoint=i?'Revise opening':'Draft';const job=await voice.ask(text);
  socket.receive({type:'conversation.item.created',item:{id:job.input!.itemId}});
  socket.receive({type:'response.created',response:{id:`reply-${i}`}});
  socket.receive({type:'response.done',response:{id:`reply-${i}`,status:'completed',output:[],usage:{input_tokens:12,output_tokens:2}}});
 }
 const messages=socket.sent.filter((e:any)=>e.type==='conversation.item.create');
 expect(messages.map((e:any)=>e.item.content[0].text)).toEqual(['Write an opening.','The agency, not hardware.']);
 expect(socket.sent.filter((e:any)=>e.type==='session.update').at(-1).session.instructions).toContain('Revise opening');
 const inputs=readFileSync(join(dir,'inputs.jsonl'),'utf8').trim().split('\n').map(s=>JSON.parse(s));
 const rows=readFileSync(join(dir,'calls.jsonl'),'utf8').trim().split('\n').map(s=>JSON.parse(s));
 expect(inputs).toHaveLength(2);expect(rows[1].input.text).toBe('The agency, not hardware.');expect(rows[1].jobId).toBe(inputs[1].jobId);
 const before=messages.length;socket.receive({type:'input_audio_buffer.speech_started'});
 expect(socket.sent.filter((e:any)=>e.type==='conversation.item.create')).toHaveLength(before);
 voice.close();
});

it('does not commit tool results from an interrupted voice response',async()=>{
 vi.stubEnv('BOSON_API_KEY','offline-fixture');
 const dir=mkdtempSync(join(tmpdir(),'agency-voice-'));roots.push(dir);const tool=vi.fn();
 const voice=new HiggsColleague('mara',()=> 'fixture-room',dir,()=>{},tool,()=>{},()=>{},{instructions:()=>secretaryInstructions,context:()=>({}),tools:secretaryTools,voice:'eleanor'});
 await voice.connect();const socket=transport.sockets[0];await voice.ask('Draft a brief');
 socket.receive({type:'response.created',response:{id:'old-response'}});
 socket.receive({type:'input_audio_buffer.speech_started'});
 socket.receive({type:'response.done',response:{id:'old-response',status:'completed',output:[{type:'function_call',call_id:'old-tool',name:'delegate_work',arguments:'{}'}]}});
 expect(tool).not.toHaveBeenCalled();
 const result=socket.sent.find((e:any)=>e.item?.type==='function_call_output');
 expect(JSON.parse(result.item.output).committed).toBe(false);voice.close();
});

it('surfaces failed provider responses without applying incomplete tools',async()=>{
 vi.stubEnv('BOSON_API_KEY','offline-fixture');
 const dir=mkdtempSync(join(tmpdir(),'agency-voice-'));roots.push(dir);const events:any[]=[],tool=vi.fn();
 const voice=new HiggsColleague('mara',()=> 'fixture-room',dir,e=>events.push(e),tool,()=>{},()=>{},{instructions:()=>secretaryInstructions,context:()=>({}),tools:secretaryTools,voice:'eleanor'});
 await voice.connect();const socket=transport.sockets[0];await voice.ask('Build the app');
 socket.receive({type:'response.created',response:{id:'failed-response'}});
 socket.receive({type:'response.done',response:{id:'failed-response',status:'failed',status_details:{error:{message:'Provider generation failed'}},output:[{type:'function_call',call_id:'incomplete',name:'delegate_work',arguments:'{}'}]}});
 expect(tool).not.toHaveBeenCalled();expect(events.some(e=>e.type==='error'&&e.message==='Provider generation failed')).toBe(true);expect(voice.busy).toBe(false);
 expect(JSON.parse(readFileSync(join(dir,'calls.jsonl'),'utf8')).error).toBe('Provider generation failed');voice.close();
});

it('resolves the selected project without guessing or silently replacing invalid targets',()=>{
 expect(resolveProjectTarget('read_workspace',{project_id:'selected'},'',[]).project_id).toBeUndefined();
 expect(resolveProjectTarget('delegate_work',{project_id:'selected'},'',[]).project_id).toBeUndefined();
 const selected='09410879-ca31-495f-8746-025f15b85d30',other='b151db6a-edf3-4b63-87db-b27e321eaf39',ids=[selected,other];
 expect(resolveProjectTarget('delegate_work',{project_id:'selected',checkpoint:'Save file'},selected,ids)).toEqual({project_id:selected,checkpoint:'Save file'});
 expect(resolveProjectTarget('read_workspace',{},selected,ids).project_id).toBe(selected);
 expect(resolveProjectTarget('delegate_work',{project_id:other},selected,ids).project_id).toBe(other);
 expect(()=>resolveProjectTarget('delegate_work',{project_id:'09410879-ca31-495f-87db-b27e321eaf39'},selected,ids)).toThrow('Unknown project target');
});

it('stops identical failed tool retries instead of silently burning all five rounds',async()=>{
 vi.stubEnv('BOSON_API_KEY','offline-fixture');
 const dir=mkdtempSync(join(tmpdir(),'agency-voice-'));roots.push(dir);const events:any[]=[],tool=vi.fn(()=>{throw Error('Unknown project')});
 const voice=new HiggsColleague('mara',()=> 'fixture-room',dir,e=>events.push(e),tool,()=>{},()=>{},{instructions:()=>secretaryInstructions,context:()=>({}),tools:secretaryTools,voice:'eleanor'});
 await voice.connect();const socket=transport.sockets[0];const job=await voice.ask('Save the file');
 socket.receive({type:'conversation.item.created',item:{id:job.input!.itemId}});
 for(const n of [1,2]){
  socket.receive({type:'response.created',response:{id:`retry-${n}`}});
  socket.receive({type:'response.done',response:{id:`retry-${n}`,status:'completed',output:[{type:'function_call',call_id:`call-${n}`,name:'delegate_work',arguments:'{"project_id":"invalid"}'}]}});
 }
 expect(tool).toHaveBeenCalledTimes(1);expect(socket.sent.filter((e:any)=>e.type==='response.create')).toHaveLength(2);
 expect(events.some(e=>e.type==='error'&&e.message.includes('repeated tool error'))).toBe(true);expect(voice.busy).toBe(false);voice.close();
});

it('opens with rule one and routes every tool by its own job',()=>{
 const rule=secretaryInstructions.indexOf('RULE ONE'),follow=secretaryInstructions.indexOf('FOLLOW THROUGH'),routing=secretaryInstructions.slice(secretaryInstructions.indexOf('WHICH TOOL'),follow);
 expect(rule).toBeGreaterThan(-1);expect(rule).toBeLessThan(follow);expect(secretaryInstructions).toContain('Reply to what the user just said');
 for(const t of secretaryTools){if(!['worker_status','message_worker'].includes(t.name))expect(routing).toContain(t.name);expect(t.description).not.toMatch(/\bNOT\b/);for(const o of secretaryTools)if(o!==t)expect(t.description).not.toContain(o.name);}
});

it.each([["bye",true],["Bye!",true],["Goodbye.",true],["good bye",true],["Bye-bye",true],["Okay, thanks, bye!",true],["Thanks Donna, talk later.",true],["talk soon",true],["Talk to you later",true],["Okay, I'll talk to you later.",true],["No, that's it, bye.",true],["See you",true],["Later!",false],["Later, thanks.",false],["gotta go",true],["Bye for now",true],["thanks, bye Donna",true],["make a page that says bye",false],["say goodbye to the old header",false],["yes",false],["no thanks",false],["how's it going?",false],["make a tiny page that says hi",false],["",false],["Byelorussian history",false]])('hangsUp(%j)=%s',(text,want)=>{expect(hangsUp(text)).toBe(want);});

it('picks up the phone with her name',()=>{expect(pickUpNotice('Donna')).toContain("Hey, it's Donna. What do you need?");});

it('instructs Donna as a phone call, placed after rule one and before tool routing',()=>{
 const i=secretaryInstructions,phone=i.indexOf('ON THE PHONE');
 for(const x of ['ON THE PHONE',"Hey, it's Donna.",'offer the short version',"I'll let you go",'The bakery page is done, Ellis and Miles finished it. Want the short version?','Never say ids, file paths','Reply to what the user just said'])expect(i).toContain(x);
 expect(phone).toBeGreaterThan(i.indexOf('RULE ONE'));expect(phone).toBeLessThan(i.indexOf('WHICH TOOL'));expect(i).not.toContain('2–3 natural spoken sentences');
});

const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const upstream={type:'error',error:{type:'server_error',code:'upstream_error',message:'The response failed because an upstream service call did not complete.'}};
const failTurn=(socket:any,id:string)=>{socket.receive({type:'response.created',response:{id}});socket.receive(upstream);socket.receive({type:'response.done',response:{id,status:'failed',status_details:{type:'failed',error:{code:'upstream_error',message:'The response failed because an upstream service call did not complete.'}},output:[],usage:null}});};
const startTurn=async(events:any[],tool:any=()=>({committed:true}))=>{
 vi.stubEnv('BOSON_API_KEY','offline-fixture');
 const dir=mkdtempSync(join(tmpdir(),'agency-voice-'));roots.push(dir);
 const voice=new HiggsColleague('mara',()=> 'fixture-room',dir,e=>events.push(e),tool,()=>{},()=>{},{instructions:()=>secretaryInstructions,context:()=>({checkpoint:'Draft'}),tools:secretaryTools,voice:'eleanor'});
 await voice.connect();const socket=transport.sockets[0];const job=await voice.ask('Hello');
 socket.receive({type:'conversation.item.created',item:{id:job.input!.itemId}});
 return {voice,socket,creates:()=>socket.sent.filter((e:any)=>e.type==='response.create').length};
};

it('retries a transient provider failure once without surfacing an error',async()=>{
 const events:any[]=[];const {voice,socket,creates}=await startTurn(events);
 expect(creates()).toBe(1);failTurn(socket,'r1');
 expect(events.some(e=>e.type==='error')).toBe(false);expect(voice.busy).toBe(true);
 await wait(520);expect(creates()).toBe(2);
 socket.receive({type:'response.created',response:{id:'r2'}});socket.receive({type:'response.done',response:{id:'r2',status:'completed',output:[],usage:{input_tokens:1,output_tokens:1}}});
 expect(events.some(e=>e.type==='turn_done')).toBe(true);expect(voice.busy).toBe(false);voice.close();
});

it('gives up after the second transient failure with a spoken apology and no error',async()=>{
 const events:any[]=[];const {voice,socket,creates}=await startTurn(events);
 failTurn(socket,'r1');await wait(520);expect(creates()).toBe(2);
 failTurn(socket,'r2');await wait(520);expect(creates()).toBe(2);
 expect(events.find(e=>e.type==='speech_text')?.delta).toBe('Sorry, say that again?');
 expect(events.some(e=>e.type==='notice')).toBe(true);expect(events.find(e=>e.type==='turn_done')).toMatchObject({cancelled:false,hasAudio:false});
 expect(events.some(e=>e.type==='error')).toBe(false);expect(voice.busy).toBe(false);voice.close();
});

it('retries a failed tool-result round without calling the tool again',async()=>{
 const events:any[]=[],tool=vi.fn(()=>({committed:true}));const {voice,socket,creates}=await startTurn(events,tool);
 socket.receive({type:'response.created',response:{id:'r1'}});
 socket.receive({type:'response.done',response:{id:'r1',status:'completed',output:[{type:'function_call',call_id:'c1',name:'delegate_work',arguments:'{}'}],usage:null}});
 expect(tool).toHaveBeenCalledTimes(1);expect(socket.sent.some((e:any)=>e.item?.type==='function_call_output')).toBe(true);expect(creates()).toBe(2);
 failTurn(socket,'r2');await wait(520);
 expect(creates()).toBe(3);expect(tool).toHaveBeenCalledTimes(1);voice.close();
});

it('reconnects lazily after Higgs closes the session and carries the conversation over',async()=>{
 vi.stubEnv('BOSON_API_KEY','offline-fixture');
 const dir=mkdtempSync(join(tmpdir(),'agency-voice-'));roots.push(dir);const events:any[]=[];
 const voice=new HiggsColleague('mara',()=> 'fixture-room',dir,e=>events.push(e),()=>({}),()=>{},()=>{},{instructions:()=>secretaryInstructions,context:()=>({checkpoint:'Draft'}),tools:secretaryTools,voice:'eleanor'});
 await voice.connect();const socket=transport.sockets[0];const job=await voice.ask('Remember the word pineapple');
 socket.receive({type:'conversation.item.created',item:{id:job.input!.itemId}});
 socket.receive({type:'response.created',response:{id:'r1'}});
 socket.receive({type:'response.output_audio_transcript.done',response_id:'r1',transcript:'Noted.'});
 socket.receive({type:'response.done',response:{id:'r1',status:'completed',output:[],usage:null}});
 socket.receive({type:'session.idle_timeout',seconds_idle:300});socket.close();
 expect(voice.state).toBe('reconnecting');expect(events.some(e=>e.type==='voice_state'&&e.state==='reconnecting')).toBe(true);
 expect(events.some(e=>e.type==='colleague_disconnected'||e.type==='error')).toBe(false);expect(voice.busy).toBe(false);
 voice.audio('AAAA');expect(transport.sockets).toHaveLength(2);
 for(let i=0;i<50&&voice.state!=='ready';i++)await wait(10);
 expect(voice.state).toBe('ready');const next=transport.sockets[1],instructions=next.sent[0].session.instructions;
 expect(instructions).toContain('pineapple');expect(instructions).toContain('Noted.');expect(instructions).toContain('Draft');
 expect(events.some(e=>e.type==='voice_state'&&e.state==='ready')).toBe(true);
 await voice.ask('Again');expect(next.sent.some((e:any)=>e.type==='conversation.item.create')).toBe(true);
 voice.close();expect(voice.state).toBe('closed');voice.audio('AAAA');expect(transport.sockets).toHaveLength(2);
});

it('gives the voice worker_status and message_worker, and tells her when to use them',()=>{
 const t=(n:string)=>secretaryTools.find(x=>x.name===n) as any;
 expect(t('worker_status').parameters.required).toEqual(['worker']);
 expect(t('message_worker').parameters.required).toEqual(['worker','text']);
 expect(secretaryInstructions).toContain('worker_status');expect(secretaryInstructions).toContain('message_worker');
});
