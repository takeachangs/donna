import {afterEach,describe,expect,it} from 'vitest';
import {tmpdir} from 'node:os';
import {LocalClaudeCode} from '../apps/server/src/agency/claude';

// A fake CLI run as `node -e <script> -- <extra>`: node swallows the `--`, so process.argv.slice(1) is exactly the
// arguments the adapter appends. It cannot authenticate or invoke a model; the real `claude` is never spawned.
const fake=String.raw`
const a=process.argv.slice(1),send=x=>console.log(JSON.stringify(x));
if(a.includes('auth')&&a.includes('status')){
 send({loggedIn:!a.includes('unauth'),authMethod:'claude.ai',email:'me@example.test',orgName:'Org Test',...('ANTHROPIC_API_KEY' in process.env?{apiKeySource:'ANTHROPIC_API_KEY'}:{})});
}else{
 let prompt='';process.stdin.setEncoding('utf8');process.stdin.on('data',d=>prompt+=d);
 process.stdin.on('end',()=>{
  const k=a.findIndex(x=>x==='--session-id'||x==='--resume'),id=a[k+1],word=prompt.split('\n')[0].trim();
  const sid=word==='mismatch'?'00000000-0000-4000-8000-000000000000':id;
  send({type:'system',subtype:'init',session_id:sid,model:'claude-sonnet-test'});
  if(word==='hang')return void setInterval(()=>{},1000);
  if(word==='exit')process.exit(3);
  send({type:'assistant',session_id:sid,message:{content:[{type:'tool_use',name:'Write'},{type:'text',text:'working'}]}});
  const text=JSON.stringify({argv:a,envHasKey:'ANTHROPIC_API_KEY' in process.env,prompt});
  send({type:'result',subtype:'success',is_error:word==='error',result:text,session_id:sid,usage:{input_tokens:1},modelUsage:{},total_cost_usd:0.01});
 });
}
`;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clients:LocalClaudeCode[]=[];
function client(extra:string[]=[],turnTimeoutMs=3000){const c=new LocalClaudeCode({command:process.execPath,args:['-e',fake,'--',...extra],turnTimeoutMs,statusTimeoutMs:2000});clients.push(c);return c;}
afterEach(()=>{for(const c of clients.splice(0))c.close();delete process.env.ANTHROPIC_API_KEY;});

describe('native Claude Code adapter',()=>{
 it('verifies subscription auth with the API key stripped and exposes no identity',async()=>{
  process.env.ANTHROPIC_API_KEY='leak-test';
  const s=await client().status();
  expect(s).toMatchObject({provider:'claude',implemented:true,available:true,authenticated:true,verified:true,enabled:true,model:'sonnet'});
  expect(s).not.toHaveProperty('email');expect(s).not.toHaveProperty('orgName');expect(JSON.stringify(s)).not.toContain('example.test');
  const bad=await client(['unauth']).status();
  expect(bad.authenticated).toBe(false);expect(bad.error).toBeTruthy();
 });
 it('starts a new session with a fresh id, persists it before the result, and strips the API key',async()=>{
  process.env.ANTHROPIC_API_KEY='leak-test';
  let id='',seenAtResult='';const threads:string[]=[];
  const r=await client().run({cwd:tmpdir(),prompt:'hello',onThread:t=>{threads.push(t);},onEvent:e=>{if(e.method==='claude/result')seenAtResult=threads[0]||'';}});
  const out=JSON.parse(r.text);id=threads[0];
  expect(threads).toHaveLength(1);expect(id).toMatch(UUID);expect(seenAtResult).toBe(id);
  expect(out.argv).toEqual(expect.arrayContaining(['--print','--output-format','stream-json','--verbose','--restricted','--safe-mode','--permission-mode','dontAsk','--model','sonnet','--effort','low','--session-id',id]));
  expect(out.argv).not.toContain('--resume');expect(out.envHasKey).toBe(false);expect(out.prompt).toContain('hello');
  expect(r).toMatchObject({status:'completed',threadId:id,model:'claude-sonnet-test',reasoningEffort:'low'});
  expect((r.usage as any).totalCostUSD).toBe(0.01);
 });
 it('resumes the supplied session without a new id or onThread',async()=>{
  const id='11111111-2222-4333-8444-555555555555';let called=false;
  const r=await client().run({cwd:tmpdir(),prompt:'again',threadId:id,onThread:()=>{called=true;}});
  const out=JSON.parse(r.text);
  expect(out.argv).toEqual(expect.arrayContaining(['--resume',id]));expect(out.argv).not.toContain('--session-id');
  expect(called).toBe(false);expect(r).toMatchObject({status:'completed',threadId:id});
 });
 it('fails on a different native session, an error result, and a bare exit',async()=>{
  const id='11111111-2222-4333-8444-555555555555',c=client();
  expect(await c.run({cwd:tmpdir(),prompt:'mismatch',threadId:id})).toMatchObject({status:'failed',error:expect.stringContaining('different native session')});
  expect(await c.run({cwd:tmpdir(),prompt:'error',threadId:id})).toMatchObject({status:'failed'});
  expect(await c.run({cwd:tmpdir(),prompt:'exit',threadId:id})).toMatchObject({status:'failed'});
 });
 it('bounds a hanging turn and retains the session id',async()=>{
  const r=await client([],300).run({cwd:tmpdir(),prompt:'hang'});
  expect(r).toMatchObject({status:'failed',error:expect.stringContaining('timed out')});expect(r.threadId).toMatch(UUID);
 });
 it('interrupts the running session',async()=>{
  const c=client();
  const r=await c.run({cwd:tmpdir(),prompt:'hang',onThread:id=>{void c.interrupt(id);}});
  expect(r.status).toBe('interrupted');expect(r.threadId).toMatch(UUID);
 });
});
