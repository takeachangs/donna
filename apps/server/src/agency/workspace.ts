import {randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,realpathSync,statSync,appendFileSync,copyFileSync,cpSync,readdirSync} from 'node:fs';
import {resolve,relative,isAbsolute,sep,basename} from 'node:path';
import {z} from 'zod';
import {OfficeStore} from './state.js';
import {Projects} from './projects.js';
import {reconcileBriefings,type Briefing} from './briefings.js';
import {agentEvents,agentName,dur,statusSentence,type AgentEvent,type CrewView} from './transcript.js';
import {commitAll,gitDir,merge,openPr,push,redact,removeCheckout,report,secretFiles,startJob,useJob,workerCheckout,type JobGit} from './git.js';
import {createProjectSchema,roomName,workPlanSchema,validateDependencies,goalSchema,parsePlan,lastJson,brainReviewSchema} from './plans.js';

export type ExecutionStatus='queued'|'working'|'waiting'|'review'|'done'|'paused'|'failed';
export type Artifact={path:string;url:string;size:number;storage?:string;snapshotAt?:string};
export type Provider='codex'|'claude';
export type Worker={id:string;projectId:string;provider?:Provider;lead?:true;name?:string;role:string;responsibility:string;characterKey:string;status:ExecutionStatus;sessionId?:string;assignmentId:string;currentAction?:string;actionAt?:string};
export type Assignment={id:string;projectId:string;workerId:string;provider?:Provider;kind?:'plan'|'review';title:string;brief:string;acceptance:string;status:ExecutionStatus;revision:number;runId?:string;cwd:string;sessionId?:string;dependsOn:string[];reasoningEffort?:'low'|'medium';summary?:string;artifacts:Artifact[];verification?:string[];git?:JobGit;network?:true;error?:string;startedAt?:string;completedAt?:string;tokens?:unknown;usageMissing?:boolean;elapsedMs?:number;createdAt?:string;agent?:{toolUseId:string;taskId?:string;brainId:string;model?:string;effort?:string}};
export type Decision={id:string;projectId:string;title:string;context:string;options?:string[];action?:{kind:'install';command:string}|{kind:'merge';branch:string;worker:string;jobId:string}|{kind:'ask';assignmentId:string};status:'open'|'decided';decision?:string;reason?:string;createdAt:string;updatedAt:string};
export type ProjectOverview={id:string;name:string;priority?:number;deletedAt?:string;path?:string;git?:boolean;goal:string;memory:{outcome:string;checkpoint:string;latest:string;nextStep:string;updatedAt:string}};
export type Workspace={revision:number;secretary:{id:'mara';name:string;role:'Secretary';voice:'eleanor';characterKey:string};projects:ProjectOverview[];workers:Worker[];assignments:Assignment[];decisions:Decision[];briefings:Briefing[];activity:{at:string;projectId?:string;message:string}[];inbox?:{projectId:string;worker:string;text:string;at:string}[]};
export type Sandbox={write:string[];deny:string[];secrets:string[];network:boolean;addDir:string};
export interface CodexRunner {
 status():Promise<{available:boolean;authenticated?:boolean;version?:string;error?:string;model?:string;reasoningEffort?:string;modelAvailable?:boolean}>;
 run(input:{cwd:string;prompt:string;threadId?:string;reasoningEffort?:'low'|'medium';sandbox?:Sandbox;onThread?:(id:string)=>void;onEvent?:(event:any)=>void}):Promise<{threadId:string;turnId?:string;text:string;status:'completed'|'failed'|'interrupted';usage?:unknown;error?:string;model?:string;reasoningEffort?:string}>;
 interrupt(threadId:string):Promise<void>;
 inject?(threadId:string,text:string):boolean;
 close():void;
}
const now=()=>new Date().toISOString();
const norm=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const stop=new Set(['make','build','create','please','can','you','could','would','want','need','the','and','with','that','where','which','using','for','from','into']);
const words=(s:string)=>new Set((s.toLowerCase().match(/[a-z0-9]{3,}/g)||[]).filter(w=>!stop.has(w)));
const similar=(a:string,b:string)=>{const x=words(a),y=words(b),both=[...x].filter(w=>y.has(w)).length;return both>0&&both/(x.size+y.size-both)>=0.5;};
const label=(p?:Provider)=>p==='claude'?'Claude Code':'Codex';
const text=z.string().trim().min(1);
const repo=resolve(import.meta.dirname,'../../../..'),inUse=['queued','working','waiting'],looks=['char-male-d','char-female-e','char-male-b','char-female-d'];
const resultSchema=z.object({name:text.max(40),summary:text.max(12000),artifacts:z.array(text.max(500)).max(30),verification:z.array(z.string().max(3000)).max(20),needsInput:z.string().max(3000).optional()});

