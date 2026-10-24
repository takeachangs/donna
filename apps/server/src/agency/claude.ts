import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {realpath,stat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {createInterface} from 'node:readline';
import type {CodexRun,CodexResult} from './codex.js';

type Status={provider:'claude';implemented:boolean;available:boolean;authenticated:boolean;verified:boolean;enabled:boolean;model:string;capabilities:string[];note:string;error?:string};
type Options={command?:string;args?:string[];turnTimeoutMs?:number;statusTimeoutMs?:number;model?:string;tools?:string[];brain?:boolean};
const NOTE='Verified live 2026-10-24 (Claude Code 2.1.309, claude.ai login, sonnet): a new-session file assignment and a resumed follow-up reached review and the briefing queue.';
// A low-credit ANTHROPIC_API_KEY in the shell would bill the API instead of the claude.ai login; read at spawn time, never import time.
const cleanEnv=()=>{const env={...process.env};delete env.ANTHROPIC_API_KEY;return env;};
// Brain mode (Donna's lead session): fixed tool list; the sandbox confines Bash writes to cwd and Edit(./**)/Write(./**) confine the file tools. --restricted/--safe-mode would hide the project skills, so they are not used.
const BRAIN_TOOLS=['Agent','SendMessage','Skill','Read','Edit','Write','Glob','Grep','Bash'];
const BRAIN_ALLOWED=['Agent','SendMessage','Skill','Bash','Read','Glob','Grep','Edit(./**)','Write(./**)'];
const BRAIN_SETTINGS=JSON.stringify({sandbox:{enabled:true,autoAllowBashIfSandboxed:true,allowUnsandboxedCommands:false}});
const userLine=(t:string)=>JSON.stringify({type:'user',message:{role:'user',content:t}})+'\n';

/** Native Claude Code adapter. Claude Code owns the conversation history; the office keeps only the session ID. */
export class LocalClaudeCode {
 private active?:{proc:ChildProcessWithoutNullStreams;sessionId:string;cancelled:boolean;open:boolean};
 private busy=false;
 private closed=false;
 private readonly options:Required<Omit<Options,'model'|'tools'|'brain'>>;
 private readonly brain:boolean;
 private readonly model:string;
 private readonly tools:string[];
 constructor(options:Options={}){
  this.options={command:options.command??process.env.AGENCY_CLAUDE_BIN??'claude',args:options.args??[],turnTimeoutMs:options.turnTimeoutMs??(options.brain?900_000:600_000),statusTimeoutMs:options.statusTimeoutMs??10_000};
  // Fast default for workers; always passed explicitly so the user's global default never leaks in.
  this.model=options.model??(process.env.AGENCY_CLAUDE_MODEL?.trim()||'sonnet');this.tools=options.tools??['Read','Edit','Write','Glob','Grep'];this.brain=!!options.brain;
 }
 /** Real check, no inference: `claude auth status`. Never returns identity (email/org) fields. */
 async status():Promise<Status>{
  const base={provider:'claude' as const,implemented:true,verified:true,enabled:true,model:this.model,capabilities:['project-files','native-resume'],note:NOTE};
  const out=await new Promise<string|undefined>(resolve=>{
   let buf='',done=false;
   const end=(v?:string)=>{if(done)return;done=true;clearTimeout(timer);resolve(v);};
   const proc=spawn(this.options.command,[...this.options.args,'auth','status'],{env:cleanEnv(),windowsHide:true,shell:false,stdio:['ignore','pipe','ignore']});
   const timer=setTimeout(()=>{proc.kill();end();},this.options.statusTimeoutMs);
   proc.stdout.on('data',d=>{buf+=d;});
   proc.once('error',()=>end());
   proc.once('close',()=>end(buf));
  });
  let info:any;try{info=out===undefined?undefined:JSON.parse(out)}catch{}
  if(!info||typeof info!=='object')return {...base,available:false,authenticated:false,error:'Unable to launch Claude Code. Configure its native executable and local login.'};
  if(info.apiKeySource==='ANTHROPIC_API_KEY')return {...base,available:true,authenticated:false,error:'ANTHROPIC_API_KEY reached the Claude worker; it must use the claude.ai login.'};
  if(info.loggedIn!==true)return {...base,available:true,authenticated:false,error:'Claude Code is not signed in; run `claude auth login`.'};
  return {...base,available:true,authenticated:true};
 }
 async run(input:CodexRun):Promise<CodexResult>{
  if(this.closed)throw Error('Claude adapter is closed');
  if(this.busy)throw Error('Claude adapter is already executing');
  if(!isAbsolute(input.cwd))throw Error('Claude requires an absolute project directory');
  if(input.threadId&&!/^[a-f0-9-]{36}$/i.test(input.threadId))throw Error('An exact native Claude session ID is required');
  this.busy=true;
  try{
   const cwd=await realpath(input.cwd);if(!(await stat(cwd)).isDirectory())throw Error('Project directory does not exist');
   if(this.closed)throw Error('Claude adapter is closed');
   const sessionId=input.threadId||randomUUID();
   const effort=input.reasoningEffort||(this.brain?'medium':'low'),b=this.brain,ids=input.threadId?['--resume',sessionId]:['--session-id',sessionId];
   const args=b?['--print','--output-format','stream-json','--verbose','--input-format','stream-json','--strict-mcp-config','--setting-sources','project','--settings',BRAIN_SETTINGS,'--permission-mode','dontAsk','--tools',BRAIN_TOOLS.join(','),'--allowedTools',...BRAIN_ALLOWED,'--append-system-prompt','Follow the donna-brain skill.',...ids,'--model',this.model,'--effort',effort]
    :['--print','--output-format','stream-json','--verbose','--restricted','--safe-mode','--permission-mode','dontAsk','--tools',this.tools.join(','),'--allowedTools',...this.tools,...ids,'--model',this.model,'--effort',effort];
   // Native binary or explicit AGENCY_CLAUDE_BIN; never interpolate a shell command.
   // Restricted + safe mode keeps file tools in cwd and excludes shell, hooks and MCP.
   const proc=spawn(this.options.command,[...this.options.args,...args],{cwd,env:b?{...cleanEnv(),BASH_DEFAULT_TIMEOUT_MS:'60000',BASH_MAX_TIMEOUT_MS:'120000'}:cleanEnv(),windowsHide:true,shell:false,stdio:'pipe'});
   const active={proc,sessionId,cancelled:false,open:b};this.active=active;
   return await new Promise<CodexResult>(resolve=>{
    let text='',result:any,tasks:any[]|undefined,failed:string|undefined,settled=false,confirmed=false,initModel:string|undefined;
    const lines=createInterface({input:proc.stdout});
    const timer=setTimeout(()=>{failed='Claude execution timed out; native session retained';proc.kill();},this.options.turnTimeoutMs);
    const finish=()=>{if(settled)return;settled=true;active.open=false;clearTimeout(timer);lines.close();if(this.active===active)this.active=undefined;const error=failed||(result?.is_error?'Claude reported an execution error':undefined)||(!result&&!active.cancelled?'Claude exited without a final result':undefined);resolve({threadId:confirmed||input.threadId?sessionId:'',text:result?.result||text,status:active.cancelled?'interrupted':error?'failed':'completed',...(error?{error}:{}),...(result?{usage:{usage:result.usage,modelUsage:result.modelUsage,totalCostUSD:result.total_cost_usd}}:{}),model:initModel||this.model,reasoningEffort:effort});};
    lines.on('line',line=>{let e:any;try{e=JSON.parse(line)}catch{return;}
     if(e.session_id){if(e.session_id!==sessionId){failed='Claude returned a different native session ID';proc.kill();return;}
      if(!confirmed){confirmed=true;if(!input.threadId){try{input.onThread?.(sessionId)}catch{failed='Could not persist native Claude session';proc.kill();return;}}}}
     if(e.type==='system'&&e.subtype==='init'&&typeof e.model==='string')initModel=e.model;
     if(e.type==='system'&&e.subtype==='background_tasks_changed')tasks=Array.isArray(e.tasks)?e.tasks:[];
     if(e.type==='assistant'&&!e.parent_tool_use_id)text=(e.message?.content||[]).filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('\n');
     if(e.type==='result'){result=e;if(b&&!tasks?.length&&active.open){active.open=false;proc.stdin.end();}}
     try{input.onEvent?.({method:'claude/'+String(e.type||'event'),params:e})}catch{/* Observers cannot interrupt native execution. */}
    });
    // Drain without echoing potentially sensitive CLI diagnostics into logs or UI.
    proc.stderr.resume();proc.stdin.on('error',()=>{});
    proc.once('error',()=>{failed='Unable to launch Claude Code. Configure its native executable and local login.';finish();});
    proc.once('close',code=>{if(code!==0&&!active.cancelled&&!failed)failed='Claude Code exited unsuccessfully; check its local configuration.';finish();});
    if(b)proc.stdin.write(userLine(input.prompt));else proc.stdin.end(input.prompt+'\n\nThis adapter supports project file tools only. Shell execution is unavailable. Never claim to have run tests; report any unverified checks explicitly.');
   });
  }finally{this.busy=false;}
 }
 /** Brain mode: add a user turn to the running session. False when no such process or its stdin is already closed. */
 inject(sessionId:string,text:string):boolean{const a=this.active;if(!a||a.sessionId!==sessionId||!a.open||!a.proc.stdin.writable)return false;a.proc.stdin.write(userLine(text));return true;}
 async interrupt(sessionId:string){const a=this.active;if(a?.sessionId===sessionId){a.cancelled=true;a.proc.kill('SIGINT');}}
 close(){this.closed=true;if(this.active){this.active.cancelled=true;this.active.proc.kill();}}
}
