import {afterEach,describe,expect,it} from 'vitest';
import {tmpdir} from 'node:os';
import {LocalCodex} from '../apps/server/src/agency/codex';

// A real child process exercises newline framing, lifecycle races, RPC errors and exits.
// This fixture cannot authenticate or invoke a model.
const server=String.raw`
const readline=require('node:readline');
const send=x=>process.stdout.write(JSON.stringify(x)+'\n');
const event=(method,params)=>send({method,params});
const rl=readline.createInterface({input:process.stdin});
let current,turns=0,cancelRequests=0;
rl.on('line',line=>{
 const m=JSON.parse(line),p=m.params||{},result=x=>send({id:m.id,result:x});
 if(m.method==='initialize')return result({userAgent:'codex_cli_rs/0.test (Windows)'});
 if(m.method==='initialized')return;
 if(m.method==='account/read')return result({account:process.argv.includes('unauth')?null:{type:'chatgpt'},requiresOpenaiAuth:true});
 if(m.method==='model/list')return result({data:[{id:'gpt-6.1-sol',model:'gpt-6.1-sol',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'medium'}]}],nextCursor:null});
 if(m.method==='thread/start'||m.method==='thread/resume'){
  if(p.sandbox!=='workspace-write'||p.approvalPolicy!=='never'||p.model!=='gpt-6.1-sol')return send({id:m.id,error:{message:'Invalid thread policy'}});
  return result({thread:{id:p.threadId||'native-thread'}});
 }
 if(m.method==='turn/interrupt'){
  cancelRequests++;result({});return setTimeout(()=>event('turn/completed',{threadId:current.threadId,turn:{id:current.turnId,status:'interrupted',items:[{type:'agentMessage',id:'cancel-result',text:JSON.stringify({cancelRequests}),phase:'final_answer'}]}}),30);
 }
 if(m.method==='turn/start'){
  const prompt=p.input[0].text,threadId=p.threadId,turnId='turn-'+(++turns);current={threadId,turnId};
  if(prompt==='exit')return process.exit(7);
  if(prompt==='rpc-error')return send({id:m.id,error:{code:-1,message:'bad request'}});
  if(prompt==='early-event'||prompt==='early-response'){
   const announce=()=>event('turn/started',{threadId,turn:{id:turnId,status:'inProgress'}});
   const respond=()=>result({turn:{id:turnId,status:'inProgress'}});
   setTimeout(()=>{if(prompt==='early-event'){announce();setTimeout(respond,10);}else{respond();setTimeout(announce,10);}},20);
   return;
  }
  event('turn/started',{threadId,turn:{id:turnId,status:'inProgress'}});
  result({turn:{id:turnId,status:'inProgress'}});
  if(prompt==='hang')return;
  setTimeout(()=>{
   const policy=p.sandboxPolicy;
   const valid=p.model==='gpt-6.1-sol'&&['low','medium'].includes(p.effort)&&p.approvalPolicy==='never'&&policy.type==='workspaceWrite'&&policy.writableRoots[0]===p.cwd&&policy.networkAccess===false&&policy.excludeSlashTmp&&policy.excludeTmpdirEnvVar;
   event('item/completed',{threadId:'unrelated-thread',turnId,item:{type:'agentMessage',id:'bad',text:'WRONG',phase:'final_answer'}});
   event('item/completed',{threadId,turnId,item:{type:'agentMessage',id:'commentary',text:'Working...',phase:'commentary'}});
   event('item/agentMessage/delta',{threadId,turnId,itemId:'answer',delta:'partial'});
   event('item/completed',{threadId,turnId,item:{type:'agentMessage',id:'answer',text:JSON.stringify({name:'Rowan',summary:prompt,policyValid:valid,model:p.model,effort:p.effort}),phase:'final_answer'}});
   event('thread/tokenUsage/updated',{threadId,turnId,tokenUsage:{total:{inputTokens:20,outputTokens:5},last:{inputTokens:10,outputTokens:3},modelContextWindow:1000}});
   event('turn/completed',{threadId,turn:{id:turnId,status:prompt==='fail'?'failed':'completed',error:prompt==='fail'?{message:'Execution failed'}:null,items:[]}});
  },10);
 }
});
`;
const clients:LocalCodex[]=[];
function client(extra:string[]=[],timeout=2000){const c=new LocalCodex({command:process.execPath,args:['-e',server,...extra],requestTimeoutMs:1000,turnTimeoutMs:timeout});clients.push(c);return c;}
afterEach(()=>{for(const c of clients.splice(0))c.close();});

