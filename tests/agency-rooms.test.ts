import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AgencyWorkspace,type CodexRunner} from '../apps/server/src/agency/workspace';
import {OfficeStore} from '../apps/server/src/agency/state';
import {Projects} from '../apps/server/src/agency/projects';
import {roomName} from '../apps/server/src/agency/plans';
import {resolveProjectTarget,secretaryTools} from '../apps/server/src/agency/secretary';

type RunInput=Parameters<CodexRunner['run']>[0];
type RunResult=Awaited<ReturnType<CodexRunner['run']>>;
class ControlledCodex implements CodexRunner {
  pending:{input:RunInput;finish:(result:RunResult)=>void;threadId:string}[]=[];
  closed=false;
  status(){return Promise.resolve({available:true,authenticated:true});}
  run(input:RunInput):Promise<RunResult>{
    const threadId=input.threadId||`native-test-${this.pending.length+1}`;
    input.onThread?.(threadId);
    return new Promise(finish=>this.pending.push({input,finish,threadId}));
  }
  async interrupt(){}
  close(){this.closed=true;}
  reply(index:number,body:unknown,prefix=''){const run=this.pending[index];run.finish({threadId:run.threadId,status:'completed',text:prefix+JSON.stringify(body)});}
}
const roots:string[]=[];
const workspaces:AgencyWorkspace[]=[];
afterEach(()=>{
  vi.restoreAllMocks();
  for(const workspace of workspaces.splice(0))workspace.close();
  for(const path of roots.splice(0)){
    if(!path.startsWith(join(tmpdir(),'agency-rooms-')))throw Error('Unexpected fixture directory');
    rmSync(path,{recursive:true,force:true});
  }
});
/** An empty office: no project exists until a test asks for work. */
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'agency-rooms-'));roots.push(root);
  const store=new OfficeStore(root),projects=new Projects(store),codex=new ControlledCodex(),claude=new ControlledCodex(),brain=new ControlledCodex();
  const workspace=new AgencyWorkspace(store,projects,codex,()=>{},{autoStart:false,claude,brain});workspaces.push(workspace);
  return {root,store,projects,codex,claude,brain,workspace};
}
async function until(predicate:()=>boolean){
  const start=Date.now();while(!predicate()){if(Date.now()-start>2000)throw Error('Timed out awaiting controlled execution');await new Promise(r=>setTimeout(r,0));}
}
const GOAL='make a page where a ball moves with WASD',PARAPHRASE='Build a page where the ball moves using WASD keys';
const plans=(f:ReturnType<typeof fixture>)=>f.workspace.snapshot().assignments.filter(a=>a.kind==='plan');

