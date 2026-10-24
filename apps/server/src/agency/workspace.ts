import {randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,realpathSync,statSync,appendFileSync,copyFileSync} from 'node:fs';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {z} from 'zod';
import {OfficeStore} from './state.js';
import {Projects} from './projects.js';
import {reconcileBriefings,type Briefing} from './briefings.js';

export type ExecutionStatus='queued'|'working'|'waiting'|'review'|'done'|'paused'|'failed';
export type Artifact={path:string;url:string;size:number;storage?:string;snapshotAt?:string};
export type Worker={id:string;projectId:string;name?:string;role:string;responsibility:string;characterKey:string;status:ExecutionStatus;sessionId?:string;assignmentId:string;currentAction?:string};
export type Assignment={id:string;projectId:string;workerId:string;title:string;brief:string;acceptance:string;status:ExecutionStatus;revision:number;runId?:string;cwd:string;sessionId?:string;dependsOn:string[];reasoningEffort?:'low'|'medium';summary?:string;artifacts:Artifact[];verification?:string[];error?:string;startedAt?:string;completedAt?:string;tokens?:unknown;usageMissing?:boolean;elapsedMs?:number};
export type Decision={id:string;projectId:string;title:string;context:string;options?:string[];status:'open'|'decided';decision?:string;reason?:string;createdAt:string;updatedAt:string};
export type ProjectOverview={id:string;name:string;deletedAt?:string;goal:string;memory:{outcome:string;checkpoint:string;latest:string;nextStep:string;updatedAt:string}};
export type Workspace={revision:number;secretary:{id:'mara';name:string;role:'Secretary';voice:'eleanor';characterKey:string};projects:ProjectOverview[];workers:Worker[];assignments:Assignment[];decisions:Decision[];briefings:Briefing[];activity:{at:string;projectId?:string;message:string}[]};
export interface CodexRunner {
 status():Promise<{available:boolean;authenticated?:boolean;version?:string;error?:string;model?:string;reasoningEffort?:string;modelAvailable?:boolean}>;
 run(input:{cwd:string;prompt:string;threadId?:string;reasoningEffort?:'low'|'medium';onThread?:(id:string)=>void;onEvent?:(event:any)=>void}):Promise<{threadId:string;turnId?:string;text:string;status:'completed'|'failed'|'interrupted';usage?:unknown;error?:string;model?:string;reasoningEffort?:string}>;
 interrupt(threadId:string):Promise<void>;
 close():void;
}
const now=()=>new Date().toISOString();
const text=z.string().trim().min(1);
const planSchema=z.object({project_id:z.string().uuid(),goal:text.max(2000).optional(),checkpoint:text.max(1000),rationale:text.max(1500),workers:z.array(z.object({key:text.regex(/^[a-zA-Z0-9_-]{1,50}$/),title:text.max(180).optional(),role:text.max(100),responsibility:text.max(1500),brief:text.max(6000),acceptance:text.max(2000),reasoning_effort:z.enum(['low','medium']).default('low'),depends_on:z.array(text).max(8).default([]),reuse_worker_id:text.optional()})).min(1).max(4)});
const resultSchema=z.object({name:text.max(40),summary:text.max(12000),artifacts:z.array(text.max(500)).max(30),verification:z.array(z.string().max(3000)).max(20),needsInput:z.string().max(3000).optional()});