describe('native Codex adapter',()=>{
 it('checks auth without creating a conversation and preserves final output and usage',async()=>{
  const c=client();expect(await c.status()).toEqual({available:true,authenticated:true,version:'0.test',model:'gpt-6.1-sol',reasoningEffort:'low',modelAvailable:true});
  let persisted=false;const methods:string[]=[];
  const result=await c.run({cwd:tmpdir(),prompt:'Build a real result',onThread:id=>{expect(id).toBe('native-thread');persisted=true;},onEvent:e=>{expect(persisted).toBe(true);methods.push(e.method);}});
  expect(result.status).toBe('completed');expect(result.turnId).toBe('turn-1');
  expect(JSON.parse(result.text)).toEqual({name:'Rowan',summary:'Build a real result',policyValid:true,model:'gpt-6.1-sol',effort:'low'});
  expect((result.usage as any).last.inputTokens).toBe(10);expect(methods).toContain('turn/completed');
 });
 it('supports medium reasoning only when the caller explicitly requests it',async()=>{
  const result=await client().run({cwd:tmpdir(),prompt:'A bounded task',reasoningEffort:'medium'});
  expect(result.status).toBe('completed');expect(JSON.parse(result.text)).toMatchObject({model:'gpt-6.1-sol',effort:'medium',policyValid:true});
 });
 it('resumes exactly the supplied native thread and serializes jobs',async()=>{
  const c=client();const running=c.run({cwd:tmpdir(),prompt:'Continue',threadId:'project-owned-session'});
  await expect(c.run({cwd:tmpdir(),prompt:'Other'})).rejects.toThrow('already executing');
  expect((await running).threadId).toBe('project-owned-session');
  expect((await c.run({cwd:tmpdir(),prompt:'Again',threadId:'project-owned-session'})).turnId).toBe('turn-2');
 });
 it('refuses missing authentication and invalid workspace paths',async()=>{
  const c=client(['unauth']);expect((await c.status()).authenticated).toBe(false);
  expect(await c.run({cwd:tmpdir(),prompt:'Build'})).toMatchObject({status:'failed',threadId:'',error:expect.stringContaining('not authenticated')});
  expect(await c.run({cwd:'relative/path',prompt:'Build'})).toMatchObject({status:'failed',error:expect.stringContaining('absolute')});
 });
 it('returns actual native failure and process termination without hanging',async()=>{
  const c=client();expect(await c.run({cwd:tmpdir(),prompt:'fail'})).toMatchObject({status:'failed',error:'Execution failed'});
  expect(await c.run({cwd:tmpdir(),prompt:'exit'})).toMatchObject({status:'failed',error:expect.stringContaining('exited')});
  expect(await c.run({cwd:tmpdir(),prompt:'rpc-error'})).toMatchObject({status:'failed',error:expect.stringContaining('bad request')});
 });
 it('interrupts only its active thread and preserves the native session ID',async()=>{
  const c=client();let started!:()=>void;const start=new Promise<void>(r=>started=r);
  const running=c.run({cwd:tmpdir(),prompt:'hang',onEvent:e=>{if(e.method==='turn/started')started();}});
  await start;await c.interrupt('someone-elses-session');await c.interrupt('native-thread');
  expect(await running).toMatchObject({status:'interrupted',threadId:'native-thread'});
 });
 it.each(['early-event','early-response'])('queues an early pause until a native turn ID exists (%s), sending cancellation only once',async prompt=>{
  const c=client();let earlyCancellation!:Promise<void>;
  const result=await c.run({cwd:tmpdir(),prompt,onThread:id=>{
   earlyCancellation=Promise.all([c.interrupt(id),c.interrupt(id)]).then(()=>{});
  }});
  await expect(earlyCancellation).resolves.toBeUndefined();
  expect(result).toMatchObject({status:'interrupted',threadId:'native-thread',turnId:'turn-1'});
  expect(JSON.parse(result.text).cancelRequests).toBe(1);
 });
 it('bounds hanging turns and shutdown, retaining recoverable thread IDs',async()=>{
  const c=client([],50);const result=await c.run({cwd:tmpdir(),prompt:'hang'});
  expect(result).toMatchObject({status:'failed',error:expect.stringContaining('timed out'),threadId:'native-thread'});
  const c2=client();let started!:()=>void;const start=new Promise<void>(r=>started=r);
  const running=c2.run({cwd:tmpdir(),prompt:'hang',onEvent:e=>{if(e.method==='turn/started')started();}});await start;c2.close();
  expect(await running).toMatchObject({status:'interrupted',threadId:'native-thread'});
 });
 it('bounds initialization and handles a missing local executable without leaking stderr',async()=>{
  const missing=new LocalCodex({command:'definitely-missing-agency-codex-binary',requestTimeoutMs:100});clients.push(missing);
  expect(await missing.status()).toMatchObject({available:false,error:expect.stringContaining('Unable to launch')});
  const hanging=new LocalCodex({command:process.execPath,args:['-e','setInterval(()=>{},1000)'],requestTimeoutMs:50});clients.push(hanging);
  expect(await hanging.status()).toMatchObject({available:false,error:expect.stringContaining('initialize timed out')});
 });
});
