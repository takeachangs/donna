import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {realpath,stat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {createInterface} from 'node:readline';
import type {CodexRun,CodexResult} from './codex.js';

/** Staged native Claude Code adapter. Status is static: no CLI/auth/model probe. */
export class LocalClaudeCode {
 private active?:{proc:ChildProcessWithoutNullStreams;sessionId?:string;cancelled:boolean};
 private busy=false;
 private closed=false;
 status(){return {provider:'claude' as const,implemented:true,available:false,verified:false,enabled:false,capabilities:['project-files','native-resume'],note:'Adapter added; installation, authentication and execution have not been verified.'};}
 async run(input:CodexRun):Promise<CodexResult>{
  if(this.closed)throw Error('Claude adapter is closed');
  if(this.busy)throw Error('Claude adapter is already executing');
  if(!isAbsolute(input.cwd))throw Error('Claude requires an absolute project directory');
  if(input.threadId&&!/^[a-f0-9-]{36}$/i.test(input.threadId))throw Error('An exact native Claude session ID is required');
  this.busy=true;
  try{
   const cwd=await realpath(input.cwd);if(!(await stat(cwd)).isDirectory())throw Error('Project directory does not exist');
   if(this.closed)throw Error('Claude adapter is closed');
   const args=['--print','--output-format','stream-json','--verbose','--restricted','--safe-mode','--permission-mode','dontAsk','--tools','Read,Edit,Write,Glob,Grep','--allowedTools','Read','Edit','Write','Glob','Grep'];
   if(input.threadId)args.push('--resume',input.threadId);
   if(process.env.AGENCY_CLAUDE_MODEL?.trim())args.push('--model',process.env.AGENCY_CLAUDE_MODEL.trim());
   args.push('--effort',input.reasoningEffort||'low');
   // Native binary or explicit AGENCY_CLAUDE_BIN; never interpolate a shell command.
   // Restricted + safe mode keeps file tools in cwd and excludes shell, hooks and MCP.
   const proc=spawn(process.env.AGENCY_CLAUDE_BIN||'claude',args,{cwd,windowsHide:true,shell:false,stdio:'pipe'});
   const active={proc,sessionId:input.threadId,cancelled:false};this.active=active;
   return await new Promise<CodexResult>(resolve=>{
    let text='',result:any,failed:string|undefined,settled=false;
    const lines=createInterface({input:proc.stdout});
    const timer=setTimeout(()=>{failed='Claude execution timed out; native session retained';proc.kill();},600_000);
    const finish=()=>{if(settled)return;settled=true;clearTimeout(timer);lines.close();if(this.active===active)this.active=undefined;const error=failed||(result?.is_error?'Claude reported an execution error':undefined)||(!result&&!active.cancelled?'Claude exited without a final result':undefined);resolve({threadId:active.sessionId||'',text:result?.result||text,status:active.cancelled?'interrupted':error?'failed':'completed',...(error?{error}:{}),...(result?{usage:{usage:result.usage,modelUsage:result.modelUsage,totalCostUSD:result.total_cost_usd},model:process.env.AGENCY_CLAUDE_MODEL}:{}),reasoningEffort:input.reasoningEffort||'low'});};
    lines.on('line',line=>{let e:any;try{e=JSON.parse(line)}catch{return;}
     if(e.session_id){if(active.sessionId&&active.sessionId!==e.session_id){failed='Claude returned a different native session ID';proc.kill();return;}
      if(!active.sessionId){active.sessionId=e.session_id;try{input.onThread?.(e.session_id)}catch{failed='Could not persist native Claude session';proc.kill();return;}}}
     if(e.type==='assistant')text=(e.message?.content||[]).filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('\n');
     if(e.type==='result')result=e;
     try{input.onEvent?.({method:'claude/'+String(e.type||'event'),params:e})}catch{/* Observers cannot interrupt native execution. */}
    });
    // Drain without echoing potentially sensitive CLI diagnostics into logs or UI.
    proc.stderr.resume();proc.stdin.on('error',()=>{});
    proc.once('error',()=>{failed='Unable to launch Claude Code. Configure its native executable and local login.';finish();});
    proc.once('close',code=>{if(code!==0&&!active.cancelled&&!failed)failed='Claude Code exited unsuccessfully; check its local configuration.';finish();});
    proc.stdin.end(input.prompt+'\n\nThis adapter supports project file tools only. Shell execution is unavailable. Never claim to have run tests; report any unverified checks explicitly.');
   });
  }finally{this.busy=false;}
 }
 async interrupt(sessionId:string){const a=this.active;if(a?.sessionId===sessionId){a.cancelled=true;a.proc.kill('SIGINT');}}
 close(){this.closed=true;if(this.active){this.active.cancelled=true;this.active.proc.kill();}}
}
