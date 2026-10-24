import {randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,realpathSync,statSync,appendFileSync,copyFileSync} from 'node:fs';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {z} from 'zod';
import {OfficeStore} from './state.js';
import {Projects} from './projects.js';
import {reconcileBriefings,type Briefing} from './briefings.js';
import {createProjectSchema,workPlanSchema,validateDependencies,goalSchema,parsePlan,lastJson,brainReviewSchema} from './plans.js';

export type ExecutionStatus='queued'|'working'|'waiting'|'review'|'done'|'paused'|'failed';
export type Artifact={path:string;url:string;size:number;storage?:string;snapshotAt?:string};
export type Provider='codex'|'claude';
export type Worker={id:string;projectId:string;provider?:Provider;lead?:true;name?:string;role:string;responsibility:string;characterKey:string;status:ExecutionStatus;sessionId?:string;assignmentId:string;currentAction?:string};
export type Assignment={id:string;projectId:string;workerId:string;provider?:Provider;kind?:'plan'|'review';title:string;brief:string;acceptance:string;status:ExecutionStatus;revision:number;runId?:string;cwd:string;sessionId?:string;dependsOn:string[];reasoningEffort?:'low'|'medium';summary?:string;artifacts:Artifact[];verification?:string[];error?:string;startedAt?:string;completedAt?:string;tokens?:unknown;usageMissing?:boolean;elapsedMs?:number};
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
const label=(p?:Provider)=>p==='claude'?'Claude Code':'Codex';
const text=z.string().trim().min(1);
const resultSchema=z.object({name:text.max(40),summary:text.max(12000),artifacts:z.array(text.max(500)).max(30),verification:z.array(z.string().max(3000)).max(20),needsInput:z.string().max(3000).optional()});

