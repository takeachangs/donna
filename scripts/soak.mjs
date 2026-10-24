import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
// Paid: talks to real Higgs. Usage: node scripts/soak.mjs [--port 3013] [--idle]
const root=fileURLToPath(new URL('..',import.meta.url));
const args=process.argv.slice(2),idle=args.includes('--idle');
const port=Number(args[args.indexOf('--port')+1])||3013;
const log=m=>console.log(m),sleep=ms=>new Promise(r=>setTimeout(r,ms));
if(!process.env.BOSON_API_KEY){console.error('SOAK FAIL: BOSON_API_KEY is not set');process.exit(1)}
if(port===3003||port===5183){console.error(`SOAK FAIL: port ${port} is reserved for the live office`);process.exit(1)}
const dir=mkdtempSync(join(tmpdir(),'chamber-soak-'));
let child,ws,exited,cleaned=false;
async function cleanup(){
 if(cleaned)return;cleaned=true;
 try{ws?.send(JSON.stringify({type:'stop'}));ws?.close()}catch{}
 if(child&&child.exitCode===null){child.kill();await Promise.race([exited,sleep(5000)]);if(child.exitCode===null)child.kill('SIGKILL')}
 if(resolve(dir).startsWith(resolve(tmpdir())+sep+'chamber-soak-'))rmSync(dir,{recursive:true,force:true});
}
async function finish(reason){
 await cleanup();
 if(reason){console.error('SOAK FAIL: '+reason);process.exit(1)}
 log('SOAK PASS');process.exit(0);
}
for(const s of ['SIGINT','SIGTERM'])process.once(s,()=>finish('interrupted'));
const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
const health=async()=>{
 const h=await(await fetch(`http://127.0.0.1:${port}/agency-api/health`)).json();
 log(`health: ok=${h.ok} version=${h.version} voice=${h.voice?.state} sessions=${h.voice?.sessions}`);return h;
};
// every ws event is kept in `seen` and offered to whoever is waiting; an error event fails all waits
const waiters=new Set(),seen=[];
const waitFor=(match,ms,what,from=0)=>new Promise((res,rej)=>{
 const hit=seen.slice(from).find(e=>match(e)||e.type==='error');
 if(hit)return hit.type==='error'&&!match(hit)?rej(Error('server error event: '+hit.message)):res(hit);
 const w={match,res:e=>{clearTimeout(t);waiters.delete(w);res(e)},rej:e=>{clearTimeout(t);waiters.delete(w);rej(e)}};
 const t=setTimeout(()=>w.rej(Error(`timed out after ${ms/1000}s waiting for ${what}`)),ms);
 waiters.add(w);
});
function onEvent(e){
 if(e.type==='notice')log(`notice[${e.level}]: ${e.message}`);
 if(e.type==='voice_state')log(`voice_state: ${e.state}${e.reason?' ('+e.reason+')':''}`);
 seen.push(e);
 for(const w of [...waiters])if(e.type==='error')w.rej(Error('server error event: '+e.message));else if(w.match(e))w.res(e);
}
async function turn(text){
 const from=seen.length,t0=Date.now();
 log(`> ${text}`);
 ws.send(JSON.stringify({type:'text',text}));
 const d=await waitFor(e=>e.type==='turn_done'&&!e.cancelled,60000,'turn_done',from);
 const caption=seen.slice(from).filter(e=>e.type==='speech_text').map(e=>e.delta).join('').trim();
 log(`< ${caption||'(no caption)'}  [${Date.now()-t0} ms]`);
 if(d.hasAudio)ws.send(JSON.stringify({type:'played',jobId:d.jobId}));
 return caption;
}
try{
 child=spawn(process.execPath,['--import','tsx','apps/server/src/agency/server.ts'],{
  cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],
  env:{...process.env,AGENCY_PORT:String(port),AGENCY_DATA_DIR:dir},
 });
 exited=new Promise(r=>child.once('exit',()=>r()));
 await new Promise((res,rej)=>{
  const t=setTimeout(()=>rej(Error('server did not start within 30s')),30000);
  child.once('error',rej);child.once('exit',c=>rej(Error('server exited early, code '+c)));
  const feed=d=>{for(const l of String(d).split('\n'))if(l)log('server| '+l);if(/Personal Agency API: http:\/\/127\.0\.0\.1:\d+/.test(d)){clearTimeout(t);res()}};
  child.stdout.on('data',feed);child.stderr.on('data',feed);
 });
 const h=await health();assert(h.ok!==false,'health reports not ok: '+(h.problems||[]).join('; '));
 ws=new WebSocket(`ws://127.0.0.1:${port}/agency-ws`);
 ws.onmessage=m=>{try{onEvent(JSON.parse(m.data))}catch{}};
 ws.onclose=()=>{if(!cleaned)onEvent({type:'error',message:'websocket closed unexpectedly'})};
 await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(Error('websocket failed to open'))});
 ws.send(JSON.stringify({type:'start',view:'secretary'}));
 const r=seen.length;await waitFor(e=>e.type==='ready',30000,'ready');
 log('ready');
 // Donna picks up first (pickUpNotice); wait for that turn so it does not race turn 1
 await waitFor(e=>e.type==='turn_done',30000,'greeting',r);log(`< ${seen.slice(r).filter(e=>e.type==='speech_text').map(e=>e.delta).join('').trim()||'(no caption)'}  [greeting]`);
 await turn('Quick check, no work needed and do not create any project: remember the code word pineapple and answer in one short sentence.');
 await turn('Thanks. Reply with only the word OK.');
 if(idle){
  const t0=Date.now(),mark=seen.length;
  const tick=setInterval(()=>log(`. waiting for Higgs idle close, ${Math.round((Date.now()-t0)/1000)}s`),30000);
  let ev;try{ev=await waitFor(e=>e.type==='voice_state'&&e.state==='reconnecting',400000,'voice_state reconnecting',mark)}finally{clearInterval(tick)}
  log(`idle close after ${Math.round((Date.now()-t0)/1000)}s, reason: ${ev.reason}`);
  assert((await health()).voice?.state==='reconnecting','health voice.state should be reconnecting');
  const caption=await turn('What was the code word I asked you to remember? Answer in one word.');
  assert(seen.slice(mark).some(e=>e.type==='voice_state'&&e.state==='ready'),'no voice_state ready after reconnect');
  assert(caption,'empty caption after reconnect');
  log(`remembered code word: ${/pineapple/i.test(caption)?'yes':'no'}`);
  assert((await health()).voice?.state==='ready','health voice.state should be ready');
 }
 await finish();
}catch(err){await finish(err.message)}
