import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,mkdirSync,createWriteStream,appendFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import WebSocket from 'ws';
import {FRAME_BYTES,frames,speech,seconds,phoneProblems,table} from './lib/e2e-audio.mjs';
// Paid: real Higgs + real Claude. Spoken end-to-end check of the voice office. Needs macOS `say`.
const USAGE='Usage: node scripts/e2e-voice.mjs [--port 3043] [--only a,b,c,d]   (a acoustic, b presenter, c ring while hung up, d the brain asks a question by voice)';
const root=fileURLToPath(new URL('..',import.meta.url)),args=process.argv.slice(2),opt=n=>args[args.indexOf(n)+1];
if(args.includes('--help')||args.includes('-h')){console.log(USAGE);process.exit(0)}
const port=Number(opt('--port'))||3043,only=(opt('--only')||'a,b,c,d').split(',').map(x=>x.trim().toLowerCase()),provider=process.env.AGENCY_DEFAULT_PROVIDER||'claude';
const die=m=>{console.error('E2E FAIL: '+m);process.exit(1)};
if(only.some(x=>!'abcd'.includes(x)||x.length!==1))die(USAGE);
if(!process.env.BOSON_API_KEY)die('BOSON_API_KEY is not set');
if(process.platform!=='darwin')die('needs macOS (say, afconvert)');
if(port===3003||port===5183)die(`port ${port} is reserved for the live office`);
const log=m=>console.log(m),sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=()=>performance.now(),sh=(t,n=60)=>t.length>n?t.slice(0,n)+'…':t;
const T0=Date.now(),stamp=new Date().toISOString().replace(/[:.]/g,'-'),outDir=join(root,'artifacts','e2e'),base=`http://127.0.0.1:${port}`;
const T={a1:'What is the capital of France? Just the city, please.',a2:['Okay, so I have a quick question about baking bread at home.','How long does a simple loaf of sourdough usually take,','from mixing the dough to taking it out of the oven?'],a3:'Can you count slowly from one to twenty for me?',a3b:'Wait, hold on a second.',a4:'Are you still there?',a5:'Hey, one second.',a5q1:'What is two plus two?',a5q2:'What colour is the sky on a clear day?',a5q3:'What is the largest planet in our solar system?',b1:'Hey Donna.',b2:'Build me a landing page with a contact form.',b3:"How's it going?",b4:'Hello.',b6:'Yes.',b7:'Okay, thanks. Bye.',d1:'Build a landing page for my company.',d3:'Acme.'};
mkdirSync(outDir,{recursive:true});
const clip={};for(const [k,v] of Object.entries(T))if(only.includes(k[0]))clip[k]=speech(v); // before the server: fail fast
const dir=mkdtempSync(join(tmpdir(),'chamber-e2e-')),evPath=join(outDir,stamp+'-events.jsonl'),logPath=join(outDir,stamp+'-server.log');
const rows=[],socks=new Set();let child,exited,done=false,dead='',usd=0,nResp=0,missing=0,poller;
async function cleanup(){
 clearInterval(poller);for(const w of socks)try{w.close()}catch{}
 if(child&&child.exitCode===null){child.kill();await Promise.race([exited,sleep(5000)]);if(child.exitCode===null)child.kill('SIGKILL')}
 if(resolve(dir).startsWith(resolve(tmpdir())+sep+'chamber-e2e-'))rmSync(dir,{recursive:true,force:true});
}
async function finish(why){
 if(done)return;done=true;
 if(why)rows.push({step:'harness',ok:false,note:why});
 const total=usd;rows.push({step:'Higgs cost ≤ $0.30',ok:total<=0.3,latency:`$${total.toFixed(3)}`,note:`${nResp} responses${missing?`, ${missing} without usage`:''}`});
 let sha='?';try{sha=execFileSync('git',['rev-parse','--short','HEAD'],{cwd:root}).toString().trim()}catch{}
 const t=table(rows);log('\n'+t);
 writeFileSync(join(outDir,stamp+'.md'),`# Voice e2e ${stamp}\n\ncommit ${sha}, engine ${provider}, port ${port}, ${Math.round((Date.now()-T0)/1000)} s, phases ${only.join(',')}\n\n${t}\nserver log: ${stamp}-server.log\nevents: ${stamp}-events.jsonl\n`);
 await cleanup();process.exit(rows.some(r=>!r.ok)?1:0);
}
for(const s of ['SIGINT','SIGTERM'])process.once(s,()=>finish('interrupted'));
setTimeout(()=>finish('global 15-minute cap hit'),15*60e3).unref();
async function step(name,fn){
 let r;if(dead)r={ok:false,note:dead};else try{r=await fn()}catch(e){r={ok:false,note:e.message}}
 rows.push({step:name,...r,ok:!!r.ok});
 log(`${r.ok?'PASS':'FAIL'}  ${name}  ${typeof r.latency==='number'?(r.latency/1000).toFixed(2)+' s':r.latency??''}  ${r.note??''}`);
}
const lastWs=a=>a.findLast(e=>e.type==='workspace')?.workspace,queued=w=>(w?.briefings||[]).filter(b=>b.status==='queued').map(b=>b.id);
const getWs=async()=>(await fetch(base+'/agency-api/workspace')).json();
// One WebSocket client: continuous mic pump, Audio.ts playback simulator, event log.
function session(L,startMsg){
 const seen=[],waiters=new Set(),Q=[],spans=[],jobEnd={},firstAudible={},audioMs={},cancelled=new Set(),open=new Set(),pend=new Map();
 let next=0,playing,run=false;
 const ws=new WebSocket(`ws://127.0.0.1:${port}/agency-ws`),send=m=>{if(ws.readyState===1)ws.send(JSON.stringify(m))};socks.add(ws);
 const push=e=>{e.at=now();seen.push(e);
  appendFileSync(evPath,JSON.stringify({...e,audio:e.audio?Buffer.from(e.audio,'base64').length:undefined,at:Math.round(e.at),s:L})+'\n');
  for(const w of [...waiters])w(e)};
 const waitFor=(match,ms,what,from=0)=>new Promise((res,rej)=>{
  const hit=seen.slice(from).find(match);if(hit)return res(hit);
  const w=e=>{if(match(e)){clearTimeout(t);waiters.delete(w);res(e)}},t=setTimeout(()=>{waiters.delete(w);rej(Error(`${L}: timed out after ${ms/1000} s waiting for ${what}`))},ms);
  waiters.add(w);
 });
 function stop(){ // Audio.ts stop(): flush local playback only; the server's VAD cancels the response (no interrupt, no truncate)
  const t=now();
  if(playing)playing.end=Math.min(playing.end,t);
  for(const id of open)cancelled.add(id);
  for(const x of pend.values())clearTimeout(x);
  open.clear();pend.clear();playing=undefined;next=t;
 }
 function play(e){
  if(cancelled.has(e.jobId))return;
  const dur=Buffer.from(e.audio,'base64').length/48,at=Math.max(now()+60,next);next=at+dur;
  if(playing?.itemId!==e.itemId){playing={itemId:e.itemId,jobId:e.jobId,responseId:e.responseId,start:at,end:next};spans.push(playing);firstAudible[e.jobId]??=at}
  else playing.end=next;
  jobEnd[e.jobId]=next;audioMs[e.jobId]=(audioMs[e.jobId]||0)+dur;open.add(e.jobId);
 }
 ws.on('message',raw=>{
  let e;try{e=JSON.parse(raw)}catch{return}
  if(e.type==='audio')play(e);
  else if(e.type==='speech_started')stop();
  else if(e.type==='interrupted')stop();
  else if(e.type==='await_playback'&&!cancelled.has(e.jobId))pend.set(e.jobId,setTimeout(()=>{pend.delete(e.jobId);open.delete(e.jobId);send({type:'played',jobId:e.jobId})},Math.max(0,(jobEnd[e.jobId]||0)+30-now())));
  else if(e.type==='usage'){nResp++;if(e.row.usageMissing)missing++;usd+=e.row.estimatedUSD||0}
  push(e);
 });
 ws.on('error',err=>push({type:'_wserror',message:String(err.message)}));
 ws.on('close',()=>{run=false;push({type:'_close'})});
 function pump(){ // drift-corrected 20 ms mic loop, silence when the speech queue is empty
  const t0=now();let i=0;run=true;
  const tick=()=>{
   if(!run)return;
   while(t0+i*20<=now()){const it=Q.shift();send({type:'audio',audio:(it?it.f:Buffer.alloc(FRAME_BYTES)).toString('base64')});it?.cb();i++}
   setTimeout(tick,Math.max(0,t0+i*20-now()));
  };tick();
 }
 const s={seen,waitFor,send,jobEnd,firstAudible,audioMs,lastSpeechEnd:0,
  async start(){
   try{await new Promise((res,rej)=>{ws.once('open',res);ws.once('error',rej)});send(startMsg);await waitFor(e=>e.type==='ready',30000,'ready');pump()}
   catch(err){throw Error(seen.find(e=>e.type==='error')?.message||err.message)}
  },
  speak:pcm=>new Promise(res=>{const fs=frames(pcm);let start;fs.forEach((f,k)=>Q.push({f,cb:()=>{const t=now();if(!k)start=t;if(k===fs.length-1){s.lastSpeechEnd=t;res({start,end:t})}}}))}),
  async reply(from,ms=30000){
   const d=await waitFor(e=>e.type==='turn_done'&&!e.cancelled,ms,'turn_done',from),ev=seen.slice(from,seen.indexOf(d)+1),rows=ev.filter(e=>e.type==='usage').map(e=>e.row);
   return {ev,done:d,rows,firstAudio:ev.find(e=>e.type==='audio')?.at,caption:ev.filter(e=>e.type==='speech_text').map(e=>e.delta).join('').trim(),tools:rows.flatMap(r=>r.tools||[])};
  },
  async say(pcm){const from=seen.length,sp=await s.speak(pcm),r=await s.reply(from);return {from,sp,r,lat:r.firstAudio===undefined?undefined:r.firstAudio-sp.end}},
  audible:t=>spans.some(p=>p.start<=t&&t<p.end),
  async settle(){do{while(pend.size||now()<next)await sleep(50);await sleep(600)}while(pend.size||now()<next)},
  async quit(){send({type:'stop'});await waitFor(e=>e.type==='_close',5000,'close').catch(()=>{})},
 };
 return s;
}
const crewOf=(w,p)=>(w?.workers||[]).filter(k=>k.projectId===p&&!k.lead&&k.name);
const called=(tools,re)=>tools.find(t=>re.test(t.name)&&!t.result?.error),CREATE=/^(create_project|delegate_work)$/;
try{
 child=spawn(process.execPath,['--import','tsx','apps/server/src/agency/server.ts'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],
  env:{...process.env,AGENCY_PORT:String(port),AGENCY_DATA_DIR:dir,AGENCY_DEFAULT_PROVIDER:provider,...(only.includes('a')?{AGENCY_TEST_UPSTREAM_ERROR_TWICE:'1',AGENCY_TEST_IDLE_CLOSE_MS:'15000'}:{})}});
 exited=new Promise(r=>child.once('exit',()=>r()));
 const slog=createWriteStream(logPath);
 await new Promise((res,rej)=>{
  const t=setTimeout(()=>rej(Error('server did not start within 30s')),30000);let buf='';
  child.once('error',rej);child.once('exit',c=>rej(Error('server exited early, code '+c)));
  const feed=d=>{slog.write(d);buf+=d;if(/Personal Agency API: http:\/\/127\.0\.0\.1:\d+/.test(buf)){clearTimeout(t);res()}};
  child.stdout.on('data',feed);child.stderr.on('data',feed);
 });
 const h=await(await fetch(base+'/agency-api/health')).json();if(h.ok===false)throw Error('health not ok: '+(h.problems||[]).join('; '));
 log(`server up on ${base}, engine ${provider}, log ${logPath}`);

 if(only.includes('a')){
  const A=session('A',{type:'start',view:'secretary',resume:true});dead=await A.start().then(()=>'',e=>'skipped: no ready: '+e.message);
  await step('A1 two upstream_errors → rotation → answer',async()=>{
   await A.settle();const x=await A.say(clip.a1),ev=x.r.ev,fails=ev.filter(e=>e.type==='usage'&&e.row.status==='failed'&&/upstream|injected/i.test(e.row.error)),bad=ev.find(e=>e.type==='notice'||e.type==='error'),cap=x.r.caption;
   const rc=ev.findIndex(e=>e.type==='voice_state'&&e.state==='reconnecting'),rd=ev.findIndex(e=>e.type==='voice_state'&&e.state==='ready');
   return {ok:fails.length>=2&&rc>=0&&rd>rc&&!!cap&&!/say that again/i.test(cap)&&!bad,latency:x.lat,note:`${fails.length} failed row(s), ${rc<0?'no reconnecting':rd>rc?'reconnecting → ready':'never ready again'}${bad?`, ${bad.type}: ${bad.message}`:''}; "${sh(cap)}"`};
  });
  await step('A2 10 s request, two 700 ms pauses → one turn',async()=>{
   await A.settle();const x=await A.say(clip.a2),ev=x.r.ev,n=ev.filter(e=>e.type==='speech_started').length,th=ev.filter(e=>e.type==='thinking').length,canc=ev.some(e=>e.type==='turn_done'&&e.cancelled);
   return {ok:n===1&&th===1&&!canc&&!!x.r.caption,latency:x.lat,note:`speech ${seconds(clip.a2).toFixed(1)} s, ${n} speech_started, ${th} thinking${canc?', cancelled turn':''}`};
  });
  await step('A3 barge-in 1.5 s into the answer → interrupted ≤ 400 ms',async()=>{
   await A.settle();const from=A.seen.length;await A.speak(clip.a3);
   const {jobId,responseId}=await A.waitFor(e=>e.type==='audio',30000,'first audio',from);
   await sleep(A.firstAudible[jobId]+1500-now());
   if(A.seen.some(e=>e.type==='turn_done'&&e.jobId===jobId&&!e.cancelled)&&A.audioMs[jobId]<2000)throw Error(`answer too short to barge into (${(A.audioMs[jobId]/1000).toFixed(1)} s)`);
   const mark=A.seen.length,bs=await A.speak(clip.a3b);await sleep(300);
   const ev=A.seen.slice(mark),intr=ev.find(e=>e.type==='interrupted'&&e.at>=bs.start),after=intr&&ev.filter(e=>e.type==='audio'&&e.at>intr.at);
   const old=after?.find(e=>e.responseId===responseId||e.jobId===jobId),dbl=after?.find(e=>e.at<=bs.end+300),lat=intr&&intr.at-bs.start;
   let rn='';try{rn=`; reply "${sh((await A.reply(mark,30000)).caption,40)}"`}catch(e){rn='; no reply to barge line'}
   return {ok:!!intr&&lat<=400&&!old&&!dbl,latency:lat,note:`${intr?'':'never interrupted; '}${old?'old response kept talking; ':''}${dbl?'double-talk; ':''}spoke ${(A.audioMs[jobId]/1000).toFixed(1)} s${rn}`};
  });
  await step('A4 idle close → next line reconnects transparently',async()=>{
   const from=A.seen.length;await A.settle();
   const rc=await A.waitFor(e=>e.type==='voice_state'&&e.state==='reconnecting',40000,'voice_state reconnecting',from);
   const rd=await A.waitFor(e=>e.type==='voice_state'&&e.state==='ready',10000,'voice_state ready',from),ms=Math.round(rd.at-rc.at),i=A.seen.indexOf(rc);
   const x=await A.say(clip.a4),err=A.seen.slice(i).find(e=>e.type==='error');
   return {ok:!!x.r.caption&&x.lat!==undefined&&x.lat<=2500&&!err,latency:x.lat,note:`reconnect ${ms} ms (${sh(rc.reason||'',40)})${err?', error: '+err.message:''}; "${sh(x.r.caption,40)}"`};
  });
  await A.quit();
  // A5 is the user's failing call: a barge-in on the pickup greeting must not wedge the session
  const P=session('P',{type:'start',view:'secretary'});dead=await P.start().then(()=>'',e=>'skipped: no ready: '+e.message);
  await step('A5 barge-in on the greeting → three normal turns still answer',async()=>{
   const rs=await P.waitFor(e=>e.type==='response_started',30000,'greeting response_started');await sleep(300);
   const from=P.seen.length;await P.speak(clip.a5);await P.reply(from,30000).catch(()=>{});
   const mark=P.seen.length;let worst=0,n=0;
   for(const k of ['a5q1','a5q2','a5q3']){await P.settle();const x=await P.say(clip[k]);worst=Math.max(worst,x.lat??Infinity);if(x.r.caption&&!/say that again/i.test(x.r.caption))n++}
   const ev=P.seen.slice(mark),fails=ev.filter(e=>e.type==='usage'&&e.row.status==='failed'),bad=ev.find(e=>e.type==='notice'||e.type==='error');
   return {ok:n===3&&!fails.length&&!bad,latency:worst,note:`${n}/3 answered, ${fails.length} failed row(s)${bad?`, ${bad.type}: ${bad.message}`:''}; barged ${(P.seen.find(e=>e.type==='speech_started')?.at-rs.at).toFixed(0)} ms after the greeting began`};
  });
  await P.quit();
 }

 if(only.includes('b')){
  const B=session('B',{type:'start',view:'secretary'});dead=await B.start().then(()=>'',e=>'skipped: no ready: '+e.message);
  let proj,b2From=0,ring,pick,worker;const name=()=>lastWs(B.seen)?.secretary?.name||'Donna';
  await step("B1 pickup + 'Hey Donna' → greeting ≤ 2 s",async()=>{
   pick=await B.reply(0);await B.settle();const x=await B.say(clip.b1),tools=[...pick.tools,...x.r.tools];
   return {ok:x.lat!==undefined&&x.lat<=2000&&new RegExp(name(),'i').test(pick.caption+' '+x.r.caption)&&!tools.length,latency:x.lat,note:`pickup "${sh(pick.caption)}" / reply "${sh(x.r.caption)}"${tools.length?', tools: '+tools.map(t=>t.name):''}`};
  });
  await step("B2 request → tool call in the same turn, no 'shall I'",async()=>{
   await B.settle();b2From=B.seen.length;const x=await B.say(clip.b2),t=called(x.r.tools,CREATE),bad=/shall i|should i|would you like me|do you want me|want me to|i can'?t/i.test(x.r.caption);
   proj=t?.result?.project?.id||lastWs(B.seen)?.projects.filter(p=>!p.deletedAt).at(-1)?.id;
   return {ok:!!t&&!bad,latency:x.lat,note:`tools ${x.r.tools.map(t=>t.name+(t.result?.error?'(error)':'')).join(',')||'none'}; "${sh(x.r.caption,80)}"`};
  });
  await step("B3 'how's it going' → status tool in the turn, truthful",async()=>{
   if(!proj)throw Error('no project from B2');
   await B.settle();const x=await B.say(clip.b3),w=await getWs(),plan=w.assignments.filter(a=>a.projectId===proj&&a.kind==='plan').at(-1),crew=w.assignments.filter(a=>plan&&a.agent?.brainId===plan.id),cap=x.r.caption;
   // the brain stays `working` while its subagents run; with no subagent yet it is still planning the team
   const lies=/\b(done|finished|complete)\b|\b(is|it.s|are) ready\b/i.test(cap)&&plan?.status!=='review'&&!w.briefings.some(b=>b.projectId===proj&&b.status==='queued'),vague=['queued','working'].includes(plan?.status)&&!crew.length&&!/plan|team|read|choos/i.test(cap),fresh=called(x.r.tools,/^(read_workspace|worker_status)$/);
   return {ok:!lies&&!vague&&!!fresh,latency:x.lat,note:`plan ${plan?.status}, ${crew.length} worker(s) ${crew.map(c=>c.status).join('/')}; tools ${x.r.tools.map(t=>t.name).join(',')||'none'}${lies?'; claims done':''}${vague?'; never mentions the plan':''}; "${sh(cap,80)}"`};
  });
  await step("B4 'hello' → plain greeting",async()=>{
   await B.settle();const x=await B.say(clip.b4),cap=x.r.caption;
   return {ok:/\b(hi|hey|hello)\b/i.test(cap)&&!/landing|page|project|plan|worker|build|contact|form/i.test(cap)&&!x.r.tools.length,latency:x.lat,note:`"${sh(cap,80)}"${x.r.tools.length?', tools: '+x.r.tools.map(t=>t.name):''}`};
  });
  await step("B5 'what is <worker> doing' mid-run → worker_status, one sentence",async()=>{
   if(!proj)throw Error('no project from B2');let k;
   for(const end=now()+120000;now()<end;await sleep(1000))if(k=crewOf(await getWs(),proj).sort((a,b)=>Number(b.status==='working')-Number(a.status==='working'))[0])break;
   if(!k)throw Error('no named worker within 120 s');worker=k.name;const pcm=speech(`What is ${worker} doing?`);
   await B.settle();const x=await B.say(pcm),t=called(x.r.tools,/^worker_status$/),n=x.r.caption.split(/(?<=[.!?])\s+/).filter(Boolean).length;
   // ponytail: ≤ 2 sentences, the phone register's limit; tighten to 1 if Donna drifts
   return {ok:!!t&&n>=1&&n<=2,latency:x.lat,note:`${worker} ${k.status}; ${n} sentence(s)${t?'':`; tools ${x.r.tools.map(t=>t.name)}`}; "${sh(x.r.caption,80)}"`};
  });
  await step("B6 'tell <worker> to use a blue palette' → message_worker, 'I'll pass it on'",async()=>{
   if(!worker)throw Error('no worker from B5');const pcm=speech(`Tell ${worker} to use a blue palette.`);
   await B.settle();const x=await B.say(pcm),t=called(x.r.tools,/^message_worker$/),cap=x.r.caption;
   return {ok:!!t&&/pass (it|that|this|the message) (on|along)|let \w+ know|i'?ll tell/i.test(cap),latency:x.lat,note:`${t?`delivered ${t.result?.delivered}`:`no message_worker; tools ${x.r.tools.map(t=>t.name)}`}; "${sh(cap,80)}"`};
  });
  await step('B7 announcement after a lull',async()=>{
   await B.settle();ring=await B.waitFor(e=>e.type==='ring',300000,'ring',b2From);
   const known=new Set(queued(lastWs(B.seen.slice(0,b2From)))),landed=B.seen.slice(b2From).find(e=>e.type==='workspace'&&queued(e.workspace).some(id=>!known.has(id))),quiet=ring.at-B.lastSpeechEnd,aud=B.audible(ring.at);
   const r=await B.reply(B.seen.indexOf(ring)),cap=r.caption,tool=r.tools.find(t=>t.name==='read_briefing');
   const ok=quiet>=3000&&!aud&&/done|ready|finished/i.test(cap)&&/short version|want (it|to hear)|hear it|now\?/i.test(cap)&&!tool;
   return {ok,latency:landed&&ring.at-landed.at,note:`quiet ${(quiet/1000).toFixed(1)} s${aud?', user audible':''}${tool?', read_briefing in the announcement':''}; "${sh(cap,80)}"`};
  });
  await step("B8 'yes' → short version, phone register",async()=>{
   if(!ring)throw Error('no ring in B7');
   await B.settle();const x=await B.say(clip.b6),t=x.r.tools.find(t=>t.name==='read_briefing'),cap=x.r.caption,pp=phoneProblems(cap);
   let id=ring.briefingId;try{id=JSON.parse(t.arguments).briefing_id||id}catch{}
   await B.settle();let pres=true;await B.waitFor(e=>e.type==='workspace'&&e.workspace.briefings.some(b=>b.id===id&&b.status==='presented'),8000,'presented',x.from).catch(()=>{pres=false});
   return {ok:!!t&&!!cap&&!pp.length&&pres,latency:x.lat,note:`${t?'':'no read_briefing; '}${pp.length?'problems '+pp+'; ':''}${pres?'':'not marked presented; '}"${sh(cap,80)}"`};
  });
  await step("B9 'bye' → call ends",async()=>{
   const n=B.seen.filter(e=>e.type==='user_transcript').length,from=B.seen.length,x=await B.say(clip.b7),end=B.jobEnd[x.r.done.jobId]??now();
   const c=await B.waitFor(e=>e.type==='_close',Math.max(1000,end+6000-now()),'server hang-up',from).catch(()=>0);
   if(!c){await B.quit();return {ok:false,note:`server did not hang up; ${n} user_transcript events for spoken input (hangsUp only sees user_transcript)`}}
   return {ok:true,latency:c.at-end,note:`goodbye "${sh(x.r.caption,40)}"`};
  });
  await B.quit();
 }

 if(only.includes('c')){
  dead='';let seenB,ringB,ringAt,connected=false;
  const poll=async()=>{ // main.ts watchRing while disconnected
   try{const q=(await getWs()).briefings.filter(b=>b.status==='queued'),fresh=seenB&&q.find(b=>!seenB.has(b.id));seenB??=new Set();q.forEach(b=>seenB.add(b.id));if(fresh&&!connected&&!ringB){ringB=fresh;ringAt=Date.now()}}catch{}
  };
  await poll();poller=setInterval(poll,1500);
  const C=session('C',{type:'start',view:'secretary',resume:true});connected=true;dead=await C.start().then(()=>'',e=>'skipped: no ready: '+e.message);
  await step('C1 typed task, then hang up',async()=>{
   const from=C.seen.length;C.send({type:'text',text:'Make me a tiny page that says hi.'});const r=await C.reply(from),t=called(r.tools,CREATE);
   await C.settle();await C.quit();connected=false;if(!t)dead='skipped: C1 created no task';
   return {ok:!!t,note:`tools ${r.tools.map(t=>t.name+(t.result?.error?'(error)':'')).join(',')||'none'}; "${sh(r.caption,60)}"`};
  });
  connected=false;
  await step('C2 ring seen by a disconnected client ≤ 3 s after landing',async()=>{
   for(const end=Date.now()+300000;!ringB&&Date.now()<end;)await sleep(250);
   if(!ringB)throw Error('no new queued briefing within 300 s');
   const lat=ringAt-Date.parse(ringB.createdAt);return {ok:lat<=3000,latency:lat,note:`"${sh(ringB.title)}"`};
  });
 }
 if(only.includes('d')){
  dead='';
  const D=session('D',{type:'start',view:'secretary',resume:true});dead=await D.start().then(()=>'',e=>'skipped: no ready: '+e.message);
  let proj,ask,askAt,askFrom=0;const asks=w=>(w?.decisions||[]).filter(d=>d.status==='open'&&d.action?.kind==='ask').map(d=>d.id),old=new Set(asks(await getWs()));
  await step('D1 "landing page for my company" → work handed over in the same turn',async()=>{
   const x=await D.say(clip.d1),t=called(x.r.tools,CREATE);proj=t?.result?.project?.id||t?.result?.assignment?.projectId;
   return {ok:!!t&&!!proj,latency:x.lat,note:`tools ${x.r.tools.map(t=>t.name+(t.result?.error?'(error)':'')).join(',')||'none'}; "${sh(x.r.caption,60)}"`};
  });
  await step('D2 brain asks → open ask decision ≤ 240 s, Donna asks it aloud',async()=>{
   if(!proj)throw Error('no project from D1');
   for(const end=Date.now()+240000;!ask&&Date.now()<end;await sleep(500)){const w=await getWs();ask=w.decisions.find(d=>d.projectId===proj&&d.status==='open'&&d.action?.kind==='ask'&&!old.has(d.id));if(ask){askAt=now();askFrom=D.seen.length}}
   if(!ask)throw Error('no open ask decision within 240 s (the brain did not ask)');
   const r=await D.reply(askFrom,60000),cap=r.caption;
   // ponytail: assumes the question turn is the next turn_done after the decision opens; D1's reply ended long before the brain finished
   return {ok:/\?/.test(cap)&&!r.tools.length,latency:r.firstAudio===undefined?undefined:r.firstAudio-askAt,note:`question "${sh(ask.title,60)}"; Donna "${sh(cap,80)}"${r.tools.length?', tools: '+r.tools.map(t=>t.name):''}`};
  });
  await step('D3 "Acme." → record_decision → next brain turn carries the answer ≤ 15 s',async()=>{
   if(!ask)throw Error('no question from D2');
   await D.settle();const x=await D.say(clip.d3),t=called(x.r.tools,/^record_decision$/);let id;try{id=JSON.parse(t.arguments).id}catch{}
   let w,plan;for(const end=Date.now()+15000;Date.now()<end;await sleep(500)){w=await getWs();plan=w.assignments.findLast(a=>a.projectId===proj&&a.kind==='plan'&&/acme/i.test(a.brief)&&['queued','working'].includes(a.status));if(plan)break}
   const d=w.decisions.find(d=>d.id===ask.id);
   return {ok:!!t&&id===ask.id&&d?.status==='decided'&&!!plan,latency:x.lat,note:`${t?`record_decision ${id===ask.id?'with the question id':'with the wrong id'}`:`no record_decision; tools ${x.r.tools.map(t=>t.name)}`}; decision "${sh(d?.decision||'',30)}" ${d?.status}; ${plan?`new plan ${plan.status}`:'no queued plan carrying the answer'}`};
  });
  await D.quit();
 }
 await finish();
}catch(err){await finish(err.message)}