/** Product state is an index and compact brief. Native Codex owns conversation history. */
export class AgencyWorkspace {
 private data:Workspace;private dir:string;private office:string;private asks=new Map<string,number>();private running=false;private stopped=false;private wake?:ReturnType<typeof setTimeout>;private current=new Map<string,{id:string;runId:string;threadId?:string}>();private poke?:()=>void;private seen=new Map<string,{files:Set<string>;said?:string}>();
 constructor(private store:OfficeStore,private projects:Projects,private codex:CodexRunner,private notify:(workspace:Workspace)=>void=()=>{},private options:{autoStart?:boolean;claude?:CodexRunner;brain?:CodexRunner;defaultProvider?:Provider}={}){
  this.dir=realpathSync(store.root);this.office=resolve(this.dir,'office');
  const p=resolve(store.root,'workspace.json');
  this.data=existsSync(p)?JSON.parse(readFileSync(p,'utf8')):{revision:0,secretary:{id:'mara',name:'Donna',role:'Secretary',voice:'eleanor',characterKey:'char-female-b'},projects:[],workers:[],assignments:[],decisions:[],briefings:[],activity:[]};
  const needsBriefings=!this.data.briefings;this.data.briefings??=[];
  // Adopt the user's chosen name without changing IDs, voices or project history.
  if(['Secretary','Mara'].includes(this.data.secretary.name)){this.data.secretary.name='Donna';this.save();}
  this.syncProjects();
  this.skills();
  if(needsBriefings||reconcileBriefings(this.data.briefings,this.data.assignments,this.data.workers))this.save();
 }
 snapshot():Workspace{return structuredClone(this.data);}
 syncProjects(){
  let changed=false;
  for(const p of this.projects.list(true)){
   if(p.deletedAt)for(const a of this.data.assignments.filter(a=>a.projectId===p.id&&['working','queued','waiting'].includes(a.status))){a.revision++;this.state(a,'paused','Project is in Recently deleted; files and session retained');changed=true;}
   const known=this.data.projects.find(k=>k.id===p.id);
   if(known){if(known.name!==p.name||known.deletedAt!==p.deletedAt||known.path!==p.path||known.git!==p.git){known.name=p.name;known.deletedAt=p.deletedAt;known.path=p.path;known.git=p.git;changed=true;}continue;}
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
 // ponytail: word-overlap heuristic inside a 2-minute window; a genuinely different follow-up passes, a paraphrase of in-flight work does not.
 private inFlight(goal:string,projectId?:string):Assignment|undefined{return this.data.assignments.find(a=>a.kind&&['queued','working'].includes(a.status)&&(!projectId||a.projectId===projectId)&&(norm(a.brief)===norm(goal)||(!!a.createdAt&&Date.now()-Date.parse(a.createdAt)<120000&&similar(a.brief,goal))));}
 createProject(value:unknown){
  const input=createProjectSchema.parse(value),raw=value as {path?:string;allow_non_git?:boolean},path=typeof raw?.path==='string'&&raw.path.trim()||undefined,goal=input.initial_work;
  if(goal&&!this.options.brain)throw Error('Donna\'s brain is not connected in this office');
  const dup=goal?this.inFlight(goal):undefined;
  if(dup){const p=this.project(dup.projectId);return {committed:false,planning:true,alreadyQueued:true,selected:true,project:{id:p.id,name:p.name},assignment:dup,note:`already queued: this goal is already in progress in "${p.name}", now the selected room. Tell the user it is in progress; do not hand it over again.`};}
  const name=path&&!input.name?basename(path.replace(/\/+$/,'')).slice(0,80)||roomName(undefined,goal||''):roomName(input.name,input.brief||goal||'');
  const project=this.projects.create({name,brief:input.brief.trim()||goal||'',path,allow_non_git:raw.allow_non_git});this.syncProjects();
  const existing='existing' in project,made=existing?`This folder already has the room "${project.name}"; it is now selected and keeps its memory. Later calls use project_id "selected". `:`Room "${project.name}" created and now selected; later calls use project_id "selected". `;
  if(!goal)return {committed:true,selected:true,project,executionStarted:false,note:made+(existing?'Nothing is queued':'Empty project created; nothing is queued')+'. If the user asked for work, call delegate_work for this project now, before speaking.'};
  const r=this.queue(this.project(project.id),goal);
  return {committed:true,selected:true,project,executionStarted:true,planning:true,assignment:r.assignment,assignments:[r.assignment],note:made+'Donna\'s brain is on this goal and picks the team itself. Do not delegate the same work again.'};
 }
 renameProject(id:string,value:unknown){this.project(id);const p=this.projects.rename(id,value);this.syncProjects();this.log(`Renamed project to ${p.name}`,id);this.save();return {committed:true,project:p};}
 deleteProject(id:string){const p=this.project(id);for(const a of this.data.assignments.filter(a=>a.projectId===id&&['working','queued','waiting'].includes(a.status))){a.revision++;this.state(a,'paused','Project moved to Recently deleted; files and session retained');}this.projects.setDeleted(id,true);this.syncProjects();this.log(`Moved ${p.name} to Recently deleted`,id);this.save();for(const a of this.data.assignments.filter(a=>a.projectId===id))this.halt(a);return {committed:true};}
 restoreProject(id:string){const p=this.projects.setDeleted(id,false);this.syncProjects();this.log(`Restored ${p.name}; paused work stays paused`,id);this.save();return {committed:true,project:p};}
 private assignment(id:string){const a=this.data.assignments.find(a=>a.id===id);if(!a)throw Error('Unknown assignment');return a;}
 private look(){return looks[this.data.workers.filter(k=>!k.lead).length%4];}
 /** Donna's brain and her subagents read their skills from one office folder (--add-dir); a room folder never gets a .claude. */
 private skills(){for(const n of ['donna-brain','donna-worker'])cpSync(resolve(repo,'skills',n),resolve(this.office,'.claude/skills',n),{recursive:true,force:true});}
 private wt(p:ProjectOverview){return resolve(this.dir,'worktrees',p.id);}
 /** Where a room's brain works: the job checkout of a git room, the folder itself for a non-git one, else a private workspace. */
 private cwd(p:ProjectOverview){if(p.path)return p.git?resolve(this.wt(p),'job'):p.path;const c=resolve(this.store.root,'workspaces',p.id);mkdirSync(c,{recursive:true});return c;}
 private worker(a:Assignment){return this.data.workers.find(w=>w.id===a.workerId)!;}
 private runner(a:Assignment){return a.kind?this.options.brain:a.provider==='claude'?this.options.claude:this.codex;}
 private engines(ps:(Provider|undefined)[]){if(ps.includes('claude')&&!this.options.claude)throw Error('Claude Code is not connected in this office');}
 private isCurrent(a:Assignment,revision:number,runId:string){return a.revision===revision&&a.runId===runId&&a.status==='working';}
 private state(a:Assignment,status:ExecutionStatus,action?:string){a.status=status;const w=this.worker(a);if(w.assignmentId===a.id){w.status=status;w.currentAction=action;}}
 private kick(){if(this.stopped)return;if(this.running){this.poke?.();return;}if(this.options.autoStart===false)return;clearTimeout(this.wake);this.wake=setTimeout(()=>void this.pump(),50);}
 /** Brain steps run one per project (the brain session is per project); Codex/Claude worker rows share one writer. ponytail: no cap on parallel rooms (each is one Opus session + up to 4 Sonnet subagents); add a cap if rate limits bite. */
 private lane(a:Assignment){return a.kind?a.projectId:'writer';}
 private halt(a:Assignment){const c=this.current.get(this.lane(a));if(c?.id===a.id&&c.threadId)void this.runner(a)?.interrupt(c.threadId).catch(()=>{});}
 /** Room priority: lower goes first, absent is 0. */
 private rank(projectId:string){return this.data.projects.find(p=>p.id===projectId)?.priority??0;}
 /** Live rooms, first to last; the sort is stable, so ties keep creation order. */
 rooms(){return this.data.projects.filter(p=>!p.deletedAt).sort((a,b)=>(a.priority??0)-(b.priority??0));}
 /** Queued rows that may start, in pick order: room rank first, then array order (stable). Only the one-writer lane competes on it. */
 private ready(){return this.data.assignments.filter(a=>a.status==='queued'&&!a.agent&&a.dependsOn.every(id=>{const d=this.assignment(id);return d.agent||['review','done'].includes(d.status);})).sort((a,b)=>this.rank(a.projectId)-this.rank(b.projectId));}
 setSecretary(value:unknown){const {name}=z.object({name:text.regex(/^[A-Za-z][A-Za-z '-]{0,39}$/)}).parse(value);if(this.data.secretary.name!=='Secretary'&&this.data.secretary.name!==name)throw Error('Secretary identity is already established.');this.data.secretary.name=name;this.save();return {committed:true,secretary:this.data.secretary};}
 updateProject(value:unknown){const a=z.object({project_id:z.string().uuid(),goal:text.max(2000).optional(),checkpoint:text.max(1000).optional(),next_step:text.max(1000).optional()}).parse(value),p=this.project(a.project_id);if(a.goal){p.goal=a.goal;p.memory.outcome=a.goal;}if(a.checkpoint)p.memory.checkpoint=a.checkpoint;if(a.next_step)p.memory.nextStep=a.next_step;p.memory.updatedAt=now();this.log('Updated project brief',p.id);this.save();return {committed:true,project:p};}
 /** The voice's entry: queue a planning step for Donna's brain, the project's persistent lead session. */
 delegate(value:unknown){
  const {project_id,goal}=z.object({project_id:z.string().uuid().optional(),goal:goalSchema}).parse(value);
  if(!this.options.brain)throw Error('Donna\'s brain is not connected in this office');
  if(!project_id){const r=this.createProject({brief:goal,initial_work:goal});return r as typeof r&{assignment:Assignment};}
  const p=this.project(project_id),dup=this.inFlight(goal,p.id);
  if(dup)return {committed:false,planning:true,alreadyQueued:true,assignment:dup,note:'already queued: this goal is already in progress here. Tell the user it is in progress; do not hand it over again.',progress:this.progress(p.id)};
  return this.queue(p,goal);
 }
 private queue(p:ProjectOverview,goal:string,network?:true,dependsOn:string[]=[]){
  let lead=this.data.workers.find(w=>w.projectId===p.id&&w.lead);
  if(!lead){lead={id:'lead-'+randomUUID(),projectId:p.id,provider:'claude',lead:true,name:this.data.secretary.name,role:'Lead',responsibility:'Plans the team, reviews its results and writes the briefing',characterKey:this.data.secretary.characterKey,status:'queued',assignmentId:''};this.data.workers.push(lead);}
  const cwd=this.cwd(p);
  const plan:Assignment={id:randomUUID(),projectId:p.id,workerId:lead.id,provider:'claude',kind:'plan',title:'Plan: '+goal.slice(0,170),brief:goal,acceptance:'A valid plan for this request',status:'queued',revision:1,cwd,sessionId:lead.sessionId,dependsOn:[...dependsOn],reasoningEffort:'medium',artifacts:[],createdAt:now(),...(network&&{network})};
  this.data.assignments.push(plan);const why=this.why(plan);Object.assign(lead,{assignmentId:plan.id,status:'queued',currentAction:why});
  Object.assign(p.memory,{latest:`Donna's brain on "${goal.slice(0,300)}": ${why}`,nextStep:"Donna's brain picks the team itself; hear the briefing when the work is done.",updatedAt:now()});
  this.log(`Donna's brain is planning: ${goal.slice(0,120)}`,p.id);this.save();this.kick();
  return {committed:true,planning:true,assignment:plan,note:`Donna's brain is on it and picks the team itself (${why}). Say it is being worked on; do not name workers or a team size.`};
 }
 /** Execute a plan from Donna's brain: create the workers and their queued assignments atomically. */
 staff(projectId:string,value:unknown){
  const a=workPlanSchema.parse(value),p=this.project(projectId);validateDependencies(a.workers);
  for(const w of a.workers)if(w.reuse_worker_id){const old=this.data.workers.find(k=>k.id===w.reuse_worker_id);if(!old||old.projectId!==p.id||old.lead||['queued','working','waiting'].includes(old.status))throw Error('Reused worker must belong to this project and be available');if((w.provider??old.provider??'codex')!==(old.provider??'codex'))throw Error(`Reused worker is bound to its native ${label(old.provider)} session; use a new worker for another engine`);}
   this.engines(a.workers.map(w=>w.provider??this.data.workers.find(k=>k.id===w.reuse_worker_id)?.provider??this.options.defaultProvider));
  const reused=a.workers.flatMap(w=>w.reuse_worker_id?[w.reuse_worker_id]:[]);if(new Set(reused).size!==reused.length)throw Error('Do not assign the same worker twice in one plan');
  const ids=new Map(a.workers.map(w=>[w.key,randomUUID()])),created:Assignment[]=[];
  p.memory.checkpoint=a.checkpoint;p.memory.nextStep='Execute the delegated work, then inspect the actual deliverables.';p.memory.latest=`Donna's brain staffed ${a.workers.length} work package(s). ${a.rationale}`;p.memory.updatedAt=now();
  const cwd=this.cwd(p);
  for(const [i,w] of a.workers.entries()){
   const id=ids.get(w.key)!,old=w.reuse_worker_id?this.data.workers.find(k=>k.id===w.reuse_worker_id):undefined,provider:Provider=w.provider??old?.provider??this.options.defaultProvider??'codex';
   const worker:Worker=old||{id:'worker-'+randomUUID(),projectId:p.id,provider,role:w.role,responsibility:w.responsibility,characterKey:this.look(),status:'queued',assignmentId:id};
   Object.assign(worker,{provider,role:w.role,responsibility:w.responsibility,status:'queued',assignmentId:id});if(!old)this.data.workers.push(worker);
   const assignment:Assignment={id,projectId:p.id,workerId:worker.id,provider,title:w.title||w.role,brief:w.brief,acceptance:w.acceptance,status:'queued',revision:1,cwd,sessionId:worker.sessionId,dependsOn:w.depends_on.map(d=>ids.get(d)!),reasoningEffort:w.reasoning_effort,artifacts:[]};
   this.data.assignments.push(assignment);created.push(assignment);
  }
  for(const x of created)this.worker(x).currentAction=this.why(x);
  this.log(`Donna's brain allocated ${a.workers.length} worker(s): ${a.rationale}`,p.id);this.save();this.kick();return {committed:true,assignments:created,workers:created.map(a=>this.worker(a))};
 }
 revise(value:unknown){const v=z.object({assignment_id:text,brief:text.max(6000),acceptance:text.max(2000).optional(),title:text.max(180).optional()}).parse(value),a=this.assignment(v.assignment_id);if(a.agent)throw Error("Use message_worker to change a subagent's work");this.project(a.projectId);a.brief=v.brief;if(v.acceptance)a.acceptance=v.acceptance;if(v.title)a.title=v.title;a.revision++;a.error=undefined;this.state(a,'queued','Requirements updated; awaiting execution');this.log(`Revised assignment: ${a.title}`,a.projectId);this.save();this.halt(a);this.kick();return {committed:true,assignment:a};}
 pause(id:string):{committed:boolean;assignment:Assignment}{const a=this.assignment(id);if(a.agent)return this.pause(a.agent.brainId);this.project(a.projectId);if(a.status==='done')throw Error('Accepted work is already complete');a.revision++;this.state(a,'paused','Paused by the user; files retained');for(const c of this.data.assignments.filter(c=>c.agent?.brainId===id&&c.status==='working'))this.state(c,'paused','Paused with Donna\'s brain; it re-checks this on its next turn');this.log(`Paused: ${a.title}`,a.projectId);this.save();this.halt(a);return {committed:true,assignment:a};}
 resume(id:string):{committed:boolean;assignment:Assignment}{const a=this.assignment(id);if(a.agent)return this.resume(a.agent.brainId);this.project(a.projectId);if(!['paused','failed','waiting'].includes(a.status))throw Error('Only paused, failed or waiting work can resume');a.revision++;a.error=undefined;this.state(a,'queued','Queued to resume its native session');this.log(`Queued resume: ${a.title}`,a.projectId);this.save();this.kick();return {committed:true,assignment:a};}
 accept(id:string){const a=this.assignment(id);this.project(a.projectId);if(a.status!=='review')throw Error('Only a delivered result can be accepted');for(const f of a.artifacts)this.artifact(a.id,f.path);this.state(a,'done','Accepted by the user');this.log(`Accepted: ${a.title}`,a.projectId);this.save();return {committed:true,assignment:a};}
 decide(value:unknown){const v=z.object({id:text.optional(),project_id:z.string().uuid().optional(),title:text.max(500).optional(),context:z.string().max(4000).optional(),options:z.array(text.max(500)).max(6).optional(),status:z.enum(['open','decided']),decision:text.max(2000).optional(),reason:z.string().max(3000).optional()}).parse(value);let d=v.id?this.data.decisions.find(d=>d.id===v.id):undefined;const was=d?.status;if(v.id&&!d)throw Error('Unknown decision');const pid=d?.projectId??v.project_id;if(!pid)throw Error('A project is required');const p=this.project(pid);if(v.status==='decided'&&!v.decision)throw Error('A decision needs an explicit outcome');if(!d){if(!v.title)throw Error('A decision title is required');d={id:randomUUID(),projectId:p.id,title:v.title,context:v.context||'',status:v.status,createdAt:now(),updatedAt:now()};this.data.decisions.push(d);}Object.assign(d,{status:v.status,updatedAt:now()});if(v.title)d.title=v.title;if(v.context!==undefined)d.context=v.context;if(v.options)d.options=v.options;if(v.decision)d.decision=v.decision;if(v.reason!==undefined)d.reason=v.reason;this.log(v.status==='decided'?`Decision: ${d.decision}${d.reason?' — '+d.reason:''}`:`Needs a decision: ${d.title}`,p.id);p.memory.updatedAt=now();this.save();if(d.action&&was==='open'&&v.status==='decided')this.act(d,p);return {committed:true,decision:d};}
/** An answered decision that carries an action is applied after it is saved: yes opens the install turn, or takes the worker's side of a conflict. */
 private act(d:Decision,p:ProjectOverview){
  const x=d.action!,yes=/^\s*(?:yes|yeah|yep|sure|ok(?:ay)?|go ahead|do it|allow|approve|use|take)\b/i.test(d.decision||'');
  if(x.kind==='install'){if(yes)this.queue(p,`The user said yes to this install: ${x.command}. Package registries are reachable for this turn only; run it, then finish the job and end with the final JSON.`,true);else{this.log(`Install declined: ${x.command}`,p.id);this.save();}return;}
  if(x.kind==='ask'){const s=this.assignment(x.assignmentId);if(s.status==='waiting'){s.completedAt=now();s.summary=`Answered: ${d.decision}`;this.state(s,'done','Question answered');}this.queue(p,`The user answered your question "${d.title}": ${d.decision}`,undefined,s.dependsOn);return;}
  let failed='';
  if(yes)try{const m=merge(this.assignment(x.jobId).cwd,x.branch,'theirs');if(!m.ok)failed=` The merge still failed in ${m.files.join(', ')}.`;}catch(e){failed=` The merge failed: ${String((e as Error).message).slice(0,200)}.`;}
  this.queue(p,`The user decided the merge conflict for ${x.worker}'s work: "${d.decision}". The office applied it. Re-check the PROJECT DIRECTORY, run the tests, and end with the final JSON.${failed}`);
 }
 /** The latest finished brain step with a job branch; refuses while anything in the room is still running. */
 private finished(projectId:string){
  if(this.data.assignments.some(a=>a.projectId===projectId&&inUse.includes(a.status)))throw Error('Work in this room is still in progress; wait for it to finish.');
  const job=this.data.assignments.filter(a=>a.projectId===projectId&&a.kind&&a.git&&['review','done'].includes(a.status)).at(-1);
  if(!job)throw Error('There is no finished job branch to open a pull request for.');
  return job;
 }
 /** Push the job branch and open the pull request. The caller has the user's yes. */
 openPullRequest(projectId:string){
  const p=this.project(projectId),job=this.finished(p.id),g=job.git!;
  if(g.prUrl)return {committed:false,url:g.prUrl,note:'already open'};
  Object.assign(g,report(job.cwd,g.baseSha));
  const body=redact(`${job.summary||job.title}\n\n## Verification\n${(job.verification||[]).map(v=>`- ${v}`).join('\n')||'None recorded.'}\n\n## Changes\n\`\`\`\n${g.diffStat}\n\`\`\`\n\n## Commits\n${g.commits!.map(c=>`- ${c}`).join('\n')}\n\nOpened by Donna (Chamber) after the user said yes.`);
  push(g.repo,g.branch);
  const url=openPr(g.repo,{branch:g.branch,base:g.base,title:job.title,body});
  for(const x of this.data.assignments)if(x.projectId===p.id&&x.git?.branch===g.branch)x.git.prUrl=url;
  for(const b of this.data.briefings)if(b.projectId===p.id&&b.git?.branch===g.branch)b.git.prUrl=url;
  const wt=this.wt(p);if(existsSync(wt))for(const d of readdirSync(wt))if(d!=='job')removeCheckout(g.repo,resolve(wt,d));
  this.log(`Opened a pull request: ${job.title}`,p.id);this.save();
  return {committed:true,url,branch:g.branch,note:'Say "the pull request is up" in one short sentence; never read the URL aloud.'};
 }
 /** The voice's entry. A confirm only counts when the user spoke after the question was asked, so the model cannot answer for them. */
 pullRequest(value:unknown,userAt:number){
  const v=z.object({project_id:z.string().uuid().optional(),confirm:z.boolean().optional()}).parse(value);
  if(!v.project_id)throw Error('Select the room first.');
  const p=this.project(v.project_id),g=this.finished(p.id).git!;
  if(g.prUrl)return {committed:false,url:g.prUrl,note:'already open'};
  const asked=this.asks.get(p.id);
  if(!v.confirm||asked===undefined||userAt<=asked){this.asks.set(p.id,Date.now());return {committed:false,needsConfirmation:true,question:`Open a pull request for "${this.finished(p.id).title}" from ${g.branch} into ${g.base}?`,note:'Ask the user exactly this in one short sentence and wait. Call again with confirm true only after they say yes.'};}
  this.asks.delete(p.id);return this.openPullRequest(p.id);
 }
 artifact(id:string,path:string,version?:string){const a=this.assignment(id);let files=a.artifacts;if(version){if(!/^[a-f0-9-]{36}$/.test(version))throw Error('Invalid artifact version');const candidate=resolve(this.store.root,'deliveries',a.id,version,'manifest.json');if(!existsSync(candidate))throw Error('Unknown artifact version');const manifest=this.safeFile(resolve(this.store.root,'deliveries'),`${a.id}/${version}/manifest.json`);files=JSON.parse(readFileSync(manifest,'utf8'));}const f=files.find(f=>f.path===path);if(!f)throw Error('Artifact is not listed for this assignment');return f.storage?this.safeFile(resolve(this.store.root,'deliveries'),f.storage):this.safeFile(a.cwd,path);}
 private safeFile(cwd:string,path:string){if(isAbsolute(path)||/^[A-Za-z]:|^\\\\/.test(path))throw Error('Artifact must be relative to the project directory');const base=realpathSync(cwd),file=realpathSync(resolve(cwd,path)),rel=relative(base,file);if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('Artifact escapes the project directory');if(!statSync(file).isFile())throw Error('Artifact must be a regular file');return file;}
 async recover(){for(const a of this.data.assignments){if(a.status==='working'){a.revision++;this.state(a,'paused',a.agent?"Unknown after restart; Donna's brain re-checks it on its next turn":'Execution host restarted. Resume the saved native session.');this.log(`Host restarted; native session retained for ${a.title}`,a.projectId);}}this.save();this.kick();}
 private prompt(a:Assignment){
  const p=this.project(a.projectId);
  if(a.kind==='plan'){
   const mine=this.data.workers.filter(k=>k.projectId===p.id&&!k.lead&&k.name),last=(k:Worker)=>this.data.assignments.find(x=>x.id===k.assignmentId)?.title;
   const team=mine.map(k=>({name:k.name,status:k.status,lastTask:last(k)})),others=this.data.workers.filter(k=>k.projectId!==p.id&&!k.lead&&k.name).map(k=>k.name),recent=this.data.assignments.filter(k=>k.projectId===p.id&&!k.kind).slice(-8).map(k=>({title:k.title,status:k.status,summary:k.summary?.slice(0,300),artifacts:k.artifacts.map(f=>f.path)})),decided=this.data.decisions.filter(d=>d.projectId===p.id&&d.status==='decided').slice(-8);
   const restart=this.data.assignments.filter(x=>x.agent&&x.projectId===p.id&&x.status==='paused').map(x=>({name:this.worker(x).name,lastTask:x.title}));
   const rules=p.path?['CLAUDE.md','AGENTS.md'].filter(f=>existsSync(resolve(a.cwd,f))):[];
   const where=`${a.git?`REPOSITORY: ${a.git.repo} (the user's checkout; never touch it)\nJOB BRANCH: ${a.git.branch} from ${a.git.base}; PROJECT DIRECTORY is its checkout, read-only for you and the workers: the office commits each worker's checkout and merges it there; never run git commands that write.\nWORKER CHECKOUTS: ${this.wt(p)}/<Name> (one per worker, created by the office when you spawn it; Name = the Agent name)\n`:''}${rules.length?`REPO RULES: ${rules.join(', ')} - read them first and pass the relevant rules into every brief\n`:''}NETWORK: ${a.network?'on for this turn: package registries only':'off - a needed install goes into "install" in your final JSON'}\n`;
   const inbox=this.data.inbox??=[],mail=inbox.filter(m=>m.projectId===p.id);this.data.inbox=inbox.filter(m=>m.projectId!==p.id);
   return `Follow the donna-brain skill.
PROJECT: ${p.name}\nPROJECT GOAL: ${p.goal}\nMEMORY: ${JSON.stringify(p.memory)}\nPROJECT DIRECTORY: ${a.cwd}
TEAM IN THIS ROOM: ${JSON.stringify(team)}\nNAMES IN USE IN OTHER ROOMS: ${JSON.stringify(others)}\nRECENT WORK: ${JSON.stringify(recent)}\nDECISIONS: ${JSON.stringify(decided)}
${where}${restart.length?`RESTART: ${JSON.stringify(restart)}\n`:''}${mail.map(m=>`MESSAGE FOR ${m.worker} (from the user, through Donna's voice): ${m.text}\n`).join('')}REQUEST: ${a.brief}`;
  }
  if(a.kind==='review'){
   const deliveries=a.dependsOn.map(id=>{const d=this.assignment(id),w=this.worker(d);return {worker:w.name,role:w.role,title:d.title,acceptance:d.acceptance,status:d.status,summary:d.summary,artifacts:d.artifacts.map(f=>f.path),verification:d.verification};});
   return `Follow the donna-brain skill: review this Codex team's delivery and end with the final JSON.\nREQUEST: ${a.brief}\nPROJECT DIRECTORY: ${a.cwd}\nDELIVERIES: ${JSON.stringify(deliveries)}`;
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
 /** What a row waits on, in words the voice can say. */
 private why(a:Assignment):string{
  const as=this.data.assignments,w=this.worker(a),act=w.assignmentId===a.id?w.currentAction:undefined,lc=(t:string)=>t[0].toLowerCase()+t.slice(1),short=(x:Assignment)=>(x.kind==='plan'?x.brief:x.title).replace(/\s+/g,' ').slice(0,60);
  if(a.status==='paused')return !act?'paused':/^paused/i.test(act)?lc(act):`paused (${lc(act)})`;
  if(a.status==='failed')return `stopped: ${(a.error||'unknown error').replace(/^Error:\s*/,'').slice(0,120)}`;
  const ask=this.data.decisions.filter(d=>d.projectId===a.projectId&&d.status==='open').at(-1),dep=a.dependsOn.map(id=>this.assignment(id)).find(d=>!d.agent&&!['review','done'].includes(d.status));
  if(a.status==='waiting'&&ask)return `waiting for your answer on "${ask.title}"`;
  if(dep&&['queued','waiting'].includes(a.status)){const dw=this.worker(dep);return `waiting for ${dw.name||`the ${dw.role} worker`}'s "${short(dep)}" ${['queued','working'].includes(dep.status)?'to finish':`(${dep.status})`}`;}
  if(a.status!=='queued')return a.status;
  const l=this.lane(a),rd=this.ready(),ahead=[...as.filter(x=>x!==a&&!x.agent&&x.status==='working'&&this.lane(x)===l),...rd.slice(0,Math.max(0,rd.indexOf(a))).filter(x=>this.lane(x)===l)];
  if(!ahead.length)return 'starting now';
  const h=ahead[0],room=h.projectId===a.projectId?'':` in ${this.data.projects.find(p=>p.id===h.projectId)?.name}`;
  return `queued behind "${short(h)}"${room} (${ahead.length===1?'one job':`${ahead.length} jobs`} ahead)`;
 }
 /** One sentence about a subagent or Codex worker: what it is doing now, what it waits on, or how it ended. */
 private sentence(c:Assignment){const w=this.worker(c),name=w.name||`The ${w.role} worker`;if(['queued','waiting'].includes(c.status))return `${name} is ${this.why(c)}.`;const v:CrewView={name,status:c.status,title:c.title,action:w.assignmentId===c.id?w.currentAction:undefined,actionAt:w.assignmentId===c.id?w.actionAt:undefined,startedAt:c.startedAt,completedAt:c.completedAt,error:c.error};return statusSentence(v);}
 /** One state-derived line the voice can quote for "how's it going?"; undefined when nothing was ever delegated. */
 progress(projectId:string):string|undefined{
  const as=this.data.assignments.filter(a=>a.projectId===projectId),plan=as.filter(a=>a.kind==='plan').at(-1);if(!plan)return;
  const goal=`"${plan.brief.slice(0,120)}"`;
  if(plan.status==='working'){const crew=as.filter(c=>c.agent?.brainId===plan.id);return crew.length?`Donna's brain is on ${goal}: ${crew.map(c=>this.sentence(c)).join(' ')}`:`Donna's brain is reading the project and choosing the team for ${goal} (started ${dur(Date.now()-Date.parse(plan.startedAt||''))} ago).`;}
  if(plan.status==='waiting')return `Donna's brain is ${this.why(plan)}.`;
  if(plan.status==='review')return `"${plan.title}" is done; the briefing is ready.`;
  if(plan.status!=='done')return `Donna's brain on ${goal}: ${this.why(plan)}`;
  // ponytail: overlapping rounds report the newest review only
  const review=as.filter(a=>a.kind==='review').at(-1);if(!review)return `Donna's brain has planned ${goal}.`;
  const crew=review.dependsOn.map(id=>as.find(a=>a.id===id)).flatMap(a=>a?[a]:[]).map(a=>this.sentence(a)).join(' ');
  const r=review.status==='queued'&&!this.ready().includes(review)?'Donna reviews once the team is done.':review.status==='working'?'Donna is reviewing their work now.':review.status==='review'?"Donna's review is done; the briefing is ready.":review.status==='done'?'The briefing was accepted.':`Donna's review is ${this.why(review)}.`;
  return `${crew} ${r}`.trim();
 }
 /** Say aloud that rooms run side by side: two or more live rooms have a brain step or a worker running now. */
 parallel():string|undefined{
  const names=this.rooms().filter(p=>this.data.assignments.some(a=>a.projectId===p.id&&a.status==='working'&&!a.agent)).map(p=>`"${p.name}"`);
  if(names.length>1)return `Rooms run in parallel: ${names.slice(0,-1).join(', ')} and ${names.at(-1)} are ${names.length===2?'both':'all'} working now.`;
 }
 /** "do the site first", "pause the game": find the room by the name the user said (or the selected one), then reorder, pause or resume all of it. */
 setPriority(value:unknown,selected?:string){
  const v=z.object({room:text.max(80).default('selected'),action:z.enum(['first','last','pause','resume'])}).parse(value),live=this.rooms(),n=norm(v.room),sel=n==='selected',w=words(v.room);
  const hit=sel?live.filter(p=>p.id===selected):live.filter(p=>norm(p.name)===n),pool=hit.length||sel?hit:live.filter(p=>[...words(p.name)].some(x=>w.has(x)));
  if(pool.length!==1)throw Error(`${pool.length?`Which room is "${v.room}"?`:sel?'No room is selected.':`No room called "${v.room}".`} Rooms: ${live.map(p=>`"${p.name}"`).join(', ')||'none yet'}.`);
  const p=pool[0],q=`"${p.name}"`,others=live.filter(x=>x!==p).map(x=>x.priority??0);
  if(v.action==='first'||v.action==='last'){
   if(others.length)p.priority=v.action==='first'?Math.min(...others)-1:Math.max(...others)+1;
   this.log(`Room priority: ${p.name} goes ${v.action}`,p.id);this.save();
   return {committed:true,projectId:p.id,note:`The ${q} room ${v.action==='first'?'is first now':'goes last now'}. Rooms still run side by side; it goes ${v.action} when they compete (the Codex writer).`};
  }
  const pausing=v.action==='pause',todo=this.data.assignments.filter(a=>a.projectId===p.id&&!a.agent&&(pausing?['queued','working','waiting'].includes(a.status):a.status==='paused'));
  for(const a of todo)pausing?this.pause(a.id):this.resume(a.id);
  if(!todo.length)return {committed:false,projectId:p.id,note:pausing?`Nothing in ${q} is running or waiting, so there is nothing to pause.`:`Nothing in ${q} is paused.`};
  return {committed:true,projectId:p.id,note:pausing?`Paused ${q}; its files and sessions are kept.`:`Resumed ${q}; the paused work is queued again.`};
 }
 private named(worker:string,projectId?:string){
  const ws=this.data.workers.filter(w=>!w.lead&&w.name&&this.data.projects.some(p=>p.id===w.projectId&&!p.deletedAt)),n=norm(worker);
  const w=ws.filter(w=>norm(w.name!)===n).sort((a,b)=>Number(b.projectId===projectId)-Number(a.projectId===projectId))[0];
  if(!w)throw Error(`No worker called "${worker}". Known workers: ${ws.map(w=>w.name).join(', ')||'none yet'}.`);
  return w;
 }
 /** The status sentence(s) behind the voice's worker_status tool; "all" covers the selected room, or every room. */
 workerStatus(worker:string,projectId?:string):{committed:false;status:string}{
  const line=(w:Worker)=>{const c=this.data.assignments.find(a=>a.id===w.assignmentId);return c?this.sentence(c):`${w.name} is ${w.status}.`;};
  if(norm(worker)!=='all')return {committed:false,status:line(this.named(worker,projectId))};
  const live=this.rooms().filter(p=>!projectId||p.id===projectId).map(p=>p.id),ws=live.flatMap(id=>this.data.workers.filter(w=>w.projectId===id));
  const lead=(w:Worker)=>{const a=this.data.assignments.find(a=>a.id===w.assignmentId);return `Donna's brain: ${a&&['queued','waiting'].includes(a.status)?this.why(a):w.currentAction}`;};
  const par=projectId?undefined:this.parallel(),lines=[...ws.filter(w=>w.lead&&w.currentAction).map(lead),...ws.filter(w=>!w.lead&&(w.name||w.role)).slice(-8).map(line),...(par?[par]:[])];
  return {committed:false,status:lines.join(' ')||'Nobody is working yet.'};
 }
 /** Pass the user's words to a subagent through Donna's brain: into its live session if it is running now, else on its next turn. */
 message(value:unknown){
  const v=z.object({project_id:z.string().uuid().optional(),worker:text.max(80),text:text.max(2000)}).parse(value),w=this.named(v.worker,v.project_id),p=this.project(w.projectId);
  const line=`MESSAGE FOR ${w.name} (from the user, through Donna's voice): ${v.text}`,cur=this.current.get(p.id),live=cur&&this.data.assignments.some(a=>a.id===cur.id&&a.kind==='plan');
  const done=(delivered:'now'|'queued')=>{this.log(`Message for ${w.name} ${delivered==='now'?'sent':'queued'}: ${v.text.slice(0,100)}`,p.id);this.save();return {committed:true as const,delivered,worker:w.name!,note:`Donna's brain forwards it to ${w.name} ${delivered==='now'?'now':'on its next turn'}; tell the user you'll pass it on.`};};
  if(live&&cur!.threadId&&this.options.brain?.inject?.(cur!.threadId,line))return done('now');
  if(this.data.assignments.some(a=>a.kind==='plan'&&a.projectId===p.id&&['queued','working'].includes(a.status)))(this.data.inbox??=[]).push({projectId:p.id,worker:w.name!,text:v.text,at:now()});
  else this.queue(p,line);
  return done('queued');
 }
 private rel(cwd:string,file:string){const abs=resolve(cwd,file);let real=cwd;try{real=realpathSync(cwd);}catch{/* not created yet */}for(const b of [cwd,real]){const r=relative(b,abs);if(r&&r!=='..'&&!r.startsWith('..'+sep)&&!isAbsolute(r)&&!/^\.claude([\\/]|$)/.test(r))return r;}}
 /** Snapshot files into the delivery store. lenient: skip what is missing or empty instead of throwing. */
 private deliver(a:Assignment,runId:string,paths:string[],lenient=false):Artifact[]{
  const originals=[...new Set(paths)].flatMap(path=>{try{const file=this.safeFile(a.cwd,path),size=statSync(file).size;if(!size)throw Error(`Empty artifact: ${path}`);return [{path,file,size}];}catch(e){if(lenient)return [];throw e;}});
  const snapshotDir=resolve(this.store.root,'deliveries',a.id,runId);mkdirSync(snapshotDir,{recursive:true});
  const files=originals.map(({path,file,size},i)=>{const storage=`${a.id}/${runId}/${i}`;copyFileSync(file,resolve(snapshotDir,String(i)));return {path,size,storage,snapshotAt:now(),url:`/agency-api/assignments/${a.id}/files?path=${encodeURIComponent(path)}&version=${runId}`};});
  writeFileSync(resolve(snapshotDir,'manifest.json'),JSON.stringify(files,null,2));
  return files;
 }
 private endCrew(cs:Assignment[],why:string){for(const c of cs){c.error=why;c.completedAt=now();this.state(c,'failed',why);}}
 private finish(c:Assignment,ok:boolean,report?:string){
  const s=this.seen.get(c.id),job=c.git&&ok?this.data.assignments.find(x=>x.id===c.agent!.brainId):undefined,name=this.worker(c).name!;let conflict:string[]|undefined;c.summary=(report?.trim()||s?.said||'').slice(0,2000);c.completedAt=now();
  // Git room: the office commits the worker's checkout and merges it into the job branch; a conflict becomes a decision.
  if(job)try{const done=commitAll(c.cwd,`${name}: ${c.title}`);c.artifacts=this.deliver(c,c.runId!,done?.files??[...(s?.files??[])],true);const m=merge(job.cwd,c.git!.branch);if(!m.ok)conflict=m.files;}catch(e){ok=false;c.summary=`Could not merge this worker's changes: ${String((e as Error).message).slice(0,300)}`;}
  else if(ok)c.artifacts=this.deliver(c,c.runId!,[...(s?.files??[])],true);
  if(!ok)c.error=c.summary||'Subagent failed';
  this.state(c,ok?'review':'failed',"Reported to Donna's brain");this.worker(c).actionAt=now();this.seen.delete(c.id);
  this.log(`${name} ${ok?"reported to Donna's brain":'failed'}: ${c.title}`,c.projectId);
  if(conflict){
   const files=conflict.join(', '),d=this.decide({project_id:c.projectId,title:`Merge conflict: ${name}'s work`,context:`${name}'s changes conflict with the job branch in ${files}. Use ${name}'s version, or keep the current version?`,options:[`Use ${name}'s version`,'Keep the current version'],status:'open'}).decision;
   d.action={kind:'merge',branch:c.git!.branch,worker:name,jobId:job!.id};
   const t=this.current.get(c.projectId)?.threadId;if(t)this.options.brain?.inject?.(t,`MERGE CONFLICT: ${name}'s work conflicts in ${files}; it is not merged and the user decides. Say so in your summary.`);
  }
 }
 private spawn(a:Assignment,ev:Extract<AgentEvent,{kind:'spawn'}>){
  const base=agentName(ev.description,ev.name),id=randomUUID(),lc=(s?:string)=>(s||'').toLowerCase();let w:Worker|undefined;
  for(let i=1;!w;i++){
   const n=i>1?`${base} ${i}`:base,k=this.data.workers.find(k=>!k.lead&&lc(k.name)===lc(n));
   if(!k){w={id:'worker-'+randomUUID(),projectId:a.projectId,provider:'claude',name:n,role:'Subagent',responsibility:'',characterKey:this.look(),status:'working',assignmentId:id};this.data.workers.push(w);}
   else if(k.projectId===a.projectId&&!inUse.includes(k.status))w=k;
  }
  Object.assign(w,{responsibility:ev.description.slice(0,300),status:'working',assignmentId:id,currentAction:`Starting: ${ev.description.slice(0,120)}`,actionAt:now()});
  const lead=this.worker(a);if(lead.currentAction==='Reading the project and choosing the team')Object.assign(lead,{currentAction:'Leading the team while they work',actionAt:now()});
  // A git room gives every worker its own checkout, named as the brain was told: <worktrees>/<Name>. ponytail: a job-named or twice-used Name falls back to / shares a dir; the skill asks for unique names.
  const dir=a.git&&resolve(this.wt(this.project(a.projectId)),(ev.name||agentName(ev.description)).replace(/[^A-Za-z0-9-]/g,'').replace(/^job$/i,'')||'Worker');
  const row:Assignment={id,projectId:a.projectId,workerId:w.id,provider:'claude',title:ev.description.slice(0,180),brief:ev.prompt.slice(0,6000),acceptance:"Reports back to Donna's brain",status:'working',revision:1,runId:a.runId,cwd:dir||a.cwd,...(dir&&{git:{...a.git!}}),dependsOn:[],artifacts:[],startedAt:now(),createdAt:now(),agent:{toolUseId:ev.toolUseId,brainId:a.id,model:ev.model,effort:ev.effort}};
  this.data.assignments.push(row);this.checkout(a,row);
  // The brain step lists its crew as it spawns them, so no briefing is cut for one subagent before the brain's own.
  a.dependsOn.push(id);this.seen.set(id,{files:new Set()});this.log(`${w.name} started: ${ev.description.slice(0,120)}`,a.projectId);
 }
 /** A git-room worker works on a branch off the job branch in its own checkout; idempotent, so a removed checkout comes back. false (and the worker fails) when git refuses. */
 private checkout(a:Assignment,c:Assignment){
  if(!a.git||!c.git)return true;
  try{c.git={...a.git,branch:workerCheckout(a.git.repo,a.git.branch,c.cwd,basename(c.cwd))};return true;}
  catch(e){this.endCrew([c],`Could not create a checkout: ${String((e as Error).message).slice(0,300)}`);return false;}
 }
 /** A subagent from an earlier brain turn was resumed with SendMessage: give this turn its own crew row for the same worker. */
 private resumed(a:Assignment,old:Assignment){
  const id=randomUUID(),row:Assignment={id,projectId:a.projectId,workerId:old.workerId,provider:'claude',title:old.title,brief:"Resumed by Donna's brain",acceptance:old.acceptance,status:'working',revision:1,runId:a.runId,cwd:old.cwd,...(old.git&&{git:{...old.git}}),dependsOn:[],artifacts:[],startedAt:now(),createdAt:now(),agent:{...old.agent!,brainId:a.id}};
  this.data.assignments.push(row);this.worker(old).assignmentId=id;a.dependsOn.push(id);return row;
 }
 /** Turn the brain's live stream into workers: each Agent tool_use is a worker, its events are that worker's actions. */
 private observe(a:Assignment,e:any){
  const crew=this.data.assignments.filter(c=>c.agent&&c.projectId===a.projectId),byTool=(id?:string)=>crew.filter(c=>c.agent!.toolUseId===id).at(-1),byTask=(id?:string)=>id?crew.filter(c=>c.agent!.taskId===id).at(-1):undefined;
  const say=(w:Worker,action:string)=>{w.currentAction=action;w.actionAt=now();};
  if(!this.seen.has(a.id))this.seen.set(a.id,{files:new Set()});let dirty=false;
  for(const ev of agentEvents(e)){
   if(ev.kind==='spawn'){if(!byTool(ev.toolUseId)){this.spawn(a,ev);crew.push(this.data.assignments.at(-1)!);dirty=true;}continue;}
   if(ev.kind==='note'){say(this.worker(a),ev.text);dirty=true;continue;}
   if(ev.kind==='file'){const r=this.rel(a.cwd,ev.file);if(r)this.seen.get(a.id)?.files.add(r);continue;}
   if(ev.kind==='message'){const w=this.data.workers.find(w=>!w.lead&&w.projectId===a.projectId&&norm(w.name||'')===norm(ev.to));if(w){say(w,`Message from Donna's brain: ${ev.text.slice(0,60)}`);dirty=true;}continue;}
   if(ev.kind==='task'){const c=byTool(ev.toolUseId),r=c?undefined:byTask(ev.taskId);if(c)c.agent!.taskId=ev.taskId;else if(r){let x=r;if(r.agent!.brainId!==a.id){x=this.resumed(a,r);crew.push(x);}else x.completedAt=undefined;if(this.checkout(a,x)){this.seen.set(x.id,{files:new Set()});this.state(x,'working',"Resumed by Donna's brain");this.worker(x).actionAt=now();}dirty=true;}continue;}
   const c=ev.kind==='done'?byTask(ev.taskId)||byTool(ev.toolUseId):ev.kind==='action'||ev.kind==='said'?byTool(ev.parent):ev.kind==='result'?byTool(ev.toolUseId):undefined;
   if(!c||c.status!=='working')continue;
   if(ev.kind==='action'){const rd=ev.file&&this.rel(c.cwd,ev.file);if(rd&&ev.tool!=='Read')this.seen.get(c.id)?.files.add(rd);say(this.worker(c),rd&&ev.file?ev.action.replace(ev.file,rd):ev.action);}
   else if(ev.kind==='said'){const t=this.seen.get(c.id);if(t)t.said=ev.text;}
   else if(ev.kind==='result')this.finish(c,true,ev.report);
   else if(ev.kind==='done')this.finish(c,ev.ok,this.seen.get(c.id)?.said||ev.report);
   dirty=true;
  }
  if(dirty)this.save();
 }
 /** Apply a brain step's reply: a plan staffs the team and queues the review; a review writes the briefing. */
 private lead(a:Assignment,text:string){
  const p=this.project(a.projectId);
  if(a.kind==='plan'&&Array.isArray((lastJson(text) as {workers?:unknown})?.workers)){
   const plan=parsePlan(text),{assignments}=this.staff(a.projectId,plan);
   const review:Assignment={id:randomUUID(),projectId:a.projectId,workerId:a.workerId,provider:'claude',kind:'review',title:plan.title,brief:a.brief,acceptance:'Every deliverable checked against its acceptance; one briefing written.',status:'queued',revision:1,cwd:a.cwd,sessionId:a.sessionId,dependsOn:assignments.map(x=>x.id),reasoningEffort:'medium',artifacts:[],createdAt:now(),...(a.git&&{git:structuredClone(a.git)})};
   this.data.assignments.push(review);a.summary=plan.rationale;a.completedAt=now();this.state(a,'done','Plan delivered');
   Object.assign(this.worker(a),{assignmentId:review.id,status:'queued',currentAction:'Donna reviews once the team is done'});
   this.log(`Donna planned ${assignments.length} worker(s) for ${plan.title}`,a.projectId);this.save();return;
  }
  const r=brainReviewSchema.parse(lastJson(text)),q=(r.ask||r.needsInput)?.slice(0,500);r.summary=redact(r.summary);r.verification=r.verification.map(redact);
  if(a.kind==='plan'){this.wrapUp(a);a.title=r.title||a.brief.slice(0,120);}else if(a.git)this.seal(a);
  a.summary=r.summary;a.verification=r.verification;
  // A question parks the step as 'waiting' (needs you): no briefing until the answer's turn finishes the job.
  if(q)this.state(a,'waiting',`Waiting for your answer: ${q}`);else{a.completedAt=now();this.state(a,'review','Briefing written; awaiting your review');}
  Object.assign(p.memory,{latest:q?`Donna's brain is waiting for your answer: ${q}`:`Donna reviewed: ${r.summary.slice(0,1200)}`,nextStep:q?`Answer Donna's question: ${q}`:'Hear the briefing and review the deliverables.',updatedAt:now()});
  this.log(q?`Donna asks: ${q}`:`Donna reviewed: ${a.title}`,a.projectId);
  if(q)this.decide({project_id:a.projectId,title:q,context:r.summary.slice(0,4000),status:'open'}).decision.action={kind:'ask',assignmentId:a.id};
  if(r.install)this.decide({project_id:a.projectId,title:'Allow a package install',context:`Donna's brain wants to run: ${r.install}. Allow it? Package registries open for one turn.`,options:['Yes, allow it','No'],status:'open'}).decision.action={kind:'install',command:r.install};
  this.save();
  const mail=(this.data.inbox??[]).filter(m=>m.projectId===a.projectId);
  if(a.kind==='plan'&&mail.length&&!this.data.assignments.some(x=>x.kind==='plan'&&x.projectId===a.projectId&&x.status==='queued')){this.data.inbox=this.data.inbox!.filter(m=>m.projectId!==a.projectId);this.queue(p,mail.map(m=>`MESSAGE FOR ${m.worker} (from the user, through Donna's voice): ${m.text}`).join('\n'));}
 }
 /** Commit what the brain left in the job checkout and record what the job changed since its base. */
 private seal(a:Assignment){commitAll(a.cwd,"Donna's brain: review fixes");Object.assign(a.git!,report(a.cwd,a.git!.baseSha));}
 /** The brain's own turn is over: close out its crew and collect what it and they left in the project directory. */
 private wrapUp(a:Assignment){
  const crew=this.data.assignments.filter(c=>c.agent?.brainId===a.id);
  this.endCrew(crew.filter(c=>c.status==='working'),'Did not report back');
  this.endCrew(this.data.assignments.filter(c=>c.agent&&c.projectId===a.projectId&&c.status==='paused'),'Lost in a restart');
  a.dependsOn=a.dependsOn.filter(id=>['review','done'].includes(this.assignment(id).status));
  const covered=new Set(crew.flatMap(c=>c.artifacts.map(f=>f.path))),own=[...(this.seen.get(a.id)?.files??[])],started=Date.parse(a.startedAt||'')||0;
  if(a.git){this.seal(a);a.artifacts=this.deliver(a,a.runId!,a.git.files!.filter(f=>!covered.has(f)),true);return;}
  // ponytail: walks the whole directory tree once per turn; fine for a hackathon-sized room.
  const extra=readdirSync(a.cwd,{recursive:true}).map(String).filter(f=>!/(^|[\\/])(\.claude|node_modules|\.git)([\\/]|$)/.test(f)&&!covered.has(f)&&!own.includes(f)).filter(f=>{try{const t=statSync(resolve(a.cwd,f));return t.isFile()&&t.mtimeMs>=started;}catch{return false;}}).slice(0,30);
  a.artifacts=this.deliver(a,a.runId!,[...own,...extra],true);
 }
 /** A git room's plan step works on a job branch: continue the open one (follow-ups pile onto one PR), else start a fresh one from the user's HEAD. */
 private openJob(a:Assignment,p:ProjectOverview){
  const repo=p.path!,jobDir=this.cwd(p),wt=this.wt(p);mkdirSync(wt,{recursive:true});
  const open=a.git??this.data.assignments.filter(x=>x.id!==a.id&&x.projectId===p.id&&x.kind&&x.git&&!x.git.prUrl).at(-1)?.git;
  if(open&&useJob(repo,jobDir,open.branch)){a.git={repo,branch:open.branch,base:open.base,baseSha:open.baseSha};return;}
  if(existsSync(jobDir))commitAll(jobDir,"Donna's brain: unfinished changes");
  for(const d of readdirSync(wt))if(resolve(wt,d)!==jobDir)removeCheckout(repo,resolve(wt,d));
  a.git=startJob(repo,jobDir,a.brief.replace(/^\s*(?:please\s+)?attach\b.*?\band\s+/i,'').replace(/\S*\/\S*/g,' '));// ponytail: slug from the goal minus an "attach <path> and" lead and paths
 }
 /** What a brain step may write, read and reach. The git dir and the job checkout are denied: only the office writes git and merges, so a worker can write nowhere but its own checkout. */
 private sandbox(a:Assignment,p:ProjectOverview):Sandbox{
  if(p.git&&a.git){const wt=this.wt(p);mkdirSync(wt,{recursive:true});return {write:[wt],deny:[gitDir(a.git.repo),a.cwd],secrets:secretFiles([a.git.repo,a.cwd]),network:!!a.network,addDir:this.office};}
  return {write:[a.cwd],deny:[],secrets:secretFiles([a.cwd]),network:!!a.network,addDir:this.office};
 }
/** Each pass starts every ready row whose lane is free without awaiting it, then waits for a lane to finish or a kick. Resolves when nothing runs and nothing can start. */
 async pump(){
  if(this.running||this.stopped)return;this.running=true;
  const live=new Map<string,Promise<void>>();
  try{
   for(;;){
    if(this.stopped)break;
    let blockedChanged=false;
    for(const a of this.data.assignments.filter(a=>a.status==='queued')){const bad=a.dependsOn.map(id=>this.assignment(id)).find(d=>!d.agent&&['failed','paused','waiting'].includes(d.status));if(bad){this.state(a,'waiting',`Waiting for dependency: ${bad.title}`);a.error=`Dependency ${bad.title} is ${bad.status}; resume after it is resolved.`;blockedChanged=true;}}
    if(blockedChanged)this.save();
    for(const a of this.ready()){const l=this.lane(a);if(!live.has(l))live.set(l,this.execute(a).finally(()=>live.delete(l)));}
    if(!live.size)break;
    await Promise.race([...live.values(),new Promise<void>(r=>{this.poke=r;})]);
   }
  }finally{this.running=false;this.poke=undefined;}
 }
 private async execute(a:Assignment){
  const lane=this.lane(a);
  if(a.kind)a.sessionId??=this.worker(a).sessionId;
  const beforeHealth=a.revision,runner=this.runner(a),name=label(a.provider);
  if(!runner){a.error='Claude Code is not connected in this office';this.state(a,'failed',a.error);this.log(a.error,a.projectId);this.save();return;}
  const health=await runner.status();
  if(this.stopped)return;
  if(a.status!=='queued'||a.revision!==beforeHealth)return;
  if(!health.available||health.authenticated===false||health.modelAvailable===false){a.error=health.error||`Local ${name} needs authentication`;this.state(a,'failed',a.error);this.log(a.error,a.projectId);this.save();return;}
  const revision=a.revision,runId=randomUUID();a.runId=runId;a.startedAt=now();a.completedAt=undefined;a.error=undefined;this.current.set(lane,{id:a.id,runId,threadId:a.sessionId});this.state(a,'working',a.kind?(a.kind==='plan'?'Reading the project and choosing the team':'Reviewing the team\'s work'):a.sessionId?`Resuming native ${name} session`:`Creating native ${name} session; agent will name itself`);this.log(`Local ${name} started: ${a.title}`,a.projectId);this.save();const started=performance.now();
  try{
   const room=this.project(a.projectId);
   if(a.kind==='plan')room.memory.latest=`Donna's brain is reading the project and choosing the team for "${a.brief.slice(0,300)}".`;
   if(a.kind==='plan'&&room.git)this.openJob(a,room);
   const prompt=this.prompt(a),sandbox=a.kind?this.sandbox(a,room):undefined;
   const result=await runner.run({cwd:a.cwd,threadId:a.sessionId,reasoningEffort:a.reasoningEffort||'low',prompt,...(sandbox&&{sandbox}),onThread:id=>{a.sessionId=id;this.worker(a).sessionId=id;const c=this.current.get(lane);if(c?.runId===runId)c.threadId=id;if(a.status!=='working')void runner.interrupt(id).catch(()=>{});this.save();},onEvent:e=>{if(a.revision!==revision||a.runId!==runId||a.status!=='working')return;if(a.kind){this.observe(a,e.params);return;}const item=e.params?.item;let action:string|undefined;if(e.method==='item/started'&&item?.type==='commandExecution')action=`Running: ${String(item.command||'local command').slice(0,180)}`;if(e.method==='item/started'&&item?.type==='fileChange')action='Updating project files';if(e.method==='claude/assistant'){const blocks=e.params?.message?.content,tool=Array.isArray(blocks)?blocks.find((c:any)=>c?.type==='tool_use'):undefined;if(tool)action=['Edit','Write'].includes(tool.name)?'Updating project files':'Reading project files';}if(action){this.worker(a).currentAction=action;this.save();}}});
   appendFileSync(resolve(this.store.root,'executions.jsonl'),JSON.stringify({at:now(),assignmentId:a.id,projectId:a.projectId,provider:a.provider||'codex',runId,revision,threadId:result.threadId,turnId:result.turnId,status:result.status,model:result.model,reasoningEffort:result.reasoningEffort,elapsedMs:performance.now()-started,usage:result.usage,usageMissing:result.usage===undefined,error:result.error,usageScope:'Native thread total is cumulative. Do not sum totals from resumed runs.'})+'\n');
   // Pausing or revising the task invalidates an old completion, even if cancellation races.
   if(!this.isCurrent(a,revision,runId))return;
   a.elapsedMs=performance.now()-started;a.tokens=result.usage;a.usageMissing=result.usage===undefined;a.sessionId=result.threadId||a.sessionId;this.worker(a).sessionId=a.sessionId;
   if(result.status!=='completed')throw Error(result.error||`Native ${name} turn ${result.status}`);
   if(a.kind){this.lead(a,result.text);return;}
   const raw=result.text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');const delivered=resultSchema.parse(JSON.parse(raw));
   const files=this.deliver(a,runId,delivered.artifacts);
   if(!files.length&&!delivered.needsInput)throw Error('No real deliverable files were returned');
   const w=this.worker(a);if(!w.name){let name=delivered.name.replace(/[^A-Za-z '-]/g,'').trim();if(!name)throw Error('Agent did not choose a valid English name');const taken=this.data.workers.filter(k=>k.id!==w.id).map(k=>k.name);if(taken.includes(name))name+=` ${this.data.workers.indexOf(w)+1}`;w.name=name;}
   a.summary=delivered.summary;a.artifacts=files;a.verification=delivered.verification;a.completedAt=now();this.state(a,delivered.needsInput?'waiting':'review',delivered.needsInput||'Real files delivered; awaiting your review');a.error=delivered.needsInput;
   const p=this.project(a.projectId);p.memory.latest=`${w.name}: ${a.summary.slice(0,1200)}`;p.memory.nextStep=delivered.needsInput||'Review the actual deliverables and verification evidence.';p.memory.updatedAt=now();
   this.log(`${w.name} ${delivered.needsInput?'needs input':'delivered for review'}: ${a.title}`,a.projectId);
   if(delivered.needsInput)this.decide({project_id:a.projectId,title:`Input needed: ${a.title}`,context:delivered.needsInput,status:'open'});
   // Wake only dependency waits; never silently resume a human-paused task.
   if(!delivered.needsInput)for(const dependent of this.data.assignments.filter(k=>k.status==='waiting'&&k.dependsOn.includes(a.id)&&k.error?.startsWith('Dependency '))){if(dependent.dependsOn.every(id=>['review','done'].includes(this.assignment(id).status))){dependent.error=undefined;this.state(dependent,'queued','Dependencies delivered; queued');}}
   this.save();
  }catch(err){if(this.isCurrent(a,revision,runId)){a.error=String(err).slice(0,2000);if(a.kind==='plan')this.endCrew(this.data.assignments.filter(c=>c.agent?.brainId===a.id&&c.status==='working'),a.error);a.elapsedMs=performance.now()-started;a.completedAt=now();this.state(a,'failed',a.error);this.project(a.projectId).memory.latest=`Execution failed: ${a.title}. ${a.error}`;this.project(a.projectId).memory.updatedAt=now();this.log(`Execution failed: ${a.title}`,a.projectId);this.save();}}
  finally{this.seen.delete(a.id);if(this.current.get(lane)?.runId===runId)this.current.delete(lane);}
 }
 close(){this.stopped=true;clearTimeout(this.wake);this.poke?.();this.codex.close();this.options.claude?.close();this.options.brain?.close();}
}
