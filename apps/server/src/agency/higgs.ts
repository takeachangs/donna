import {WebSocket} from 'ws';
import {randomUUID} from 'node:crypto';
import {appendFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {log} from './log.js';

const say=log('voice');
// e2e hooks for scripts/e2e-voice.mjs; off unless set, each fires once per process (UPSTREAM_ERROR_TWICE fails the first two responses, which forces a rotation). The doomed answer is hidden and its items deleted, so the retry sees the user turn last:
// a retry after a kept assistant item fails 400 "No user input", and response.cancel at response.created makes Higgs drop the response with no response.done.
const hook={fail:process.env.AGENCY_TEST_UPSTREAM_ERROR_TWICE?2:process.env.AGENCY_TEST_UPSTREAM_ERROR_ONCE?1:0,doomed:'',idleMs:Number(process.env.AGENCY_TEST_IDLE_CLOSE_MS)||0};
type UserInput={itemId:string;source:'text'|'voice';text:string};
export type Job={id:string;mode:'conversation';started:number;cancelled:boolean;rounds:number;input?:UserInput;failedCalls?:Set<string>;failed?:boolean;retried?:boolean;rotated?:boolean};
export type VoiceState='connecting'|'ready'|'reconnecting'|'closed';
export const transient=(err:any)=>/upstream_error|server_error/.test(`${err?.code} ${err?.type}`);
export type VoiceOptions={instructions:()=>string;context:()=>unknown;tools:unknown[];voice:string};
type CallRow={id:string;roomId:string;agentId:string;voice:string;jobId:string;mode:string;responseId:string;startedAt:string;input?:UserInput;firstAudioMs?:number;completeMs?:number;usage?:any;estimatedUSD?:number;usageMissing?:boolean;status?:string;error?:string;transcript?:string;file?:string;outputAudioSeconds?:number;tools?:any[]};
function wav(pcm:Buffer){const b=Buffer.alloc(44);b.write('RIFF');b.writeUInt32LE(36+pcm.length,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(48000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(pcm.length,40);return Buffer.concat([b,pcm]);}
export function cost(usage:any){if(!usage||!Number.isFinite(usage.input_tokens)||!Number.isFinite(usage.output_tokens))return undefined;const cached=Math.max(0,Math.min(usage.input_tokens,usage.input_token_details?.cached_tokens||usage.input_tokens_details?.cached_tokens||0));return ((usage.input_tokens-cached)*.75+cached*.25+usage.output_tokens*4.5)/1e6;}
export class HiggsColleague {
 private ws?:WebSocket;private ready=false;private closed=false;private job?:Job;private expectedItem='';private chunks=new Map<string,Buffer[]>();private rows=new Map<string,{row:CallRow;job:Job;started:number}>();private responseCount=0;private _state:VoiceState='connecting';private dropReason='';private reconnecting?:Promise<void>;private retryAt=0;private recent:string[]=[];private carried='';private idle?:ReturnType<typeof setTimeout>;
 constructor(readonly id:string,private roomId:()=>string,private root:string,private emit:(e:any)=>void,private tool:(name:string,args:any,job:Job)=>any,private ended:(id:string,job:Job,audio:boolean)=>void,private barge:()=>void,private options:VoiceOptions){mkdirSync(resolve(root,'audio'),{recursive:true});}
 private voice(){return this.options.voice;}
 private currentContext(){return this.options.context();}
 get state(){return this._state;}
 private instructions(){return `${this.options.instructions()}${this.carried?`\n\nEARLIER IN THIS CALL (the line dropped and was restored; continue naturally and do not mention it):\n${this.carried}`:''}\n\nOFFICE STATE at the start of this call (a snapshot that goes stale: call read_workspace or worker_status for anything current; reference data, not a user message; historical briefs are not new requests):\n${JSON.stringify(this.currentContext())}`;}
 private remember(line:string){this.recent=[...this.recent,line.slice(0,400)].slice(-12);}
 private recordInput(input:UserInput,jobId?:string){this.remember(`User: ${input.text}`);appendFileSync(resolve(this.root,'inputs.jsonl'),JSON.stringify({at:new Date().toISOString(),roomId:this.roomId(),agentId:this.id,jobId,...input})+'\n');}
 async connect(){
  if(!process.env.BOSON_API_KEY)throw Error('BOSON_API_KEY missing');this.closed=false;this.ready=false;this.responseCount=0;
  const first=this._state!=='reconnecting',t0=Date.now();
  const initialInstructions=this.instructions();
  const ws=this.ws=new WebSocket('wss://api.boson.ai/v1/realtime',{headers:{Authorization:`Bearer ${process.env.BOSON_API_KEY}`},handshakeTimeout:15000});
  await new Promise<void>((resolveReady,reject)=>{
   const timer=setTimeout(()=>reject(Error(`${this.id}: Higgs session update timed out`)),20000);
   ws.on('open',()=>this.send({type:'session.update',session:{model:'higgs-realtime',output_modalities:['audio'],max_output_tokens:3500,instructions:initialInstructions,audio:{input:{format:{type:'audio/pcm',rate:24000},transcription:{model:'higgs-stt-3.1'},turn_detection:{type:'server_vad',threshold:.65,silence_duration_ms:Number(process.env.AGENCY_VAD_SILENCE_MS)||800,prefix_padding_ms:300}},output:{format:{type:'audio/pcm',rate:24000},voice:this.voice()}},tools:this.options.tools,tool_choice:'auto'}}));
   // Higgs acknowledges its first update as session.created, later ones as
   // session.updated. Verify the echoed instructions, not just the event name.
   ws.on('message',raw=>{try{const e=JSON.parse(raw.toString());if((e.type==='session.updated'||e.type==='session.created')&&e.session?.instructions===initialInstructions&&!this.ready&&!this.closed){this.ready=true;this._state='ready';clearTimeout(timer);resolveReady();if(first){const v=e.session?.audio?.output?.voice||this.voice();say(`session ready (voice ${v}) in ${Date.now()-t0} ms`);this.emit({type:'colleague_ready',agentId:this.id,voice:v});}}if(e.type==='error'&&!this.ready){clearTimeout(timer);reject(Error(String(e.error?.message||'Higgs rejected configuration')));return;}this.receive(e);}catch(err){this.emit({type:'error',agentId:this.id,message:String(err)});}});
   ws.once('error',err=>{clearTimeout(timer);reject(err);});
   ws.on('error',err=>this.emit({type:'error',agentId:this.id,message:String(err.message)}));
   ws.on('close',code=>{if(ws!==this.ws)return;clearTimeout(timer);for(const [id] of this.rows)this.finish(id,'DISCONNECTED');if(!this.ready)reject(Error(`${this.id}: disconnected before ready`));
    if(!this.closed&&this.ready){
     this.ready=false;this._state='reconnecting';this.expectedItem='';this.carried=this.recent.join('\n');
     const job=this.job;if(job){job.cancelled=true;this.job=undefined;this.emit({type:'turn_done',agentId:this.id,jobId:job.id,responseId:'dropped-'+randomUUID(),mode:job.mode,cancelled:true,hasAudio:false});this.ended(this.id,job,false);}
     const reason=this.dropReason||`closed by Higgs (code ${code})`;this.dropReason='';say(`${reason}; reconnecting on the next user action`);this.emit({type:'voice_state',agentId:this.id,state:'reconnecting',reason});
    }});
  });
 }
 // Higgs has no session resume: a new socket is a new session, so this opens one and instructions() carries the recent lines over.
 ensureConnected():Promise<void>{
  if(this._state!=='reconnecting')return Promise.resolve();
  const t0=Date.now();
  return this.reconnecting??=this.connect().then(()=>{say(`reconnected in ${Date.now()-t0} ms`);this.emit({type:'voice_state',agentId:this.id,state:'ready'});},err=>{this.retryAt=Date.now()+3000;const dead=this.ws;this.ws=undefined;dead?.close();say(`reconnect failed: ${err?.message||err}`);throw err;}).finally(()=>{this.reconnecting=undefined;});
 }
 get busy(){return !!this.job;}
 get mode(){return this.job?.mode;}
 private send(e:any){if(this.ws?.readyState===WebSocket.OPEN)this.ws.send(JSON.stringify(e));}
 private createResponse(){this.send({type:'response.create'});}
 /** Instructions and office context go out at connect; only an explicit project switch re-sends them. */
 refresh(){this.send({type:'session.update',session:{instructions:this.instructions()}});}
 async ask(text:string,replay=false){
  await this.ensureConnected();
  if(!this.ready)throw Error(`${this.id} is not connected`);
  if(this.job)await this.cancel();
  const mode='conversation' as const;
  const job:Job=this.job={id:randomUUID(),mode,started:performance.now(),cancelled:false,rounds:0,...(replay&&{rotated:true})};
  this.expectedItem='request_'+randomUUID().replaceAll('-','');
  job.input={itemId:this.expectedItem,source:'text',text};this.recordInput(job.input,job.id);
  this.emit({type:'thinking',agentId:this.id,jobId:job.id,mode});
  this.send({type:'conversation.item.create',item:{id:this.expectedItem,type:'message',role:'user',content:[{type:'input_text',text}]}});
  return job;
 }
 audio(audio:string){
  // ponytail: frames during the ~1 s reconnect are dropped; the mic streams silence continuously so the reconnect usually finishes before the user speaks. Buffer frames if that ever bites.
  if(this._state==='reconnecting'){if(Date.now()>=this.retryAt)void this.ensureConnected().catch(err=>this.emit({type:'error',agentId:this.id,message:String(err)}));return;}
  if(!this.ready)return;this.send({type:'input_audio_buffer.append',audio});}
 clearInput(){this.send({type:'input_audio_buffer.clear'});}
 // response.cancel only once audio is playing: at response.created Higgs drops the response without a response.done and wedges the session. Otherwise the job is just muted and we wait, bounded, for it to finish.
 async cancel(){const previous=this.job;if(previous){previous.cancelled=true;if([...this.rows.values()].some(r=>r.job===previous&&r.row.firstAudioMs!==undefined))this.send({type:'response.cancel'});this.expectedItem='';const start=performance.now();while([...this.rows.values()].some(r=>r.job===previous)&&performance.now()-start<2500)await new Promise(r=>setTimeout(r,20));if(this.job===previous)this.job=undefined;}}
 private armIdle(){if(!hook.idleMs)return;clearTimeout(this.idle);this.idle=setTimeout(()=>{if(!hook.idleMs||this.closed)return;if(this.job)return this.armIdle();hook.idleMs=0;this.dropReason='idle timeout (AGENCY_TEST_IDLE_CLOSE_MS)';say(this.dropReason);this.ws?.close();},hook.idleMs);this.idle.unref();}
 private receive(e:any){
  if(hook.fail){if(e.type==='response.created'&&!hook.doomed)hook.doomed=e.response.id;else if(e.response_id&&e.response_id===hook.doomed)return;else if(e.type==='response.done'&&e.response?.id===hook.doomed){hook.fail--;hook.doomed='';say('injecting upstream_error (AGENCY_TEST_UPSTREAM_ERROR_*)');for(const it of e.response.output||[])this.send({type:'conversation.item.delete',item_id:it.id});e={...e,response:{...e.response,status:'failed',output:[],status_details:{error:{type:'server_error',code:'upstream_error',message:'injected by AGENCY_TEST_UPSTREAM_ERROR_ONCE'}}}};}}
  if(e.type==='response.done'||e.type==='input_audio_buffer.speech_started')this.armIdle();
  if((e.type==='conversation.item.added'||e.type==='conversation.item.created')&&e.item?.id===this.expectedItem){this.expectedItem='';if(!this.job?.cancelled)this.createResponse();return;}
  if(e.type==='session.idle_timeout'||e.type==='session.max_duration_reached'){this.dropReason=e.type==='session.idle_timeout'?'idle timeout, no user speech for 300 s':'duration cap reached';say(`${this.dropReason}; Higgs will close the session`);return;}
  if(e.type==='error'){
   if(/cancel.*not.*active|No active response|buffer.*empty/i.test(`${e.error?.code} ${e.error?.message}`))return;
   say(`error ${e.error?.code}: ${e.error?.message}`);
   if(transient(e.error))return; // response.done decides: retry once, then rotate the session, then apologise
   if(/No user input/i.test(String(e.error?.message))&&this.job&&this.rotate(this.job,'a "No user input" error'))return;
   const job=this.job;this.job=undefined;this.emit({type:'error',agentId:this.id,message:String(e.error?.message||e.error?.code)});if(job)this.ended(this.id,job,false);return;
  }
  if(e.type==='input_audio_buffer.speech_started'){
   if(this.job)this.job.cancelled=true;
   this.expectedItem='';this.barge();this.emit({type:'speech_started',agentId:this.id});
  }
  if(e.type==='input_audio_buffer.speech_stopped'){
   this.job={id:randomUUID(),mode:'conversation',started:performance.now(),cancelled:false,rounds:0};this.emit({type:'thinking',agentId:this.id,jobId:this.job.id,mode:'conversation'});
  }
  if(e.type==='conversation.item.input_audio_transcription.completed'){this.recordInput({itemId:e.item_id,source:'voice',text:e.transcript});this.emit({type:'user_transcript',agentId:this.id,text:e.transcript});}
  if(e.type==='response.created'){
   ++this.responseCount;
   const job=this.job||{id:randomUUID(),mode:'conversation' as const,started:performance.now(),cancelled:false,rounds:0};this.job=job;
   const row:CallRow={id:randomUUID(),roomId:this.roomId(),agentId:this.id,voice:this.voice(),jobId:job.id,mode:job.mode,responseId:e.response.id,startedAt:new Date().toISOString(),input:job.input};
   this.rows.set(e.response.id,{row,job,started:performance.now()});this.emit({type:'response_started',agentId:this.id,responseId:e.response.id,jobId:job.id});
  }
  const record=this.rows.get(e.response_id),row=record?.row;
  if(e.type==='response.output_audio.delta'||e.type==='response.audio.delta'){
   const b=Buffer.from(e.delta,'base64');if(b.length<2||b.length%2)return;this.chunks.set(e.response_id,[...(this.chunks.get(e.response_id)||[]),b]);if(row)row.firstAudioMs??=performance.now()-record!.job.started;
   if(record&&!record.job.cancelled)this.emit({type:'audio',agentId:this.id,audio:e.delta,itemId:e.item_id,responseId:e.response_id,jobId:record?.job.id});
  }
  if(e.type==='response.output_audio_transcript.delta'||e.type==='response.audio_transcript.delta'){if(record&&!record.job.cancelled)this.emit({type:'speech_text',agentId:this.id,delta:e.delta,responseId:e.response_id});}
  if(e.type==='response.output_audio_transcript.done'||e.type==='response.audio_transcript.done'){if(row)row.transcript=e.transcript;if(e.transcript)this.remember(`Donna: ${e.transcript}`);}
  if(e.type==='response.done'){
   const r=this.rows.get(e.response.id),fail=e.response.status==='failed'&&transient(e.response.status_details?.error),job=r?.job??(fail?this.job:undefined);if(!job)return;
   if(fail&&!job.cancelled){
    if(r){r.row.usage=e.response.usage;r.row.error=String(e.response.status_details.error.message||'upstream_error');this.finish(e.response.id,'failed');}
    // a bare response.create is the retry for typed, voice and tool-result rounds: the input items already live on the server
    if(!job.retried){job.retried=true;say('upstream_error; retrying the turn once in 500 ms');setTimeout(()=>{if(this.job===job&&!job.cancelled)this.createResponse();},500);return;}
    if(this.rotate(job,'repeated upstream_error'))return;
    say('upstream_error again; giving up on this turn');if(this.job===job)this.job=undefined;this.sorry(job);return;
   }
   if(!r)return;
   r.row.usage=e.response.usage;r.row.tools=[];
   if(e.response.status==='failed'){job.failed=true;r.row.error=String(e.response.status_details?.error?.message||e.response.error?.message||'Higgs could not complete the request. No new work was started by this response.');if(!job.cancelled)this.emit({type:'error',agentId:this.id,message:r.row.error});}
   const calls=(job.failed?[]:e.response.output||[]).filter((c:any)=>c.type==='function_call');
   let repeatedFailure=false;
   for(const c of calls){
    let result:any,signature=`${c.name}:${c.arguments}`;
    try{
     if(job.cancelled)throw Error('CANCELLED: this generation was interrupted; do not apply its tools.');
     const args=JSON.parse(c.arguments);signature=`${c.name}:${JSON.stringify(args)}`;
     if(repeatedFailure||job.failedCalls?.has(signature)){repeatedFailure=true;throw Error('Repeated failed tool call stopped. No change was applied by this call.');}
     result=this.tool(c.name,args,job);
    }catch(err){result={committed:false,error:String(err),state:this.currentContext()};}
    if(result?.error&&!result.committed)(job.failedCalls??=new Set()).add(signature);
    r.row.tools.push({name:c.name,arguments:c.arguments,result});this.send({type:'conversation.item.create',item:{type:'function_call_output',call_id:c.call_id,output:JSON.stringify(result)}});
   }
   const hasAudio=!!this.chunks.get(e.response.id)?.length;
   if(repeatedFailure||(!job.cancelled&&calls.length&&job.rounds>=4))job.failed=true;
   this.finish(e.response.id,job.cancelled?'INTERRUPTED':e.response.status||'unknown');
   if(!job.cancelled&&!repeatedFailure&&calls.length&&++job.rounds<5)this.createResponse();
   else{if(this.job===job)this.job=undefined;this.emit({type:'turn_done',agentId:this.id,jobId:job.id,responseId:e.response.id,mode:job.mode,cancelled:job.cancelled,hasAudio});this.ended(this.id,job,hasAudio);if(!job.cancelled&&calls.length)this.emit({type:'error',agentId:this.id,message:repeatedFailure?'Donna stopped a repeated tool error. The latest action was not applied; please check the task board.':'Donna reached the tool-step limit. Check the task board for any actions already applied.'});
    if(this.responseCount>=100){this.dropReason='rotated after 100 responses';this.ws?.close();}}
  }
 }
 private sorry(job:Job){const responseId='apology-'+randomUUID();this.emit({type:'speech_text',agentId:this.id,delta:'Sorry, say that again?',responseId});this.emit({type:'notice',agentId:this.id,level:'warn',message:'Donna missed that; please say it again.'});this.emit({type:'turn_done',agentId:this.id,jobId:job.id,responseId,mode:job.mode,cancelled:false,hasAudio:false});this.ended(this.id,job,false);}
 /** Safety net for a wedged session: drop it, reconnect through the lazy path and replay the user's last input once as a text item (not duplicated in the carried lines). False when there is nothing to replay or the turn already rotated. */
 private rotate(job:Job,why:string){
  const i=this.recent.map(l=>l.startsWith('User: ')).lastIndexOf(true),text=job.input?.text??(i>=0?this.recent[i].slice(6):'');
  if(job.rotated||this.closed||!this.ready||!text)return false;
  if(i>=0)this.recent.splice(i,1);
  this.dropReason=`rotated session after ${why}`;say(this.dropReason);this.ws?.close();
  void(async()=>{for(let n=0;n<100&&this._state!=='reconnecting';n++)await new Promise(r=>setTimeout(r,20));try{await this.ask(text,true);}catch{this.sorry(job);}})();
  return true;
 }
 private finish(id:string,status:string){
  const r=this.rows.get(id);if(!r)return;const pcm=Buffer.concat(this.chunks.get(id)||[]);const row=r.row;row.status=status;row.completeMs=performance.now()-r.started;row.estimatedUSD=cost(row.usage);row.usageMissing=row.estimatedUSD===undefined;
  if(pcm.length){row.file=`audio/${row.id}.wav`;row.outputAudioSeconds=pcm.length/48000;writeFileSync(resolve(this.root,row.file),wav(pcm));}
  appendFileSync(resolve(this.root,'calls.jsonl'),JSON.stringify(row)+'\n');this.rows.delete(id);this.chunks.delete(id);this.emit({type:'usage',row});
 }
 close(){clearTimeout(this.idle);this.closed=true;this._state='closed';if(this.job)this.job.cancelled=true;for(const [id] of this.rows)this.finish(id,'INTERRUPTED');this.ws?.close();}
}
