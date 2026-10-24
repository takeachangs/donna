import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {AgencyWorkspace,type CodexRunner} from '../apps/server/src/agency/workspace';
import {OfficeStore} from '../apps/server/src/agency/state';
import {Projects} from '../apps/server/src/agency/projects';
import {questionNotice,resultNotice} from '../apps/server/src/agency/briefings';
import {resolveProjectTarget} from '../apps/server/src/agency/secretary';

type RunInput=Parameters<CodexRunner['run']>[0];
type RunResult=Awaited<ReturnType<CodexRunner['run']>>;
class ControlledBrain implements CodexRunner {
  pending:{input:RunInput;finish:(result:RunResult)=>void;threadId:string}[]=[];
  status(){return Promise.resolve({available:true,authenticated:true});}
  run(input:RunInput):Promise<RunResult>{
    const threadId=input.threadId||`brain-${this.pending.length+1}`;input.onThread?.(threadId);
    return new Promise(finish=>this.pending.push({input,finish,threadId}));
  }
  inject(){return true;}
  async interrupt(){}
  close(){}
  emit(i:number,e:any){this.pending[i].input.onEvent!({method:'claude/'+e.type,params:e});}
  reply(i:number,body:unknown){const run=this.pending[i];run.finish({threadId:run.threadId,status:'completed',text:JSON.stringify(body)});}
}
const roots:string[]=[];
const workspaces:AgencyWorkspace[]=[];
afterEach(()=>{
  for(const w of workspaces.splice(0))w.close();
  for(const path of roots.splice(0)){if(!path.startsWith(join(tmpdir(),'agency-ask-')))throw Error('Unexpected fixture directory');rmSync(path,{recursive:true,force:true});}
});
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'agency-ask-'));roots.push(root);
  const store=new OfficeStore(root),projects=new Projects(store),project=projects.create({name:'Demo',brief:'Deliver a working local demo.'}),brain=new ControlledBrain();
  const codex={status:()=>Promise.resolve({available:true,authenticated:true}),run:()=>Promise.reject(Error('the pump must not run a crew row')),interrupt:async()=>{},close(){}} as CodexRunner;
  const workspace=new AgencyWorkspace(store,projects,codex,()=>{},{autoStart:false,brain});workspaces.push(workspace);
  return {projects,project,brain,workspace};
}
type F=ReturnType<typeof fixture>;
async function until(predicate:()=>boolean){const start=Date.now();while(!predicate()){if(Date.now()-start>2000)throw Error('Timed out');await new Promise(r=>setTimeout(r,0));}}
async function running(f:F,goal='Build a landing page for my company.'){
  const {assignment}=f.workspace.delegate({project_id:f.project.id,goal}) as {assignment:{cwd:string}},pumping=f.workspace.pump();
  await until(()=>f.brain.pending.length===1);return {pumping,cwd:assignment.cwd};
}
const use=(id:string,name:string,input:object,parent?:string)=>({type:'assistant',parent_tool_use_id:parent,message:{content:[{type:'tool_use',id,name,input}]}});
const agent=(id:string,description:string,extra:object={})=>use(id,'Agent',{description,prompt:`Do: ${description}`,run_in_background:true,model:'sonnet',...extra});
const started=(task:string,tool:string)=>({type:'system',subtype:'task_started',task_id:task,tool_use_id:tool,task_type:'local_agent'});
const notified=(task:string,tool:string)=>({type:'system',subtype:'task_notification',task_id:task,tool_use_id:tool,status:'completed',summary:'Agent finished'});
const Q="What's your company called?";

