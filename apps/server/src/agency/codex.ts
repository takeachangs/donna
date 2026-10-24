import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {access, realpath, stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute} from 'node:path';
import {createInterface, type Interface} from 'node:readline';

export type CodexEvent = {method:string;params:any};
export type CodexRun = {cwd:string;prompt:string;threadId?:string;reasoningEffort?:'low'|'medium';onEvent?:(event:CodexEvent)=>void;onThread?:(id:string)=>void};
export type CodexResult = {threadId:string;turnId?:string;text:string;status:'completed'|'failed'|'interrupted';usage?:unknown;error?:string;model?:string;reasoningEffort?:'low'|'medium'};
type Pending = {resolve:(result:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>};
type Active = {
  threadId:string;turnId?:string;onEvent?:CodexRun['onEvent'];model?:string;reasoningEffort?:'low'|'medium';
  messages:Map<string,{text:string;phase?:string}>;usage?:unknown;error?:string;timedOut?:boolean;
  cancelRequested?:boolean;interruptPromise?:Promise<void>;
  finish:(result:CodexResult)=>void;timer?:ReturnType<typeof setTimeout>;settled:boolean;result?:CodexResult;
};
type Options = {command?:string;args?:string[];requestTimeoutMs?:number;turnTimeoutMs?:number};

/** Thin native-session client. Codex owns history; the agency persists only thread IDs. */
export class LocalCodex {
  private proc?:ChildProcessWithoutNullStreams;
  private lines?:Interface;
  private init?:Promise<void>;
  private nextId=1;
  private pending=new Map<number,Pending>();
  private active?:Active;
  private busy=false;
  private closed=false;
  private version?:string;
  private readonly model:string;
  private readonly reasoningEffort='low' as const;
  private readonly options:Required<Options>;

  constructor(options:Options={}){
    this.options={command:options.command??process.env.AGENCY_CODEX_BIN??'codex',args:options.args??['app-server','--stdio'],requestTimeoutMs:options.requestTimeoutMs??30_000,turnTimeoutMs:options.turnTimeoutMs??600_000};
    // Application-scoped defaults only. Never rewrite the user's global Codex config.
    this.model=process.env.AGENCY_CODEX_MODEL?.trim()||'gpt-6.1-sol';
  }

  async status():Promise<{available:boolean;authenticated?:boolean;version?:string;model:string;reasoningEffort:'low';modelAvailable?:boolean;error?:string}>{
    try{
      await this.ready();
      const account=await this.request('account/read',{refreshToken:false});
      let cursor:string|undefined,selected:any;
      for(let page=0;page<10;page++){
        const models=await this.request('model/list',{limit:100,...(cursor?{cursor}:{})});
        selected=(models.data??[]).find((m:any)=>m.model===this.model||m.id===this.model);
        if(selected||!models.nextCursor)break;
        cursor=models.nextCursor;
      }
      // Do not return identity, auth material, or a user's unrelated native sessions.
      return {available:true,authenticated:!!account.account||account.requiresOpenaiAuth===false,version:this.version,model:this.model,reasoningEffort:this.reasoningEffort,modelAvailable:!!selected,...(!selected?{error:`Configured model ${this.model} is absent from the local Codex catalog`}:{})};
    }catch(error){return {available:false,model:this.model,reasoningEffort:this.reasoningEffort,error:this.message(error)};}
  }

  async run(input:CodexRun):Promise<CodexResult>{
    if(this.busy)throw new Error('Local Codex is already executing a task');
    this.busy=true;
    let active:Active|undefined;
    let knownThreadId=input.threadId??'';
    try{
      if(!input.prompt.trim())throw new Error('A nonempty Codex task is required');
      const effort=input.reasoningEffort??this.reasoningEffort;
      if(effort!=='low'&&effort!=='medium')throw new Error('Agency Codex reasoning effort must be low or medium');
      if(!isAbsolute(input.cwd))throw new Error('Codex cwd must be absolute');
      const cwd=await realpath(input.cwd);
      if(!(await stat(cwd)).isDirectory())throw new Error('Codex cwd must be a directory');
      await access(cwd,constants.W_OK);
      await this.ready();
      const account=await this.request('account/read',{refreshToken:false});
      if(!account.account&&account.requiresOpenaiAuth!==false)throw new Error('Local Codex is not authenticated; sign in with the local Codex CLI');
      // Never fall back to "latest" or a new thread when a known native session fails.
      const response=await this.request(input.threadId?'thread/resume':'thread/start',{
        ...(input.threadId?{threadId:input.threadId,excludeTurns:true}:{serviceName:'personal_agency'}),
        cwd,approvalPolicy:'never',sandbox:'workspace-write',model:this.model,
      });
      const threadId=response.thread?.id;
      if(typeof threadId!=='string'||!threadId)throw new Error('Codex did not return a thread ID');
      knownThreadId=threadId;
      let finish!:(result:CodexResult)=>void;
      const finished=new Promise<CodexResult>(resolve=>{finish=resolve;});
      active={threadId,onEvent:input.onEvent,messages:new Map(),finish,settled:false,model:this.model,reasoningEffort:effort};
      this.active=active;
      // Register the run before persistence callbacks: a pause can arrive as soon
      // as the caller knows the thread ID, even before Codex assigns a turn ID.
      input.onThread?.(threadId); // Persist BEFORE any billable turn begins.
      active.timer=setTimeout(()=>{
        const current=this.active;
        if(!current||current!==active||current.settled)return;
        current.timedOut=true;
        void this.interrupt(threadId).catch(()=>{}).finally(()=>{
          if(!current.settled)this.settle(current,'failed','Codex task timed out; native thread retained for recovery');
          this.stopTransport(new Error('Codex task timed out'));
        });
      },this.options.turnTimeoutMs);
      const turn=await this.request('turn/start',{
        threadId,cwd,input:[{type:'text',text:input.prompt}],approvalPolicy:'never',model:this.model,effort,
        sandboxPolicy:{type:'workspaceWrite',writableRoots:[cwd],networkAccess:false,excludeTmpdirEnvVar:true,excludeSlashTmp:true},
      });
      if(typeof turn.turn?.id==='string')active.turnId=turn.turn.id;
      if(turn.turn?.status&&turn.turn.status!=='inProgress')this.acceptCompletion(active,turn.turn);
      else void this.deliverInterrupt(active).catch(()=>{});
      return await finished;
    }catch(error){
      const message=this.message(error);
      if(active&&!active.settled)this.settle(active,'failed',message);
      // An RPC timeout may leave a started turn running. Terminate its transport rather
      // than silently starting a second job; native Codex keeps the checkpoint.
      if(message.includes('timed out'))this.stopTransport(new Error(message));
      return active?.result??{threadId:knownThreadId,text:'',status:'failed',error:message};
    }finally{
      if(active?.timer)clearTimeout(active.timer);
      if(this.active===active)this.active=undefined;
      this.busy=false;
    }
  }

  async interrupt(threadId:string):Promise<void>{
    const active=this.active;
    if(!active||active.threadId!==threadId||active.settled)return;
    active.cancelRequested=true;
    await this.deliverInterrupt(active);
  }

  private deliverInterrupt(active:Active):Promise<void>{
    if(!active.cancelRequested||!active.turnId||active.settled)return Promise.resolve();
    if(active.interruptPromise)return active.interruptPromise;
    active.interruptPromise=this.request('turn/interrupt',{threadId:active.threadId,turnId:active.turnId}).then(()=>{}).catch(error=>{
      // A failed cancellation must not leave an invisible worker modifying files.
      if(!active.settled){
        this.settle(active,active.timedOut?'failed':'interrupted',`Unable to confirm cancellation: ${this.message(error)}`);
        this.stopTransport(new Error('Codex cancellation failed'));
      }
      throw error;
    });
    return active.interruptPromise;
  }

  close():void{
    this.closed=true;
    if(this.active&&!this.active.settled)this.settle(this.active,'interrupted','Local Codex connection closed; native thread retained');
    this.stopTransport(new Error('Local Codex connection closed'));
  }

  private ready():Promise<void>{
    if(this.closed)return Promise.reject(new Error('Local Codex client is closed'));
    if(this.init)return this.init;
    this.init=(async()=>{
      const proc=spawn(this.options.command,this.options.args,{stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false});
      this.proc=proc;
      proc.stdin.on('error',()=>{});
      // Drain stderr without exposing credentials, local config, or unrelated logs.
      proc.stderr.resume();
      proc.once('error',error=>{if(this.proc===proc)this.stopTransport(new Error(`Unable to launch local Codex: ${error.message}`));});
      proc.once('exit',(code,signal)=>{if(this.proc===proc)this.stopTransport(new Error(`Local Codex exited (${signal??code??'unknown'})`));});
      this.lines=createInterface({input:proc.stdout});
      this.lines.on('line',line=>this.receive(line));
      const response=await this.request('initialize',{clientInfo:{name:'personal_agency',title:'Personal Agency',version:'0.2.0'}});
      this.version=typeof response.userAgent==='string'?response.userAgent.match(/(?:codex[^/ ]*\/|codex-cli\s+)([^\s(]+)/i)?.[1]:undefined;
      this.send({method:'initialized',params:{}});
    })().catch(error=>{this.stopTransport(error instanceof Error?error:new Error(String(error)));throw error;});
    return this.init;
  }

  private request(method:string,params:unknown):Promise<any>{
    const id=this.nextId++;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`Codex ${method} timed out`));},this.options.requestTimeoutMs);
      this.pending.set(id,{resolve,reject,timer});
      try{this.send({id,method,params});}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
    });
  }

  private send(message:unknown):void{
    if(!this.proc||this.proc.killed||!this.proc.stdin.writable)throw new Error('Local Codex transport is unavailable');
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private receive(line:string):void{
    let event:any;
    try{event=JSON.parse(line);}catch{return;}
    if(event.id!==undefined&&!event.method){
      const pending=this.pending.get(event.id);
      if(!pending)return;
      clearTimeout(pending.timer);this.pending.delete(event.id);
      if(event.error)pending.reject(new Error(`Codex RPC: ${this.message(event.error.message??'Unknown error')}`));
      else pending.resolve(event.result);
      return;
    }
    if(typeof event.method!=='string')return;
    const params=event.params??{};
    const active=this.active;
    if(active&&params.threadId===active.threadId&&!active.settled){
      if(params.turnId&&active.turnId&&params.turnId!==active.turnId)return;
      if(event.method==='turn/started'){
        active.turnId=params.turn?.id;
        void this.deliverInterrupt(active).catch(()=>{});
      }
      if(event.method==='item/agentMessage/delta'){
        const previous=active.messages.get(params.itemId)??{text:''};
        previous.text+=params.delta??'';active.messages.set(params.itemId,previous);
      }
      if(event.method==='item/completed'&&params.item?.type==='agentMessage')active.messages.set(params.item.id,{text:params.item.text??'',phase:params.item.phase});
      if(event.method==='thread/tokenUsage/updated')active.usage=params.tokenUsage;
      if(event.method==='error')active.error=this.message(params.error?.message??'Codex execution error');
      try{active.onEvent?.({method:event.method,params});}catch{/* Observers cannot break native execution. */}
      if(event.method==='turn/completed')this.acceptCompletion(active,params.turn);
    }
    if(event.id!==undefined){
      // This app never silently approves expanded permissions or fabricates user answers.
      // Workers should report missing requirements via their structured final response.
      try{
        if(event.method.endsWith('/requestApproval')){
          const result=event.method.includes('/permissions/')?{permissions:{},scope:'turn'}:{decision:'decline'};
          this.send({id:event.id,result});
        }else if(event.method==='item/tool/requestUserInput')this.send({id:event.id,result:{answers:{}}});
        else this.send({id:event.id,error:{code:-32601,message:'This client does not implement interactive server requests'}});
      }catch{/* Transport teardown handles pending execution. */}
    }
  }

  private acceptCompletion(active:Active,turn:any):void{
    if(!turn)return;
    if(turn.id)active.turnId=turn.id;
    for(const item of turn.items??[])if(item.type==='agentMessage')active.messages.set(item.id,{text:item.text??'',phase:item.phase});
    const status=active.timedOut?'failed':turn.status==='completed'?'completed':turn.status==='interrupted'?'interrupted':'failed';
    this.settle(active,status,active.timedOut?'Codex task timed out; native thread retained for recovery':turn.error?.message??(status==='failed'?active.error:undefined));
  }

  private finalText(active:Active):string{
    const messages=[...active.messages.values()];
    return messages.filter(m=>m.phase==='final_answer').at(-1)?.text??messages.at(-1)?.text??'';
  }

  private settle(active:Active,status:CodexResult['status'],error?:string):void{
    if(active.settled)return;
    active.settled=true;if(active.timer)clearTimeout(active.timer);
    active.result={threadId:active.threadId,turnId:active.turnId,text:this.finalText(active),status,model:active.model,reasoningEffort:active.reasoningEffort,...(active.usage?{usage:active.usage}:{}),...(error?{error:this.message(error)}:{})};
    active.finish(active.result);
  }

  private stopTransport(error:Error):void{
    const proc=this.proc;this.proc=undefined;this.init=undefined;
    this.lines?.close();this.lines=undefined;
    for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(error);}
    this.pending.clear();
    if(this.active&&!this.active.settled)this.settle(this.active,'failed',error.message);
    proc?.kill();
  }

  private message(error:unknown):string{
    const value=error instanceof Error?error.message:String(error);
    return value.replace(/(?:sk-[\w-]+|Bearer\s+[\w.\-]+)/gi,'[redacted]').slice(0,1000);
  }
}