/** Product state is an index and compact brief. Native Codex owns conversation history. */
export class AgencyWorkspace {
 private data:Workspace;private running=false;private stopped=false;private wake?:ReturnType<typeof setTimeout>;private current?:{id:string;runId:string;threadId?:string};
 constructor(private store:OfficeStore,private projects:Projects,private codex:CodexRunner,private notify:(workspace:Workspace)=>void=()=>{},private options:{autoStart?:boolean}={}){
  const p=resolve(store.root,'workspace.json');
  this.data=existsSync(p)?JSON.parse(readFileSync(p,'utf8')):{revision:0,secretary:{id:'mara',name:'Donna',role:'Secretary',voice:'eleanor',characterKey:'char-female-b'},projects:[],workers:[],assignments:[],decisions:[],briefings:[],activity:[]};
  const needsBriefings=!this.data.briefings;this.data.briefings??=[];
  // Adopt the user's chosen name without changing IDs, voices or project history.
  if(['Secretary','Mara'].includes(this.data.secretary.name)){this.data.secretary.name='Donna';this.save();}
  this.syncProjects();
  if(needsBriefings||reconcileBriefings(this.data.briefings,this.data.assignments,this.data.workers))this.save();
 }
 snapshot():Workspace{return structuredClone(this.data);}
 syncProjects(){
  let changed=false;
  for(const p of this.projects.list(true)){
   if(p.deletedAt)for(const a of this.data.assignments.filter(a=>a.projectId===p.id&&['working','queued','waiting'].includes(a.status))){a.revision++;this.state(a,'paused','Project is in Recently deleted; files and session retained');changed=true;}
   const known=this.data.projects.find(k=>k.id===p.id);
   if(known){if(known.name!==p.name||known.deletedAt!==p.deletedAt){known.name=p.name;known.deletedAt=p.deletedAt;changed=true;}continue;}
   const old=this.store.load(p.id);
   this.data.projects.push({...p,goal:old.goal,memory:{outcome:old.goal,checkpoint:'Choose the next useful outcome',latest:old.documents.length?`${old.documents.length} preserved local draft(s); not evidence of external execution.`:'No execution has been delegated yet.',nextStep:'Tell the secretary what to accomplish next.',updatedAt:now()}});changed=true;
  }
  if(changed)this.save();
 }
 private save(){reconcileBriefings(this.data.briefings,this.data.assignments,this.data.workers);this.data.revision++;const p=resolve(this.store.root,'workspace.json');writeFileSync(p+'.tmp',JSON.stringify(this.data,null,2));renameSync(p+'.tmp',p);this.notify(this.snapshot());}
 briefing(id?:string){const active=this.data.briefings.filter(b=>this.data.projects.some(p=>p.id===b.projectId&&!p.deletedAt)),b=id?active.find(b=>b.id===id):active.filter(b=>b.status==='queued').sort((a,b)=>a.createdAt.localeCompare(b.createdAt))[0];if(!b||b.status!=='queued')throw Error('No pending briefing with that ID');return structuredClone(b);}
 presentBriefing(id:string){const existing=this.data.briefings.find(b=>b.id===id);if(existing?.status==='presented')return {committed:false,briefing:structuredClone(existing)};const b=this.briefing(id),stored=this.data.briefings.find(k=>k.id===b.id)!;stored.status='presented';stored.presentedAt=now();this.log(`Donna presented: ${b.title}`,b.projectId);this.save();return {committed:true,briefing:structuredClone(stored)};}
 private log(message:string,projectId?:string){this.data.activity.push({at:now(),projectId,message});this.data.activity=this.data.activity.slice(-120);}
 private project(id:string){const p=this.data.projects.find(p=>p.id===id);if(!p)throw Error('Unknown project; create or select a registered project first.');if(p.deletedAt)throw Error('Project is in Recently deleted. Restore it before changing work.');return p;}
 renameProject(id:string,value:unknown){this.project(id);const p=this.projects.rename(id,value);this.syncProjects();this.log(`Renamed project to ${p.name}`,id);this.save();return {committed:true,project:p};}
 deleteProject(id:string){const p=this.project(id);for(const a of this.data.assignments.filter(a=>a.projectId===id&&['working','queued','waiting'].includes(a.status))){a.revision++;this.state(a,'paused','Project moved to Recently deleted; files and session retained');}this.projects.setDeleted(id,true);this.syncProjects();this.log(`Moved ${p.name} to Recently deleted`,id);this.save();if(this.current&&this.data.assignments.some(a=>a.id===this.current!.id&&a.projectId===id)&&this.current.threadId)void this.codex.interrupt(this.current.threadId).catch(()=>{});return {committed:true};}
 restoreProject(id:string){const p=this.projects.setDeleted(id,false);this.syncProjects();this.log(`Restored ${p.name}; paused work stays paused`,id);this.save();return {committed:true,project:p};}
 private assignment(id:string){const a=this.data.assignments.find(a=>a.id===id);if(!a)throw Error('Unknown assignment');return a;}
 private worker(a:Assignment){return this.data.workers.find(w=>w.id===a.workerId)!;}
 private isCurrent(a:Assignment,revision:number,runId:string){return a.revision===revision&&a.runId===runId&&a.status==='working';}
 private state(a:Assignment,status:ExecutionStatus,action?:string){a.status=status;const w=this.worker(a);if(w.assignmentId===a.id){w.status=status;w.currentAction=action;}}
 private kick(){if(this.options.autoStart===false||this.stopped)return;clearTimeout(this.wake);this.wake=setTimeout(()=>void this.pump(),50);}
 setSecretary(value:unknown){const {name}=z.object({name:text.regex(/^[A-Za-z][A-Za-z '-]{0,39}$/)}).parse(value);if(this.data.secretary.name!=='Secretary'&&this.data.secretary.name!==name)throw Error('Secretary identity is already established.');this.data.secretary.name=name;this.save();return {committed:true,secretary:this.data.secretary};}
 updateProject(value:unknown){const a=z.object({project_id:z.string().uuid(),goal:text.max(2000).optional(),checkpoint:text.max(1000).optional(),next_step:text.max(1000).optional()}).parse(value),p=this.project(a.project_id);if(a.goal){p.goal=a.goal;p.memory.outcome=a.goal;}if(a.checkpoint)p.memory.checkpoint=a.checkpoint;if(a.next_step)p.memory.nextStep=a.next_step;p.memory.updatedAt=now();this.log('Updated project brief',p.id);this.save();return {committed:true,project:p};}
 delegate(value:unknown){
  const a=planSchema.parse(value),p=this.project(a.project_id),keys=new Set(a.workers.map(w=>w.key));
  if(keys.size!==a.workers.length)throw Error('Assignment keys must be unique');
  for(const w of a.workers){for(const d of w.depends_on)if(!keys.has(d)||d===w.key)throw Error('Dependencies must refer to other keys in this plan');if(w.reuse_worker_id){const old=this.data.workers.find(k=>k.id===w.reuse_worker_id);if(!old||old.projectId!==p.id||['queued','working','waiting'].includes(old.status))throw Error('Reused worker must belong to this project and be available');}}
  const visited=new Set<string>(),active=new Set<string>();const visit=(key:string)=>{if(active.has(key))throw Error('Cyclic dependency');if(visited.has(key))return;active.add(key);for(const d of a.workers.find(w=>w.key===key)!.depends_on)visit(d);active.delete(key);visited.add(key);};for(const k of keys)visit(k);
  const reused=a.workers.flatMap(w=>w.reuse_worker_id?[w.reuse_worker_id]:[]);if(new Set(reused).size!==reused.length)throw Error('Do not assign the same worker twice in one plan');
  const ids=new Map(a.workers.map(w=>[w.key,randomUUID()])),created:Assignment[]=[];
  if(a.goal){p.goal=a.goal;p.memory.outcome=a.goal;}p.memory.checkpoint=a.checkpoint;p.memory.nextStep='Execute the delegated work, then inspect the actual deliverables.';p.memory.latest=`Secretary delegated ${a.workers.length} work package(s). ${a.rationale}`;p.memory.updatedAt=now();
  const cwd=resolve(this.store.root,'workspaces',p.id);mkdirSync(cwd,{recursive:true});
  for(const [i,w] of a.workers.entries()){
   const id=ids.get(w.key)!,old=w.reuse_worker_id?this.data.workers.find(k=>k.id===w.reuse_worker_id):undefined;
   const worker:Worker=old||{id:'worker-'+randomUUID(),projectId:p.id,role:w.role,responsibility:w.responsibility,characterKey:['char-male-d','char-female-e','char-male-b','char-female-d'][this.data.workers.length%4],status:'queued',assignmentId:id};
   Object.assign(worker,{role:w.role,responsibility:w.responsibility,status:'queued',assignmentId:id,currentAction:'Waiting for the local executor'});if(!old)this.data.workers.push(worker);
   const assignment:Assignment={id,projectId:p.id,workerId:worker.id,title:w.title||w.role,brief:w.brief,acceptance:w.acceptance,status:'queued',revision:1,cwd,sessionId:worker.sessionId,dependsOn:w.depends_on.map(d=>ids.get(d)!),reasoningEffort:w.reasoning_effort,artifacts:[]};
   this.data.assignments.push(assignment);created.push(assignment);
  }
  this.log(`Secretary allocated ${a.workers.length} worker(s): ${a.rationale}`,p.id);this.save();this.kick();return {committed:true,assignments:created,workers:created.map(a=>this.worker(a))};
 }
 revise(value:unknown){const v=z.object({assignment_id:text,brief:text.max(6000),acceptance:text.max(2000).optional(),title:text.max(180).optional()}).parse(value),a=this.assignment(v.assignment_id);this.project(a.projectId);a.brief=v.brief;if(v.acceptance)a.acceptance=v.acceptance;if(v.title)a.title=v.title;a.revision++;a.error=undefined;this.state(a,'queued','Requirements updated; awaiting execution');this.log(`Revised assignment: ${a.title}`,a.projectId);this.save();if(this.current?.id===a.id&&this.current.threadId)void this.codex.interrupt(this.current.threadId).catch(()=>{});this.kick();return {committed:true,assignment:a};}
 pause(id:string){const a=this.assignment(id);this.project(a.projectId);if(a.status==='done')throw Error('Accepted work is already complete');a.revision++;this.state(a,'paused','Paused by the user; files retained');this.log(`Paused: ${a.title}`,a.projectId);this.save();if(this.current?.id===id&&this.current.threadId)void this.codex.interrupt(this.current.threadId).catch(()=>{});return {committed:true,assignment:a};}
 resume(id:string){const a=this.assignment(id);this.project(a.projectId);if(!['paused','failed','waiting'].includes(a.status))throw Error('Only paused, failed or waiting work can resume');a.revision++;a.error=undefined;this.state(a,'queued','Queued to resume its native session');this.log(`Queued resume: ${a.title}`,a.projectId);this.save();this.kick();return {committed:true,assignment:a};}
 accept(id:string){const a=this.assignment(id);this.project(a.projectId);if(a.status!=='review')throw Error('Only a delivered result can be accepted');for(const f of a.artifacts)this.artifact(a.id,f.path);this.state(a,'done','Accepted by the user');this.log(`Accepted: ${a.title}`,a.projectId);this.save();return {committed:true,assignment:a};}
 decide(value:unknown){const v=z.object({id:text.optional(),project_id:z.string().uuid(),title:text.max(200).optional(),context:z.string().max(4000).optional(),options:z.array(text.max(500)).max(6).optional(),status:z.enum(['open','decided']),decision:text.max(2000).optional(),reason:z.string().max(3000).optional()}).parse(value);const p=this.project(v.project_id);let d=v.id?this.data.decisions.find(d=>d.id===v.id):undefined;if(v.id&&!d)throw Error('Unknown decision');if(d&&d.projectId!==p.id)throw Error('Wrong decision project');if(v.status==='decided'&&!v.decision)throw Error('A decision needs an explicit outcome');if(!d){if(!v.title)throw Error('A decision title is required');d={id:randomUUID(),projectId:p.id,title:v.title,context:v.context||'',status:v.status,createdAt:now(),updatedAt:now()};this.data.decisions.push(d);}Object.assign(d,{status:v.status,updatedAt:now()});if(v.title)d.title=v.title;if(v.context!==undefined)d.context=v.context;if(v.options)d.options=v.options;if(v.decision)d.decision=v.decision;if(v.reason!==undefined)d.reason=v.reason;this.log(v.status==='decided'?`Decision: ${d.decision}${d.reason?' — '+d.reason:''}`:`Needs a decision: ${d.title}`,p.id);p.memory.updatedAt=now();this.save();return {committed:true,decision:d};}
 artifact(id:string,path:string,version?:string){const a=this.assignment(id);let files=a.artifacts;if(version){if(!/^[a-f0-9-]{36}$/.test(version))throw Error('Invalid artifact version');const candidate=resolve(this.store.root,'deliveries',a.id,version,'manifest.json');if(!existsSync(candidate))throw Error('Unknown artifact version');const manifest=this.safeFile(resolve(this.store.root,'deliveries'),`${a.id}/${version}/manifest.json`);files=JSON.parse(readFileSync(manifest,'utf8'));}const f=files.find(f=>f.path===path);if(!f)throw Error('Artifact is not listed for this assignment');return f.storage?this.safeFile(resolve(this.store.root,'deliveries'),f.storage):this.safeFile(a.cwd,path);}
 private safeFile(cwd:string,path:string){if(isAbsolute(path)||/^[A-Za-z]:|^\\\\/.test(path))throw Error('Artifact must be relative to the project directory');const base=realpathSync(cwd),file=realpathSync(resolve(cwd,path)),rel=relative(base,file);if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('Artifact escapes the project directory');if(!statSync(file).isFile())throw Error('Artifact must be a regular file');return file;}
 async recover(){for(const a of this.data.assignments){if(a.status==='working'){a.revision++;this.state(a,'paused','Execution host restarted. Resume the saved native session.');this.log(`Host restarted; native session retained for ${a.title}`,a.projectId);}}this.save();this.kick();}
 private prompt(a:Assignment){
  const w=this.worker(a),p=this.project(a.projectId),dependencies=a.dependsOn.map(id=>{const d=this.assignment(id);return {summary:d.summary,artifacts:d.artifacts.map(f=>f.path),verification:d.verification};});
  const peers=this.data.assignments.filter(k=>k.projectId===a.projectId&&k.id!==a.id&&['queued','working','waiting','review'].includes(k.status)).map(k=>({role:this.worker(k).role,title:k.title,responsibility:this.worker(k).responsibility,status:k.status,artifacts:k.artifacts.map(f=>f.path)}));
  return `You are an execution agent in a personal agency. The secretary assigned your responsibilities. All output and files must be in English. ${w.name?`Your established name is ${w.name}; keep it.`:'Choose your own short English personal name. Do not use a preassigned name.'}
ROLE: ${w.role}\nRESPONSIBILITY: ${w.responsibility}\nPROJECT GOAL: ${p.goal}\nCURRENT CHECKPOINT: ${p.memory.checkpoint}
ASSIGNMENT (revision ${a.revision}): ${a.brief}\nACCEPTANCE: ${a.acceptance}
PROJECT DIRECTORY: ${a.cwd}\nDEPENDENCY DELIVERABLES: ${JSON.stringify(dependencies)}\nOTHER ASSIGNED WORK: ${JSON.stringify(peers)}
RELEVANT DECISIONS: ${JSON.stringify(this.data.decisions.filter(d=>d.projectId===a.projectId&&d.status==='decided').slice(-8))}
Execute the task now using your native tools. Keep the implementation minimal; use existing tools and the standard library when practical. Stay focused on your assigned scope and avoid duplicating peer deliverables. Do not start additional agents or sessions; the secretary owns staffing. Inspect existing project files before changing them. Work only inside the project directory; do not read private credentials, unrelated workspaces or sessions. Never create fake success records, invented test outcomes or mock results presented as real. Keep existing unrelated files. Verify behavior with proportional meaningful checks; do not build an exhaustive test framework for a small change. Report actual commands and limitations honestly. No external sending, publishing, payment or destructive unrelated operations are authorized. If essential information is missing, explain it in needsInput and stop safely.
At completion your LAST message MUST be only a JSON object (no fence) with {"name":"your chosen name","summary":"what actually changed and any limitations","artifacts":["relative/path/to/actual/nonempty/file"],"verification":["actual command and observed result"],"needsInput":"only if blocked"}. Artifacts must exist inside the project directory; do not list generated dependencies, secrets or absolute paths. Your native session owns detailed conversation and tool history; no separate transcript file is needed.`;
 }
 async pump(){
  if(this.running||this.stopped)return;this.running=true;
  try{
   for(;;){
    if(this.stopped)break;
    let blockedChanged=false;
    for(const a of this.data.assignments.filter(a=>a.status==='queued')){const bad=a.dependsOn.map(id=>this.assignment(id)).find(d=>['failed','paused','waiting'].includes(d.status));if(bad){this.state(a,'waiting',`Waiting for dependency: ${bad.title}`);a.error=`Dependency ${bad.title} is ${bad.status}; resume after it is resolved.`;blockedChanged=true;}}
    if(blockedChanged)this.save();
    const a=this.data.assignments.find(a=>a.status==='queued'&&a.dependsOn.every(id=>['review','done'].includes(this.assignment(id).status)));if(!a)break;
    const beforeHealth=a.revision,health=await this.codex.status();
    if(this.stopped)break;
    if(a.status!=='queued'||a.revision!==beforeHealth)continue;
    if(!health.available||health.authenticated===false||health.modelAvailable===false){a.error=health.error||'Local Codex needs authentication';this.state(a,'failed',a.error);this.log(a.error,a.projectId);this.save();continue;}
    const revision=a.revision,runId=randomUUID();a.runId=runId;a.startedAt=now();a.completedAt=undefined;a.error=undefined;this.current={id:a.id,runId,threadId:a.sessionId};this.state(a,'working',a.sessionId?'Resuming native Codex session':'Creating native Codex session; agent will name itself');this.log(`Local Codex started: ${a.title}`,a.projectId);this.save();const started=performance.now();
    try{
     const result=await this.codex.run({cwd:a.cwd,threadId:a.sessionId,reasoningEffort:a.reasoningEffort||'low',prompt:this.prompt(a),onThread:id=>{a.sessionId=id;this.worker(a).sessionId=id;if(this.current?.runId===runId)this.current.threadId=id;if(a.status!=='working')void this.codex.interrupt(id).catch(()=>{});this.save();},onEvent:e=>{if(a.revision!==revision||a.runId!==runId||a.status!=='working')return;const item=e.params?.item;let action:string|undefined;if(e.method==='item/started'&&item?.type==='commandExecution')action=`Running: ${String(item.command||'local command').slice(0,180)}`;if(e.method==='item/started'&&item?.type==='fileChange')action='Updating project files';if(action){this.worker(a).currentAction=action;this.save();}}});
     appendFileSync(resolve(this.store.root,'executions.jsonl'),JSON.stringify({at:now(),assignmentId:a.id,projectId:a.projectId,runId,revision,threadId:result.threadId,turnId:result.turnId,status:result.status,model:result.model,reasoningEffort:result.reasoningEffort,elapsedMs:performance.now()-started,usage:result.usage,usageMissing:result.usage===undefined,error:result.error,usageScope:'Native thread total is cumulative. Do not sum totals from resumed runs.'})+'\n');
     // Pausing or revising the task invalidates an old completion, even if cancellation races.
     if(!this.isCurrent(a,revision,runId))continue;
     a.elapsedMs=performance.now()-started;a.tokens=result.usage;a.usageMissing=result.usage===undefined;a.sessionId=result.threadId||a.sessionId;this.worker(a).sessionId=a.sessionId;
     if(result.status!=='completed')throw Error(result.error||`Native Codex turn ${result.status}`);
     const raw=result.text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');const delivered=resultSchema.parse(JSON.parse(raw));
     const originals=[...new Set(delivered.artifacts)].map(path=>{const file=this.safeFile(a.cwd,path),size=statSync(file).size;if(!size)throw Error(`Empty artifact: ${path}`);return {path,file,size};});
     const snapshotDir=resolve(this.store.root,'deliveries',a.id,runId);mkdirSync(snapshotDir,{recursive:true});
     const files=originals.map(({path,file,size},i)=>{const storage=`${a.id}/${runId}/${i}`;copyFileSync(file,resolve(snapshotDir,String(i)));return {path,size,storage,snapshotAt:now(),url:`/agency-api/assignments/${a.id}/files?path=${encodeURIComponent(path)}&version=${runId}`};});
     writeFileSync(resolve(snapshotDir,'manifest.json'),JSON.stringify(files,null,2));
     if(!files.length&&!delivered.needsInput)throw Error('No real deliverable files were returned');
     const w=this.worker(a);if(!w.name){let name=delivered.name.replace(/[^A-Za-z '-]/g,'').trim();if(!name)throw Error('Agent did not choose a valid English name');const taken=this.data.workers.filter(k=>k.id!==w.id).map(k=>k.name);if(taken.includes(name))name+=` ${this.data.workers.indexOf(w)+1}`;w.name=name;}
     a.summary=delivered.summary;a.artifacts=files;a.verification=delivered.verification;a.completedAt=now();this.state(a,delivered.needsInput?'waiting':'review',delivered.needsInput||'Real files delivered; awaiting your review');a.error=delivered.needsInput;
     const p=this.project(a.projectId);p.memory.latest=`${w.name}: ${a.summary.slice(0,1200)}`;p.memory.nextStep=delivered.needsInput||'Review the actual deliverables and verification evidence.';p.memory.updatedAt=now();
     this.log(`${w.name} ${delivered.needsInput?'needs input':'delivered for review'}: ${a.title}`,a.projectId);
     if(delivered.needsInput)this.decide({project_id:a.projectId,title:`Input needed: ${a.title}`,context:delivered.needsInput,status:'open'});
     // Wake only dependency waits; never silently resume a human-paused task.
     if(!delivered.needsInput)for(const dependent of this.data.assignments.filter(k=>k.status==='waiting'&&k.dependsOn.includes(a.id)&&k.error?.startsWith('Dependency '))){if(dependent.dependsOn.every(id=>['review','done'].includes(this.assignment(id).status))){dependent.error=undefined;this.state(dependent,'queued','Dependencies delivered; queued');}}
     this.save();
    }catch(err){if(this.isCurrent(a,revision,runId)){a.error=String(err).slice(0,2000);a.elapsedMs=performance.now()-started;a.completedAt=now();this.state(a,'failed',a.error);this.project(a.projectId).memory.latest=`Execution failed: ${a.title}. ${a.error}`;this.project(a.projectId).memory.updatedAt=now();this.log(`Execution failed: ${a.title}`,a.projectId);this.save();}}
    finally{if(this.current?.runId===runId)this.current=undefined;}
   }
  }finally{this.running=false;}
 }
 close(){this.stopped=true;clearTimeout(this.wake);this.codex.close();}
}