describe('needs you: the brain asks one question',()=>{
  it('parks a plan turn that ends with {ask} as waiting: one open ask decision, no briefing',async()=>{
    const f=fixture(),{pumping}=await running(f);
    f.brain.reply(0,{ask:Q});await pumping;
    const snap=f.workspace.snapshot(),plan=snap.assignments.find(a=>a.kind==='plan')!,lead=snap.workers.find(w=>w.lead)!;
    expect(plan.status).toBe('waiting');expect(lead).toMatchObject({status:'waiting',currentAction:`Waiting for your answer: ${Q}`});
    expect(snap.projects[0].memory.nextStep).toBe(`Answer Donna's question: ${Q}`);
    expect(snap.decisions).toHaveLength(1);expect(snap.decisions[0]).toMatchObject({status:'open',title:Q,action:{kind:'ask',assignmentId:plan.id}});
    expect(snap.briefings).toHaveLength(0);
  });
  it('still accepts needsInput as an alias for ask',async()=>{
    const f=fixture(),{pumping}=await running(f);
    f.brain.reply(0,{summary:'Not started.',needsInput:Q});await pumping;
    const snap=f.workspace.snapshot();
    expect(snap.assignments.find(a=>a.kind==='plan')!.status).toBe('waiting');expect(snap.decisions[0]).toMatchObject({status:'open',title:Q,context:'Not started.',action:{kind:'ask'}});expect(snap.briefings).toHaveLength(0);
  });
  it('answers by decision id alone: the asking step is done and the answer is a new queued brain turn',async()=>{
    const f=fixture(),{pumping}=await running(f);
    f.brain.reply(0,{ask:Q});await pumping;
    const d=f.workspace.snapshot().decisions[0];f.workspace.decide({id:d.id,status:'decided',decision:'Acme.'});
    const snap=f.workspace.snapshot(),[asker,next]=snap.assignments.filter(a=>a.kind==='plan');
    expect(asker).toMatchObject({status:'done',summary:'Answered: Acme.'});expect(asker.completedAt).toBeTruthy();
    expect(next).toMatchObject({status:'queued',kind:'plan'});expect(next.brief).toBe(`The user answered your question "${Q}": Acme.`);
    expect(snap.decisions[0].status).toBe('decided');
  });
  it('answers for a room that is not the one named, and the briefing credits the earlier crew',async()=>{
    const f=fixture(),other=f.projects.create({name:'Other',brief:'Elsewhere'});f.workspace.syncProjects();
    const {pumping,cwd}=await running(f);mkdirSync(cwd,{recursive:true});writeFileSync(resolve(cwd,'index.html'),'<h1>Hi</h1>');
    f.brain.emit(0,agent('t1','Build the page',{name:'Mika'}));f.brain.emit(0,started('k1','t1'));f.brain.emit(0,use('s1','Write',{file_path:resolve(cwd,'index.html')},'t1'));f.brain.emit(0,notified('k1','t1'));
    f.brain.reply(0,{ask:Q,summary:'Mika built the page without a name.'});await pumping;
    let snap=f.workspace.snapshot();const crew=snap.assignments.filter(a=>a.agent),asker=snap.assignments.find(a=>a.kind==='plan')!;
    expect(asker).toMatchObject({status:'waiting',dependsOn:[crew[0].id]});expect(snap.briefings).toHaveLength(0);
    f.workspace.decide({id:snap.decisions[0].id,project_id:other.id,status:'decided',decision:'Acme.'});
    snap=f.workspace.snapshot();const next=snap.assignments.filter(a=>a.kind==='plan')[1];
    expect(next).toMatchObject({projectId:f.project.id,status:'queued',dependsOn:[crew[0].id]});expect(next.brief).toContain(Q);expect(next.brief).toContain('Acme.');
    const again=f.workspace.pump();await until(()=>f.brain.pending.length===2);
    f.brain.reply(1,{title:'Acme landing page',summary:'Mika made the Acme page.',verification:['Read index.html']});await again;
    snap=f.workspace.snapshot();expect(snap.briefings).toHaveLength(1);
    expect(snap.briefings[0]).toMatchObject({title:'Acme landing page',status:'queued'});expect(snap.briefings[0].contributors.map(c=>c.name)).toEqual(['Mika']);expect(snap.briefings[0].artifacts.map(a=>a.path)).toEqual(['index.html']);
  });
  it('asks a question aloud with its id, the record_decision call and the options; resultNotice is unchanged',()=>{
    const n=questionNotice({id:'dec-1',question:'Allow the install?',project:'Bakery',options:['Yes, allow it','No']});
    expect(n).toContain('dec-1');expect(n).toContain('record_decision');expect(n).toContain('Yes, allow it / No');expect(n).toContain('"Allow the install?"');expect(n).toContain('Never say ids aloud');
    expect(questionNotice({id:'dec-2',question:Q,project:'Demo'},'Donna')).toContain('Pick up with your name');expect(questionNotice({id:'dec-2',question:Q,project:'Demo'})).not.toContain('choices');
    const r=resultNotice([{id:'b1',title:'Page',project:'Bakery',names:['Ellis']}]);expect(r).toContain('briefing_id b1');expect(r).not.toContain('record_decision');
  });
  it('lets record_decision resolve without a selected room, but still rejects an unknown id',()=>{
    expect(resolveProjectTarget('record_decision',{project_id:'selected',id:'x',status:'decided'},'',[]).project_id).toBeUndefined();
    expect(()=>resolveProjectTarget('record_decision',{project_id:'09410879-ca31-495f-87db-b27e321eaf39'},'',[])).toThrow('Unknown project target');
  });
});