describe('rooms',()=>{
  it('starts with an empty office and resolves no project target without throwing for reads and delegation',()=>{
    const f=fixture(),uuid='b151db6a-edf3-4b63-87db-b27e321eaf39';
    expect(f.projects.list(true)).toEqual([]);expect(f.workspace.snapshot().projects).toEqual([]);
    for(const name of ['read_workspace','prepare_command_room','delegate_work'])expect(resolveProjectTarget(name,{project_id:'selected'},'',[]).project_id).toBeUndefined();
    for(const name of ['update_project','record_decision'])expect(()=>resolveProjectTarget(name,{project_id:'selected'},'',[])).toThrow('Unknown project target');
    const a=f.projects.create({name:'Demo'}),b=f.projects.create({name:'Other'});
    expect(resolveProjectTarget('delegate_work',{project_id:'selected'},uuid,[a.id,b.id]).project_id).toBeUndefined();
    expect(resolveProjectTarget('delegate_work',{},a.id,[a.id,b.id]).project_id).toBe(a.id);
    expect(()=>resolveProjectTarget('delegate_work',{project_id:uuid},a.id,[a.id,b.id])).toThrow('Unknown project target');
  });
  it('names a room from the brief unless the model gave a real name',()=>{
    for(const given of [undefined,'','Project 01','project 3','Project #2','New project','Untitled'])expect(roomName(given,'make a page where a ball moves with WASD')).toBe('Page where a ball moves with WASD');
    expect(roomName('WASD Ball','make a page where a ball moves with WASD')).toBe('WASD Ball');
    expect(roomName(undefined,'Can you build me a landing page with a contact form?')).toBe('Landing page with a contact form');
    const long=roomName(undefined,'a dashboard showing quarterly sales with regional totals and charts');
    expect(long.length).toBeLessThanOrEqual(40);expect(long).not.toMatch(/\s(with|the|and|a|of)$/i);expect(long).toBe('Dashboard showing quarterly sales');
    expect(roomName(undefined,'')).toBe('New project');expect(roomName('Project 01','')).toBe('New project');
  });
  it('dedupes room names case-insensitively and lets a deleted room\'s name be reused',()=>{
    const f=fixture(),a=f.projects.create({name:'Demo'}),b=f.projects.create({name:'Demo'}),c=f.projects.create({name:'demo'});
    expect([a.name,b.name,c.name]).toEqual(['Demo','Demo 2','demo 3']);
    const solo=f.projects.create({name:'Solo'});f.projects.setDeleted(solo.id,true);
    expect(f.projects.create({name:'Solo'}).name).toBe('Solo');
  });
  it('createProject with a placeholder name makes one room named from the work, selected, with one queued plan and a real goal',()=>{
    const f=fixture(),r=f.workspace.createProject({name:'Project 01',brief:'',initial_work:GOAL}),snap=f.workspace.snapshot();
    expect(f.projects.list()).toHaveLength(1);expect(snap.projects.map(p=>p.name)).toEqual(['Page where a ball moves with WASD']);
    expect(r.committed).toBe(true);expect(r.selected).toBe(true);expect(r.project.name).toBe('Page where a ball moves with WASD');
    expect(r.note).toContain('now selected');expect(r.note).toContain('project_id "selected"');
    expect(snap.assignments).toHaveLength(1);expect(snap.assignments[0]).toMatchObject({kind:'plan',status:'queued',projectId:r.project.id});
    expect(snap.projects[0].goal).toBe(GOAL);
  });
  it('delegate without a project_id creates the room and the plan in one call',()=>{
    const f=fixture(),r=f.workspace.delegate({goal:GOAL}) as any;
    expect(f.projects.list()).toHaveLength(1);expect(r.project.name).toBe('Page where a ball moves with WASD');expect(r.selected).toBe(true);
    expect(plans(f)).toHaveLength(1);expect(r.assignment).toMatchObject({kind:'plan',status:'queued',projectId:r.project.id});
  });
  it('returns the in-flight plan instead of queuing a duplicate, and queues genuinely new work',async()=>{
    const f=fixture(),first=f.workspace.delegate({goal:GOAL}) as any,id=first.project.id,planId=first.assignment.id;
    const same=f.workspace.delegate({goal:'Make a page where a ball moves with WASD!'}) as any;
    expect(same).toMatchObject({committed:false,alreadyQueued:true});expect(same.assignment.id).toBe(planId);expect(same.note).toMatch(/^already queued/);expect('error' in same).toBe(false);
    expect(plans(f)).toHaveLength(1);expect(f.projects.list()).toHaveLength(1);
    const para=f.workspace.delegate({project_id:id,goal:PARAPHRASE}) as any;
    expect(para.alreadyQueued).toBe(true);expect(para.assignment.id).toBe(planId);expect(plans(f)).toHaveLength(1);
    const next=f.workspace.delegate({project_id:id,goal:'make the ball red'}) as any;
    expect(next.alreadyQueued).toBeUndefined();expect(next.assignment.id).not.toBe(planId);expect(plans(f)).toHaveLength(2);
    // After the 2-minute window a paraphrase is new work, but the exact same text is still in flight.
    const real=Date.now();vi.spyOn(Date,'now').mockReturnValue(real+121_000);
    const late=f.workspace.delegate({project_id:id,goal:PARAPHRASE}) as any;
    expect(late.alreadyQueued).toBeUndefined();expect(late.assignment.id).not.toBe(planId);expect(plans(f)).toHaveLength(3);
    expect((f.workspace.delegate({project_id:id,goal:GOAL}) as any).alreadyQueued).toBe(true);expect(plans(f)).toHaveLength(3);
  });
  it('treats a paused plan as finished and a working plan as still in flight',async()=>{
    const f=fixture(),first=f.workspace.delegate({goal:GOAL}) as any,id=first.project.id;
    f.workspace.pause(first.assignment.id);
    const again=f.workspace.delegate({project_id:id,goal:GOAL}) as any;
    expect(again.alreadyQueued).toBeUndefined();expect(again.assignment.id).not.toBe(first.assignment.id);expect(plans(f)).toHaveLength(2);
    const g=fixture(),one=g.workspace.delegate({goal:GOAL}) as any,pumping=g.workspace.pump();
    await until(()=>g.brain.pending.length===1);
    expect(g.workspace.snapshot().assignments[0].status).toBe('working');
    const dup=g.workspace.delegate({project_id:one.project.id,goal:GOAL}) as any;
    expect(dup).toMatchObject({committed:false,alreadyQueued:true});expect(dup.assignment.id).toBe(one.assignment.id);expect(plans(g)).toHaveLength(1);
    g.brain.reply(0,{nope:true},'not a plan: ');await pumping;
  });
  it('createProject with work already in flight returns the existing room instead of a new one',()=>{
    const f=fixture(),first=f.workspace.createProject({initial_work:GOAL}),dup=f.workspace.createProject({name:'Ball game',brief:'',initial_work:GOAL}) as any;
    expect(f.projects.list()).toHaveLength(1);expect(dup).toMatchObject({committed:false,alreadyQueued:true,selected:true});
    expect(dup.project.id).toBe(first.project.id);expect(plans(f)).toHaveLength(1);
  });
  it('tells the model to always pass "selected" and that create_project needs no name',()=>{
    const tool=(n:string)=>secretaryTools.find(t=>t.name===n)!,params=(n:string)=>tool(n).parameters as any;
    expect(tool('delegate_work').description).toContain('Always pass project_id "selected"');
    expect(JSON.stringify(params('delegate_work').properties.project_id)).toContain('Never copy');
    expect(params('create_project').required ?? []).not.toContain('name');
    expect(params('create_project').required).toContain('initial_work');
  });
});
