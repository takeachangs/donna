import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {secretaryInstructions,secretaryTools} from '../apps/server/src/agency/secretary';

const transport=vi.hoisted(()=>({sockets:[] as any[]}));
vi.mock('ws',async()=>{
 const {EventEmitter}=await import('node:events');
 class FakeSocket extends EventEmitter{
  static OPEN=1;readyState=1;sent:any[]=[];
  constructor(){super();transport.sockets.push(this);queueMicrotask(()=>{this.emit('open');this.receive({type:'session.updated'})})}
  send(text:string){this.sent.push(JSON.parse(text))}
  receive(event:unknown){this.emit('message',Buffer.from(JSON.stringify(event)))}
  close(){this.readyState=3;this.emit('close')}
 }
 return {WebSocket:FakeSocket};
});
import {HiggsColleague} from '../apps/server/src/agency/higgs';
const roots:string[]=[];
afterEach(()=>{vi.unstubAllEnvs();transport.sockets=[];for(const dir of roots.splice(0)){if(!dir.startsWith(join(tmpdir(),'agency-voice-')))throw Error('Unexpected path');rmSync(dir,{recursive:true,force:true})}});

it('configures only the dynamic secretary and supplies current project memory',async()=>{
 vi.stubEnv('BOSON_API_KEY','offline-fixture');
 const dir=mkdtempSync(join(tmpdir(),'agency-voice-'));roots.push(dir);
 const voice=new HiggsColleague('mara',()=> 'fixture-room',dir,()=>{},()=>({committed:true}),()=>{},()=>{},{instructions:()=>secretaryInstructions,context:()=>({goal:'Prepare launch',checkpoint:'One clear draft'}),tools:secretaryTools,voice:'eleanor'});
 await voice.connect();const socket=transport.sockets[0],session=socket.sent[0].session;
 expect(session.instructions).toBe(secretaryInstructions);
 expect(session.tools.map((t:any)=>t.name)).toContain('delegate_work');
 expect(session.tools.map((t:any)=>t.name)).not.toContain('complete_task');
 await voice.ask('Make the plan smaller');
 const request=socket.sent.find((e:any)=>e.type==='conversation.item.create');
 expect(request.item.content[0].text).toContain('One clear draft');
 expect(request.item.content[0].text).toContain('Make the plan smaller');
 socket.receive({type:'conversation.item.created',item:{id:request.item.id}});
 expect(socket.sent.at(-1).type).toBe('response.create');
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