/** Product state is an index and compact brief. Native Codex owns conversation history. */
export class AgencyWorkspace {
 private data:Workspace;private running=false;private stopped=false;private wake?:ReturnType<typeof setTimeout>;private current?:{id:string;runId:string;threadId?:string};
 constructor(private store:OfficeStore,private projects:Projects,private codex:CodexRunner,private notify:(workspace:Workspace)=>void=()=>{},private options:{autoStart?:boolean;claude?:CodexRunner;brain?:CodexRunner;defaultProvider?:Provider}={}){
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
 createProject(value:unknown){
  const input=createProjectSchema.parse(value),goal=input.initial_work;
  if(goal&&!this.options.brain)throw Error('Donna\'s brain is not connected in this office');
  const project=this.projects.create(input);this.syncProjects();
  if(!goal)return {committed:true,project,executionStarted:false,note:'Empty project created; nothing is queued. If the user asked for work, call delegate_work for this project now, before speaking.'};
  const r=this.delegate({project_id:project.id,goal});
  return {committed:true,project,executionStarted:true,planning:true,assignments:[r.assignment],note:'Donna\'s brain is planning this goal now; workers appear when the plan lands. Do not delegate the same work again.'};
 }
 renameProject(id:string,value:unknown){this.project(id);const p=this.projects.rename(id,value);this.syncProjects();this.log(`Renamed project to ${p.name}`,id);this.save();return {committed:true,project:p};}
 deleteProject(id:string){const p=this.project(id);for(const a of this.data.assignments.filter(a=>a.projectId===id&&['working','queued','waiting'].includes(a.status))){a.revision++;this.state(a,'paused','Project moved to Recently deleted; files and session retained');}this.projects.setDeleted(id,true);this.syncProjects();this.log(`Moved ${p.name} to Recently deleted`,id);this.save();const cur=this.current&&this.data.assignments.find(a=>a.id===this.current!.id&&a.projectId===id);if(cur&&this.current!.threadId)void this.runner(cur)?.interrupt(this.current!.threadId).catch(()=>{});return {committed:true};}
 restoreProject(id:string){const p=this.projects.setDeleted(id,false);this.syncProjects();this.log(`Restored ${p.name}; paused work stays paused`,id);this.save();return {committed:true,project:p};}
 private assignment(id:string){const a=this.data.assignments.find(a=>a.id===id);if(!a)throw Error('Unknown assignment');return a;}
 private worker(a:Assignment){return this.data.workers.find(w=>w.id===a.workerId)!;}
 private runner(a:Assignment){return a.kind?this.options.brain:a.provider==='claude'?this.options.claude:this.codex;}
 private engines(ps:(Provider|undefined)[]){if(ps.includes('claude')&&!this.options.claude)throw Error('Claude Code is not connected in this office');}
 private isCurrent(a:Assignment,revision:number,runId:string){return a.revision===revision&&a.runId===runId&&a.status==='working';}
 private state(a:Assignment,status:ExecutionStatus,action?:string){a.status=status;const w=this.worker(a);if(w.assignmentId===a.id){w.status=status;w.currentAction=action;}}
 private kick(){if(this.options.autoStart===false||this.stopped)return;clearTimeout(this.wake);this.wake=setTimeout(()=>void this.pump(),50);}
 setSecretary(value:unknown){const {name}=z.object({name:text.regex(/^[A-Za-z][A-Za-z '-]{0,39}$/)}).parse(value);if(this.data.secretary.name!=='Secretary'&&this.data.secretary.name!==name)throw Error('Secretary identity is already established.');this.data.secretary.name=name;this.save();return {committed:true,secretary:this.data.secretary};}
 updateProject(value:unknown){const a=z.object({project_id:z.string().uuid(),goal:text.max(2000).optional(),checkpoint:text.max(1000).optional(),next_step:text.max(1000).optional()}).parse(value),p=this.project(a.project_id);if(a.goal){p.goal=a.goal;p.memory.outcome=a.goal;}if(a.checkpoint)p.memory.checkpoint=a.checkpoint;if(a.next_step)p.memory.nextStep=a.next_step;p.memory.updatedAt=now();this.log('Updated project brief',p.id);this.save();return {committed:true,project:p};}
 /** The voice's entry: queue a planning step for Donna's brain, the project's persistent lead session. */
 delegate(value:unknown){
  const {project_id,goal}=z.object({project_id:z.string().uuid(),goal:goalSchema}).parse(value);
  if(!this.options.brain)throw Error('Donna\'s brain is not connected in this office');
  const p=this.project(project_id);
  let lead=this.data.workers.find(w=>w.projectId===p.id&&w.lead);
  if(!lead){lead={id:'lead-'+randomUUID(),projectId:p.id,provider:'claude',lead:true,name:this.data.secretary.name,role:'Lead',responsibility:'Plans the team, reviews its results and writes the briefing',characterKey:this.data.secretary.characterKey,status:'queued',assignmentId:''};this.data.workers.push(lead);}
  const cwd=resolve(this.store.root,'workspaces',p.id);mkdirSync(cwd,{recursive:true});
  const plan:Assignment={id:randomUUID(),projectId:p.id,workerId:lead.id,provider:'claude',kind:'plan',title:'Plan: '+goal.slice(0,170),brief:goal,acceptance:'A valid plan for this request',status:'queued',revision:1,cwd,sessionId:lead.sessionId,dependsOn:[],reasoningEffort:'medium',artifacts:[]};
  this.data.assignments.push(plan);Object.assign(lead,{assignmentId:plan.id,status:'queued',currentAction:'Planning queued'});
  Object.assign(p.memory,{latest:`Donna's brain is planning: ${goal.slice(0,300)}`,nextStep:'Wait for the plan; workers appear when it lands.',updatedAt:now()});
  this.log(`Donna's brain is planning: ${goal.slice(0,120)}`,p.id);this.save();this.kick();
  return {committed:true,planning:true,assignment:plan,note:'Donna\'s brain is planning this now; workers appear when the plan lands. Say it is being planned; do not name workers or a team size.'};
 }
 /** Execute a plan from Donna's brain: create the workers and their queued assignments atomically. */
 staff(projectId:string,value:unknown){
  const a=workPlanSchema.parse(value),p=this.project(projectId);validateDependencies(a.workers);
  for(const w of a.workers)if(w.reuse_worker_id){const old=this.data.workers.find(k=>k.id===w.reuse_worker_id);if(!old||old.projectId!==p.id||old.lead||['queued','working','waiting'].includes(old.status))throw Error('Reused worker must belong to this project and be available');if((w.provider??old.provider??'codex')!==(old.provider??'codex'))throw Error(`Reused worker is bound to its native ${label(old.provider)} session; use a new worker for another engine`);}
   this.engines(a.workers.map(w=>w.provider??this.data.workers.find(k=>k.id===w.reuse_worker_id)?.provider??this.options.defaultProvider));
  const reused=a.workers.flatMap(w=>w.reuse_worker_id?[w.reuse_worker_id]:[]);if(new Set(reused).size!==reused.length)throw Error('Do not assign the same worker twice in one plan');
  const ids=new Map(a.workers.map(w=>[w.key,randomUUID()])),created:Assignment[]=[];
  p.memory.checkpoint=a.checkpoint;p.memory.nextStep='Execute the delegated work, then inspect the actual deliverables.';p.memory.latest=`Donna's brain staffed ${a.workers.length} work package(s). ${a.rationale}`;p.memory.updatedAt=now();
  const cwd=resolve(this.store.root,'workspaces',p.id);mkdirSync(cwd,{recursive:true});
  for(const [i,w] of a.workers.entries()){
   const id=ids.get(w.key)!,old=w.reuse_worker_id?this.data.workers.find(k=>k.id===w.reuse_worker_id):undefined,provider:Provider=w.provider??old?.provider??this.options.defaultProvider??'codex';
   const worker:Worker=old||{id:'worker-'+randomUUID(),projectId:p.id,provider,role:w.role,responsibility:w.responsibility,characterKey:['char-male-d','char-female-e','char-male-b','char-female-d'][this.data.workers.filter(k=>!k.lead).length%4],status:'queued',assignmentId:id};
   Object.assign(worker,{provider,role:w.role,responsibility:w.responsibility,status:'queued',assignmentId:id,currentAction:'Waiting for the local executor'});if(!old)this.data.workers.push(worker);
   const assignment:Assignment={id,projectId:p.id,workerId:worker.id,provider,title:w.title||w.role,brief:w.brief,acceptance:w.acceptance,status:'queued',revision:1,cwd,sessionId:worker.sessionId,dependsOn:w.depends_on.map(d=>ids.get(d)!),reasoningEffort:w.reasoning_effort,artifacts:[]};
   this.data.assignments.push(assignment);created.push(assignment);
  }
  this.log(`Donna's brain allocated ${a.workers.length} worker(s): ${a.rationale}`,p.id);this.save();this.kick();return {committed:true,assignments:created,workers:created.map(a=>this.worker(a))};
 }
 revise(value:unknown){const v=z.object({assignment_id:text,brief:text.max(6000),acceptance:text.max(2000).optional(),title:text.max(180).optional()}).parse(value),a=this.assignment(v.assignment_id);this.project(a.projectId);a.brief=v.brief;if(v.acceptance)a.acceptance=v.acceptance;if(v.title)a.title=v.title;a.revision++;a.error=undefined;this.state(a,'queued','Requirements updated; awaiting execution');this.log(`Revised assignment: ${a.title}`,a.projectId);this.save();if(this.current?.id===a.id&&this.current.threadId)void this.runner(a)?.interrupt(this.current.threadId).catch(()=>{});this.kick();return {committed:true,assignment:a};}
 pause(id:string){const a=this.assignment(id);this.project(a.projectId);if(a.status==='done')throw Error('Accepted work is already complete');a.revision++;this.state(a,'paused','Paused by the user; files retained');this.log(`Paused: ${a.title}`,a.projectId);this.save();if(this.current?.id===id&&this.current.threadId)void this.runner(a)?.interrupt(this.current.threadId).catch(()=>{});return {committed:true,assignment:a};}
 resume(id:string){const a=this.assignment(id);this.project(a.projectId);if(!['paused','failed','waiting'].includes(a.status))throw Error('Only paused, failed or waiting work can resume');a.revision++;a.error=undefined;this.state(a,'queued','Queued to resume its native session');this.log(`Queued resume: ${a.title}`,a.projectId);this.save();this.kick();return {committed:true,assignment:a};}
 accept(id:string){const a=this.assignment(id);this.project(a.projectId);if(a.status!=='review')throw Error('Only a delivered result can be accepted');for(const f of a.artifacts)this.artifact(a.id,f.path);this.state(a,'done','Accepted by the user');this.log(`Accepted: ${a.title}`,a.projectId);this.save();return {committed:true,assignment:a};}
 decide(value:unknown){const v=z.object({id:text.optional(),project_id:z.string().uuid(),title:text.max(200).optional(),context:z.string().max(4000).optional(),options:z.array(text.max(500)).max(6).optional(),status:z.enum(['open','decided']),decision:text.max(2000).optional(),reason:z.string().max(3000).optional()}).parse(value);const p=this.project(v.project_id);let d=v.id?this.data.decisions.find(d=>d.id===v.id):undefined;if(v.id&&!d)throw Error('Unknown decision');if(d&&d.projectId!==p.id)throw Error('Wrong decision project');if(v.status==='decided'&&!v.decision)throw Error('A decision needs an explicit outcome');if(!d){if(!v.title)throw Error('A decision title is required');d={id:randomUUID(),projectId:p.id,title:v.title,context:v.context||'',status:v.status,createdAt:now(),updatedAt:now()};this.data.decisions.push(d);}Object.assign(d,{status:v.status,updatedAt:now()});if(v.title)d.title=v.title;if(v.context!==undefined)d.context=v.context;if(v.options)d.options=v.options;if(v.decision)d.decision=v.decision;if(v.reason!==undefined)d.reason=v.reason;this.log(v.status==='decided'?`Decision: ${d.decision}${d.reason?' — '+d.reason:''}`:`Needs a decision: ${d.title}`,p.id);p.memory.updatedAt=now();this.save();return {committed:true,decision:d};}
 artifact(id:string,path:string,version?:string){const a=this.assignment(id);let files=a.artifacts;if(version){if(!/^[a-f0-9-]{36}$/.test(version))throw Error('Invalid artifact version');const candidate=resolve(this.store.root,'deliveries',a.id,version,'manifest.json');if(!existsSync(candidate))throw Error('Unknown artifact version');const manifest=this.safeFile(resolve(this.store.root,'deliveries'),`${a.id}/${version}/manifest.json`);files=JSON.parse(readFileSync(manifest,'utf8'));}const f=files.find(f=>f.path===path);if(!f)throw Error('Artifact is not listed for this assignment');return f.storage?this.safeFile(resolve(this.store.root,'deliveries'),f.storage):this.safeFile(a.cwd,path);}
 private safeFile(cwd:string,path:string){if(isAbsolute(path)||/^[A-Za-z]:|^\\\\/.test(path))throw Error('Artifact must be relative to the project directory');const base=realpathSync(cwd),file=realpathSync(resolve(cwd,path)),rel=relative(base,file);if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('Artifact escapes the project directory');if(!statSync(file).isFile())throw Error('Artifact must be a regular file');return file;}
 async recover(){for(const a of this.data.assignments){if(a.status==='working'){a.revision++;this.state(a,'paused','Execution host restarted. Resume the saved native session.');this.log(`Host restarted; native session retained for ${a.title}`,a.projectId);}}this.save();this.kick();}
 private prompt(a:Assignment){
  const p=this.project(a.projectId);
  if(a.kind==='plan'){
   const team=this.data.workers.filter(k=>k.projectId===p.id&&!k.lead).map(k=>({id:k.id,name:k.name,role:k.role,provider:k.provider,status:k.status})),recent=this.data.assignments.filter(k=>k.projectId===p.id&&!k.kind).slice(-8).map(k=>({title:k.title,status:k.status,summary:k.summary?.slice(0,300),artifacts:k.artifacts.map(f=>f.path)})),decided=this.data.decisions.filter(d=>d.projectId===p.id&&d.status==='decided').slice(-8),engine=label(this.options.defaultProvider??'codex');
   return `You are Donna's brain, the lead of a personal AI office. Donna's voice talks with the user; you plan the work, workers do it, and you review it afterwards. You never talk to the user, never edit files and never start agents yourself: the office runs the workers you plan, one at a time in dependency order.
PROJECT: ${p.name}\nPROJECT GOAL: ${p.goal}\nMEMORY: ${JSON.stringify(p.memory)}
REQUEST (from the user, through Donna's voice): ${a.brief}
PROJECT DIRECTORY: ${a.cwd}. Workers write here. Read what exists with Read, Glob and Grep before planning; it may be empty.
TEAM IN THIS ROOM: ${JSON.stringify(team)}\nRECENT WORK: ${JSON.stringify(recent)}\nDECISIONS: ${JSON.stringify(decided)}
ENGINES: workers run on ${engine} by default. Set "provider" ("codex" or "claude") on a worker only when the user asked for a specific engine.
Plan 1 to 4 workers. Use one worker for a single small change. When the request has separable parts (for example a page and its form's behaviour, or content and styling), give each part its own worker that owns distinct files, and name the other workers' files in each brief so nobody overwrites them. If a worker builds on another's files, put that worker's key in its depends_on. Each brief carries the user's full constraints; acceptance names the concrete files and a proportionate check. To continue an idle worker's native session for related follow-up work, set reuse_worker_id to its id. Workers choose their own names; never name them. Keep the work small and directly useful; no test frameworks or extra deliverables.
Reply with ONLY a JSON object, no fence: {"title":"short outcome title for the user's briefing","checkpoint":"the outcome this round delivers","rationale":"one sentence on why this split","workers":[{"key":"page","role":"short role","title":"outcome-oriented title","responsibility":"what this worker owns","brief":"full instructions","acceptance":"files and check","depends_on":[]}]}`;
  }
  if(a.kind==='review'){
   const deliveries=a.dependsOn.map(id=>{const d=this.assignment(id),w=this.worker(d);return {worker:w.name,role:w.role,title:d.title,acceptance:d.acceptance,status:d.status,summary:d.summary,artifacts:d.artifacts.map(f=>f.path),verification:d.verification};});
   return `You are Donna's brain, the lead of a personal AI office, reviewing your team's delivery. You never talk to the user and never edit files; Donna's voice speaks your summary.
REQUEST: ${a.brief}\nPROJECT DIRECTORY: ${a.cwd}\nDELIVERIES: ${JSON.stringify(deliveries)}
Read the delivered files and check each against its acceptance. Then write the briefing summary Donna will speak: what was built and by whom (use the workers' names), the one most useful thing for the user to check, and any real gap or limitation. Plain sentences; no IDs, URLs or file dumps. Report only what you actually inspected.
Reply with ONLY a JSON object, no fence: {"summary":"3 to 5 sentences","verification":["what you inspected and what you found"],"needsInput":"only if the user must decide something"}`;
  }
  const w=this.worker(a),dependencies=a.dependsOn.map(id=>{const d=this.assignment(id);return {summary:d.summary,artifacts:d.artifacts.map(f=>f.path),verification:d.verification};});
  const peers=this.data.assignments.filter(k=>k.projectId===a.projectId&&k.id!==a.id&&!k.kind&&['queued','working','waiting','review'].includes(k.status)).map(k=>({role:this.worker(k).role,title:k.title,responsibility:this.worker(k).responsibility,status:k.status,artifacts:k.artifacts.map(f=>f.path)}));
  return `You are an execution agent in a personal agency. Donna's brain, the lead, assigned your responsibilities. All output and files must be in English. ${w.name?`Your established name is ${w.name}; keep it.`:'Choose your own short English personal name. Do not use a preassigned name.'}
ROLE: ${w.role}\nRESPONSIBILITY: ${w.responsibility}\nPROJECT GOAL: ${p.goal}\nCURRENT CHECKPOINT: ${p.memory.checkpoint}
ASSIGNMENT (revision ${a.revision}): ${a.brief}\nACCEPTANCE: ${a.acceptance}
PROJECT DIRECTORY: ${a.cwd}\nDEPENDENCY DELIVERABLES: ${JSON.stringify(dependencies)}\nOTHER ASSIGNED WORK: ${JSON.stringify(peers)}
RELEVANT DECISIONS: ${JSON.stringify(this.data.decisions.filter(d=>d.projectId===a.projectId&&d.status==='decided').slice(-8))}
Execute the task now using your native tools. Keep the implementation minimal; use existing tools and the standard library when practical. Stay focused on your assigned scope and avoid duplicating peer deliverables. Do not start additional agents or sessions; the lead owns staffing. Inspect existing project files before changing them. Work only inside the project directory; do not read private credentials, unrelated workspaces or sessions. Never create fake success records, invented test outcomes or mock results presented as real. Keep existing unrelated files. Verify behavior with proportional meaningful checks; do not build an exhaustive test framework for a small change. Report actual commands and limitations honestly. No external sending, publishing, payment or destructive unrelated operations are authorized. If essential information is missing, explain it in needsInput and stop safely.
At completion your LAST message MUST be only a JSON object (no fence) with {"name":"your chosen name","summary":"what actually changed and any limitations","artifacts":["relative/path/to/actual/nonempty/file"],"verification":["actual command and observed result"],"needsInput":"only if blocked"}. Artifacts must exist inside the project directory; do not list generated dependencies, secrets or absolute paths. Your native session owns detailed conversation and tool history; no separate transcript file is needed.`;
 }
 /** One state-derived line the voice can quote for "how's it going?"; undefined when nothing was ever delegated. */
 progress(projectId:string):string|undefined{
  const as=this.data.assignments.filter(a=>a.projectId===projectId),plan=as.filter(a=>a.kind==='plan').at(-1);if(!plan)return;
  if(plan.status!=='done')return `Your brain is planning "${plan.brief.slice(0,120)}" (${plan.status})${['failed','paused'].includes(plan.status)&&plan.error?`: ${plan.error}`:''}`;
  // ponytail: overlapping rounds report the newest review only
  const review=as.filter(a=>a.kind==='review').at(-1);if(!review)return 'Plan done.';
  const crew=review.dependsOn.map(id=>as.find(a=>a.id===id)).flatMap(a=>a?[a]:[]).map(a=>{const w=this.worker(a);return `${w.name||w.role}: ${a.status}${a.status==='working'&&w.currentAction?` (${w.currentAction})`:''}`;});
  const r={queued:'waits for the team',working:'you are reviewing their work now',review:'done; the briefing is ready',done:'accepted'}[review.status as string]||review.status;
  return `Plan done. Team: ${crew.join('; ')}. Review: ${r}`;
 }
 /** Apply a brain step's reply: a plan staffs the team and queues the review; a review writes the briefing. */
 private lead(a:Assignment,text:string){
  const p=this.project(a.projectId);
  if(a.kind==='plan'){
   const plan=parsePlan(text),{assignments}=this.staff(a.projectId,plan);
   const review:Assignment={id:randomUUID(),projectId:a.projectId,workerId:a.workerId,provider:'claude',kind:'review',title:plan.title,brief:a.brief,acceptance:'Every deliverable checked against its acceptance; one briefing written.',status:'queued',revision:1,cwd:a.cwd,sessionId:a.sessionId,dependsOn:assignments.map(x=>x.id),reasoningEffort:'medium',artifacts:[]};
   this.data.assignments.push(review);a.summary=plan.rationale;a.completedAt=now();this.state(a,'done','Plan delivered');
   Object.assign(this.worker(a),{assignmentId:review.id,status:'queued',currentAction:'Waiting for the team to deliver'});
   this.log(`Donna planned ${assignments.length} worker(s) for ${plan.title}`,a.projectId);this.save();return;
  }
  const r=brainReviewSchema.parse(lastJson(text));
  a.summary=r.summary+(r.needsInput?`\n\nNeeds your input: ${r.needsInput}`:'');a.verification=r.verification;a.completedAt=now();this.state(a,'review','Briefing written; awaiting your review');
  Object.assign(p.memory,{latest:`Donna reviewed: ${r.summary.slice(0,1200)}`,nextStep:r.needsInput||'Hear the briefing and review the deliverables.',updatedAt:now()});
  this.log(`Donna reviewed: ${a.title}`,a.projectId);
  if(r.needsInput)this.decide({project_id:a.projectId,title:`Input needed: ${a.title}`,context:r.needsInput,status:'open'});
  this.save();
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
    if(a.kind)a.sessionId??=this.worker(a).sessionId;
    const beforeHealth=a.revision,runner=this.runner(a),name=label(a.provider);
    if(!runner){a.error='Claude Code is not connected in this office';this.state(a,'failed',a.error);this.log(a.error,a.projectId);this.save();continue;}
    const health=await runner.status();
    if(this.stopped)break;
    if(a.status!=='queued'||a.revision!==beforeHealth)continue;
    if(!health.available||health.authenticated===false||health.modelAvailable===false){a.error=health.error||`Local ${name} needs authentication`;this.state(a,'failed',a.error);this.log(a.error,a.projectId);this.save();continue;}
    const revision=a.revision,runId=randomUUID();a.runId=runId;a.startedAt=now();a.completedAt=undefined;a.error=undefined;this.current={id:a.id,runId,threadId:a.sessionId};this.state(a,'working',a.kind?(a.kind==='plan'?'Planning the team':'Reviewing the team\'s work'):a.sessionId?`Resuming native ${name} session`:`Creating native ${name} session; agent will name itself`);this.log(`Local ${name} started: ${a.title}`,a.projectId);this.save();const started=performance.now();
    try{
     const result=await runner.run({cwd:a.cwd,threadId:a.sessionId,reasoningEffort:a.reasoningEffort||'low',prompt:this.prompt(a),onThread:id=>{a.sessionId=id;this.worker(a).sessionId=id;if(this.current?.runId===runId)this.current.threadId=id;if(a.status!=='working')void runner.interrupt(id).catch(()=>{});this.save();},onEvent:e=>{if(a.revision!==revision||a.runId!==runId||a.status!=='working')return;const item=e.params?.item;let action:string|undefined;if(e.method==='item/started'&&item?.type==='commandExecution')action=`Running: ${String(item.command||'local command').slice(0,180)}`;if(e.method==='item/started'&&item?.type==='fileChange')action='Updating project files';if(e.method==='claude/assistant'){const blocks=e.params?.message?.content,tool=Array.isArray(blocks)?blocks.find((c:any)=>c?.type==='tool_use'):undefined;if(tool)action=['Edit','Write'].includes(tool.name)?'Updating project files':'Reading project files';}if(action){this.worker(a).currentAction=action;this.save();}}});
     appendFileSync(resolve(this.store.root,'executions.jsonl'),JSON.stringify({at:now(),assignmentId:a.id,projectId:a.projectId,provider:a.provider||'codex',runId,revision,threadId:result.threadId,turnId:result.turnId,status:result.status,model:result.model,reasoningEffort:result.reasoningEffort,elapsedMs:performance.now()-started,usage:result.usage,usageMissing:result.usage===undefined,error:result.error,usageScope:'Native thread total is cumulative. Do not sum totals from resumed runs.'})+'\n');
     // Pausing or revising the task invalidates an old completion, even if cancellation races.
     if(!this.isCurrent(a,revision,runId))continue;
     a.elapsedMs=performance.now()-started;a.tokens=result.usage;a.usageMissing=result.usage===undefined;a.sessionId=result.threadId||a.sessionId;this.worker(a).sessionId=a.sessionId;
     if(result.status!=='completed')throw Error(result.error||`Native ${name} turn ${result.status}`);
     if(a.kind){this.lead(a,result.text);continue;}
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
 close(){this.stopped=true;clearTimeout(this.wake);this.codex.close();this.options.claude?.close();this.options.brain?.close();}
}
