import {WebSocket} from 'ws';
import {mkdirSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {Workspace} from '../apps/server/src/agency/workspace.js';

// Real acceptance run: Higgs chooses staffing; native local Codex executes.
// Audio is retained by the server. Playback acknowledgements here are transport-only.
const base=process.env.AGENCY_TEST_URL||'http://127.0.0.1:3003';
const root=resolve('artifacts/agency');mkdirSync(root,{recursive:true});
const reportPath=resolve(root,`workspace-live-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
const events:any[]=[],checks:Record<string,unknown>={},timings:Record<string,number>={};
const execute=promisify(execFile),started=performance.now();
let socket:WebSocket|undefined,projectId:string|undefined,final:Workspace|undefined;
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
function ledger(){const path=resolve(root,'calls.jsonl');return existsSync(path)?readFileSync(path,'utf8').trim().split('\n').filter(Boolean).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}}):[];}
const before=ledger();
async function api(path:string,body?:unknown){const response=await fetch(base+path,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw Error(`${path}: ${data.error||response.status}`);return data;}
async function waitFor(predicate:()=>boolean,timeout=60000){const start=performance.now();while(!predicate()){if(performance.now()-start>timeout)throw Error('Timeout waiting for acceptance condition');await sleep(50);}}
function send(message:unknown){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message));}
async function connect(){
  const ws=socket=new WebSocket(base.replace(/^http/,'ws')+'/agency-ws',{origin:'http://127.0.0.1:5183'});
  ws.on('message',raw=>{
    const event=JSON.parse(raw.toString());
    events.push({...event,audio:event.audio?'[PCM retained in the server audio ledger]':undefined,atMs:performance.now()-started});
    if(event.type==='workspace')final=event.workspace;
    if(event.type==='await_playback')send({type:'played',jobId:event.jobId});
  });
  ws.on('error',error=>events.push({type:'connection_error',message:String(error),atMs:performance.now()-started}));
  await new Promise<void>((done,fail)=>{ws.once('open',done);ws.once('error',fail);});
  const index=events.length;send({type:'start',roomId:projectId});
  await waitFor(()=>events.slice(index).some(e=>e.type==='ready'),60000);
}
let result='FAIL';
try{
  const status=await api('/agency-api/status');if(!status.available)throw Error('Real Higgs key is unavailable; this script does not substitute mock mode.');
  const project=await api('/agency-api/projects',{name:'Codex execution acceptance',brief:'Create a tiny dependency-free add.mjs module, two focused Node tests, and a short English README.'});projectId=project.id;
  final=await api('/agency-api/workspace');await connect();
  const submittedAt=performance.now(),from=events.length;
  send({type:'text',agentId:'mara',text:'Create add.mjs exporting add(a,b), plus add.test.mjs with just two focused node:test cases: add(2,3) equals 5 and add(-2,2) equals 0. Include a short English README. Keep it minimal, dependency-free, and use low reasoning. Decide the useful team size and duties yourself; each executor chooses its own name. Deliver real files and run the checks.'});
  await waitFor(()=>!!final?.assignments.some(a=>a.projectId===projectId&&['working','failed'].includes(a.status)),120000);
  const failedBeforeRun=final!.assignments.find(a=>a.projectId===projectId&&a.status==='failed');if(failedBeforeRun)throw Error(failedBeforeRun.error||'Native execution could not start.');
  timings.requestToNativeWorkingMs=performance.now()-submittedAt;
  const working=final!.assignments.find(a=>a.projectId===projectId&&a.status==='working')!;
  checks.secretaryAllocation={status:'PASS',count:final!.assignments.filter(a=>a.projectId===projectId).length,roles:final!.workers.filter(w=>w.projectId===projectId).map(w=>({id:w.id,role:w.role,responsibility:w.responsibility})),note:'No worker count or name was specified in the user request.'};
  send({type:'interrupt',agentId:'mara'});await sleep(250);
  const interrupted:Workspace=await api('/agency-api/workspace'),same=interrupted.assignments.find(a=>a.id===working.id)!;
  checks.voiceInterrupt={status:same.runId===working.runId&&!['paused','failed'].includes(same.status)?'PASS':'FAIL',before:working.status,after:same.status,sameRunId:same.runId===working.runId};
  const disconnectAt=performance.now();socket!.close();socket=undefined;
  await waitFor(()=>events.slice(from).some(e=>e.type==='workspace'),1000);
  const deadline=performance.now()+300000;
  while(performance.now()<deadline){
    final=await api('/agency-api/workspace');const assigned=final!.assignments.filter(a=>a.projectId===projectId);
    if(assigned.length&&assigned.every(a=>['review','done','failed','waiting','paused'].includes(a.status)))break;
    await sleep(500);
  }
  const assignments=final!.assignments.filter(a=>a.projectId===projectId),workers=final!.workers.filter(w=>w.projectId===projectId);
  checks.continuedWithoutBrowser={status:assignments.length&&assignments.every(a=>['review','done'].includes(a.status))?'PASS':'FAIL',disconnectToCompletionMs:performance.now()-disconnectAt,statuses:assignments.map(a=>({id:a.id,status:a.status,error:a.error}))};
  if(!assignments.length||!assignments.every(a=>['review','done'].includes(a.status)))throw Error('Native work did not produce reviewable results; see retained assignment errors.');
  checks.selfNamedNativeSessions={status:workers.every(w=>!!w.name&&!!w.sessionId)?'PASS':'FAIL',workers:workers.map(w=>({id:w.id,name:w.name,sessionId:w.sessionId}))};
  const artifactChecks=[];
  for(const assignment of assignments)for(const artifact of assignment.artifacts){const response=await fetch(base+artifact.url);const bytes=await response.arrayBuffer();artifactChecks.push({assignmentId:assignment.id,path:artifact.path,status:response.ok&&bytes.byteLength>0?'PASS':'FAIL',bytes:bytes.byteLength});}
  checks.realArtifacts={status:artifactChecks.length&&artifactChecks.every(a=>a.status==='PASS')?'PASS':'FAIL',files:artifactChecks};
  const cwd=assignments[0].cwd;
  try{const test=await execute(process.execPath,['--test','--test-reporter=tap'],{cwd,timeout:30000,windowsHide:true,maxBuffer:1024*1024});const output=test.stdout+test.stderr;checks.independentNodeTests={status:/# tests [1-9]\d*/.test(output)?'PASS':'FAIL',command:'node --test --test-reporter=tap',cwd,output};}
  catch(error:any){checks.independentNodeTests={status:'FAIL',command:'node --test --test-reporter=tap',cwd,error:String(error),stdout:error.stdout,stderr:error.stderr};}
  timings.requestToReviewMs=performance.now()-submittedAt;
  // Reconnect and perform one real read-only secretary turn using current persisted global memory.
  await connect();const reconnectFrom=events.length;
  send({type:'text',agentId:'mara',text:'Give me a brief honest status update for this project. Refer to the actual deliverables and verification. Do not accept results or start new work.'});
  await waitFor(()=>events.slice(reconnectFrom).some(e=>e.type==='turn_done'&&!e.cancelled),60000);
  checks.reconnectMemory={status:'UNVERIFIED',note:'Read-only real secretary response retained for inspection; semantic correctness requires comparing its actual transcript to the persisted results.'};
  const latest:Workspace=await api('/agency-api/workspace');checks.persistedResults={status:assignments.every(a=>latest.assignments.find(b=>b.id===a.id)?.sessionId===a.sessionId)?'PASS':'FAIL'};
  result=Object.values(checks).some((c:any)=>c?.status==='FAIL')?'FAIL':'PASS';
}catch(error){checks.error={message:String(error)};process.exitCode=1;}
finally{
  socket?.close();await sleep(750);const after=ledger(),newRows=after.slice(before.length);
  const knownUSD=newRows.reduce((sum,row)=>sum+(Number.isFinite(row.estimatedUSD)?row.estimatedUSD:0),0);
  const report={result,projectId,at:new Date().toISOString(),durationMs:performance.now()-started,timings,checks,workspace:final,events,boson:{baselineRows:before.length,responses:newRows.length,knownEstimatedUSD:knownUSD,missingUsage:newRows.filter(r=>r.usageMissing).length,actualCreditDebit:'UNVERIFIED',rows:newRows},codex:{billing:'Local authenticated Codex account. API-dollar cost and actual credit debit are unavailable; retained native token usage is not a zero-cost claim.',assignments:final?.assignments.filter(a=>a.projectId===projectId).map(a=>({id:a.id,sessionId:a.sessionId,elapsedMs:a.elapsedMs,tokens:a.tokens,usageMissing:a.usageMissing}))},playback:'This script auto-acknowledges generated speech. Browser playback and physical microphone behavior are separate checks.'};
  writeFileSync(reportPath,JSON.stringify(report,null,2));console.log(JSON.stringify({result,projectId,reportPath,timings,checks,boson:{responses:newRows.length,knownEstimatedUSD:knownUSD,missingUsage:newRows.filter(r=>r.usageMissing).length}},null,2));
  if(result!=='PASS')process.exitCode=1;
}
