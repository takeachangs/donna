import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,statSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {AgencyWorkspace,type CodexRunner} from '../apps/server/src/agency/workspace';
import {OfficeStore} from '../apps/server/src/agency/state';
import {Projects} from '../apps/server/src/agency/projects';

type RunInput=Parameters<CodexRunner['run']>[0];
type RunResult=Awaited<ReturnType<CodexRunner['run']>>;
class ControlledCodex implements CodexRunner {
  pending:{input:RunInput;finish:(result:RunResult)=>void;threadId:string}[]=[];
  interrupted:string[]=[];
  closed=false;
  health:ReturnType<CodexRunner['status']>=Promise.resolve({available:true,authenticated:true});
  status(){return this.health;}
  run(input:RunInput):Promise<RunResult>{
    const threadId=input.threadId||`native-test-${this.pending.length+1}`;
    input.onThread?.(threadId);
    return new Promise(finish=>this.pending.push({input,finish,threadId}));
  }
  async interrupt(threadId:string){this.interrupted.push(threadId);}
  close(){this.closed=true;}
  deliver(index:number,{name='Rowan',path='result.md',summary='Created a real local fixture file.',content='# Actual fixture artifact\n\nWritten by the controlled test runner.',needsInput}:{name?:string;path?:string;summary?:string;content?:string;needsInput?:string}={}){
    const run=this.pending[index],file=resolve(run.input.cwd,path);
    mkdirSync(dirname(file),{recursive:true});writeFileSync(file,content);
    run.finish({threadId:run.threadId,status:'completed',text:JSON.stringify({name,summary,artifacts:[path],verification:['Fixture file was written and checked by this unit test.'],needsInput}),usage:{total:{totalTokens:12}}});
  }
}
const roots:string[]=[];
const workspaces:AgencyWorkspace[]=[];
afterEach(()=>{
  for(const workspace of workspaces.splice(0))workspace.close();
  for(const path of roots.splice(0)){
    if(!path.startsWith(join(tmpdir(),'agency-workspace-')))throw Error('Unexpected fixture directory');
    rmSync(path,{recursive:true,force:true});
  }
});
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'agency-workspace-'));roots.push(root);
  const store=new OfficeStore(root),projects=new Projects(store),project=projects.create({name:'Demo',brief:'Deliver a working local demo.'}),codex=new ControlledCodex();
  const workspace=new AgencyWorkspace(store,projects,codex,()=>{},{autoStart:false});workspaces.push(workspace);
  return {root,store,projects,project,codex,workspace};
}
function withClaude(){
  const f=fixture(),claude=new ControlledCodex(),workspace=new AgencyWorkspace(f.store,f.projects,f.codex,()=>{},{autoStart:false,claude});workspaces.push(workspace);
  return {...f,claude,workspace};
}
const executions=(f:{root:string})=>readFileSync(resolve(f.root,'executions.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
const work=(key='build',depends_on:string[]=[])=>({key,role:key==='build'?'Implementation':'Review',responsibility:`Own ${key} and report actual evidence.`,brief:`Produce the ${key} deliverable in English.`,acceptance:'A nonempty file and an honest verification report.',depends_on});
function delegate(f:ReturnType<typeof fixture>,workers:(ReturnType<typeof work>&{reuse_worker_id?:string;provider?:'codex'|'claude'})[]=[work()]){
  return f.workspace.staff(f.project.id,{checkpoint:'A useful verified deliverable',rationale:'Only the required independently useful work packages are staffed.',workers});
}
async function until(predicate:()=>boolean){
  const start=Date.now();while(!predicate()){if(Date.now()-start>2000)throw Error('Timed out awaiting controlled execution');await new Promise(r=>setTimeout(r,0));}
}

describe('agency native execution workspace',()=>{
  it('creates a new project with a planning step for Donna\'s brain, which staffs the team and queues its review',async()=>{
    const brain=new ControlledCodex(),f=fixture(),workspace=new AgencyWorkspace(f.store,f.projects,f.codex,()=>{},{autoStart:false,brain});workspaces.push(workspace);
    const result=workspace.createProject({name:'Quick Notes',brief:'Build a single file notes app.',initial_work:'Build a single file notes app.'});
    expect(result.executionStarted).toBe(true);expect(result.planning).toBe(true);const snap=workspace.snapshot(),assigned=snap.assignments.filter(a=>a.projectId===result.project.id);
    expect(assigned).toHaveLength(1);expect(assigned[0].kind).toBe('plan');expect(assigned[0].status).toBe('queued');
    const lead=snap.workers.find(w=>w.id===assigned[0].workerId)!;expect(lead.lead).toBe(true);expect(lead.name).toBe('Donna');
    const pumping=workspace.pump();await until(()=>brain.pending.length===1);
    expect(brain.pending[0].input.prompt).toContain('Build a single file notes app.');expect(workspace.snapshot().workers.find(w=>w.id===lead.id)!.sessionId).toBe(brain.pending[0].threadId);
    brain.pending[0].finish({threadId:brain.pending[0].threadId,status:'completed',text:'Here is the plan:\n```json\n'+JSON.stringify({title:'Notes app',checkpoint:'Working notes',rationale:'One small feature needs one worker.',workers:[work()]})+'\n```'});
    await until(()=>f.codex.pending.length===1);
    const after=workspace.snapshot(),crew=after.assignments.find(a=>!a.kind)!,review=after.assignments.find(a=>a.kind==='review')!;
    expect(crew.status).toBe('working');expect(review.status).toBe('queued');expect(review.dependsOn).toEqual([crew.id]);expect(review.sessionId).toBe(lead.sessionId??brain.pending[0].threadId);
    expect(after.assignments.find(a=>a.kind==='plan')!.status).toBe('done');
    f.codex.deliver(0);await until(()=>brain.pending.length===2);
    expect(brain.pending[1].input.threadId).toBe(brain.pending[0].threadId);expect(brain.pending[1].input.prompt).toContain('Rowan');
    brain.pending[1].finish({threadId:brain.pending[0].threadId,status:'completed',text:JSON.stringify({summary:'Rowan built the notes app.',verification:['Read result.md']})});await pumping;
    const done=workspace.snapshot();expect(done.assignments.find(a=>a.kind==='review')!.status).toBe('review');expect(done.briefings).toHaveLength(1);expect(done.briefings[0].workerId).toBe(crew.workerId);expect(done.briefings[0].summary).toBe('Rowan built the notes app.');expect(done.briefings[0].contributors).toHaveLength(1);
  });
  it('keeps explicitly empty rooms idle and refuses a goal when no brain is connected',()=>{
    const f=fixture(),idle=f.workspace.createProject({name:'Later',brief:'Do not start yet.',initial_work:null});
    expect(idle.executionStarted).toBe(false);expect(f.workspace.snapshot().assignments).toHaveLength(0);
    const before=f.workspace.snapshot(),catalog=f.projects.list();
    expect(()=>f.workspace.createProject({name:'Missing choice',brief:'Build this'})).toThrow();
    expect(()=>f.workspace.createProject({name:'No brain',brief:'Build this',initial_work:'Build this'})).toThrow('not connected');
    expect(f.workspace.snapshot()).toEqual(before);expect(f.projects.list()).toEqual(catalog);
  });
  it('treats null or empty reuse IDs as new workers while rejecting unknown nonempty IDs',()=>{
    const f=fixture();
    for(const reuse_worker_id of [null,'']){
      const result=f.workspace.staff(f.project.id,{checkpoint:'Build',rationale:'One worker',workers:[{...work(),reuse_worker_id}]});
      expect(result.workers).toHaveLength(1);expect(result.workers[0].sessionId).toBeUndefined();
    }
    const before=f.workspace.snapshot();expect(()=>delegate(f,[{...work(),reuse_worker_id:'unknown'}])).toThrow('Reused worker');expect(f.workspace.snapshot()).toEqual(before);
  });
  it('renames a room without changing its work, file snapshots or native session',async()=>{
    const f=fixture();delegate(f);const pumping=f.workspace.pump();await until(()=>f.codex.pending.length===1);f.codex.deliver(0);await pumping;
    const before=f.workspace.snapshot();f.workspace.renameProject(f.project.id,{name:'  Product studio  '});
    expect(f.projects.list()[0].name).toBe('Product studio');expect(f.store.load(f.project.id).projectName).toBe('Product studio');
    expect(f.workspace.snapshot().assignments).toEqual(before.assignments);expect(f.workspace.snapshot().workers).toEqual(before.workers);expect(f.workspace.snapshot().briefings).toEqual(before.briefings);
    const saved=readFileSync(resolve(f.root,'projects.json'),'utf8');expect(()=>f.workspace.renameProject(f.project.id,{name:' '})).toThrow();expect(readFileSync(resolve(f.root,'projects.json'),'utf8')).toBe(saved);
  });
  it('restores deleted projects with the same results and sessions, without reviving them through old registration links',async()=>{
    const f=fixture();delegate(f);const pumping=f.workspace.pump();await until(()=>f.codex.pending.length===1);f.codex.deliver(0);await pumping;
    const before=f.workspace.snapshot(),b=f.workspace.briefing();f.workspace.deleteProject(f.project.id);
    expect(f.projects.list()).toHaveLength(0);expect(f.projects.list(true)[0].deletedAt).toBeTruthy();expect(()=>f.workspace.briefing()).toThrow('No pending');
    expect(()=>f.projects.register({id:f.project.id,name:'Old bookmark'})).toThrow('Restore');expect(()=>delegate(f)).toThrow('Restore');expect(()=>f.workspace.accept(before.assignments[0].id)).toThrow('Restore');
    expect(readFileSync(f.workspace.artifact(before.assignments[0].id,'result.md'),'utf8')).toContain('Actual fixture');
    f.projects.create({name:'A different project'});f.workspace.syncProjects();expect(f.projects.list(true)).toHaveLength(2);
    f.workspace.restoreProject(f.project.id);expect(f.workspace.briefing().id).toBe(b.id);expect(f.workspace.snapshot().assignments).toEqual(before.assignments);expect(f.workspace.snapshot().workers).toEqual(before.workers);
    const reopened=new AgencyWorkspace(f.store,f.projects,new ControlledCodex(),()=>{},{autoStart:false});workspaces.push(reopened);expect(reopened.snapshot().projects[0].deletedAt).toBeUndefined();expect(reopened.briefing().id).toBe(b.id);
  });
  it('pauses the whole deleted workflow and rejects late completion; restore does not silently resume it',async()=>{
    const f=fixture();delegate(f,[work(),work('review',['build'])]);const pumping=f.workspace.pump();await until(()=>f.codex.pending.length===1);
    const session=f.codex.pending[0].threadId;f.workspace.deleteProject(f.project.id);expect(f.codex.interrupted).toContain(session);expect(f.workspace.snapshot().assignments.map(a=>a.status)).toEqual(['paused','paused']);
    f.codex.deliver(0);await pumping;expect(f.workspace.snapshot().briefings).toHaveLength(0);expect(f.workspace.snapshot().workers[0].sessionId).toBe(session);
    f.workspace.restoreProject(f.project.id);await f.workspace.pump();expect(f.codex.pending).toHaveLength(1);expect(f.workspace.snapshot().assignments.map(a=>a.status)).toEqual(['paused','paused']);
  });
  it('does not run queued work after recovery if the catalog deletion was persisted first',async()=>{
    const f=fixture();delegate(f);f.projects.setDeleted(f.project.id,true);
    const runner=new ControlledCodex(),reopened=new AgencyWorkspace(f.store,f.projects,runner,()=>{},{autoStart:false});workspaces.push(reopened);
    await reopened.recover();await reopened.pump();expect(reopened.snapshot().assignments[0].status).toBe('paused');expect(runner.pending).toHaveLength(0);
  });
  it('persists a completed delivery at Donna and treats presentation separately from acceptance',async()=>{
    const f=fixture();delegate(f);const pumping=f.workspace.pump();await until(()=>f.codex.pending.length===1);f.codex.deliver(0);await pumping;
    const b=f.workspace.briefing();expect(b.summary).toContain('real local fixture');
    const reopened=new AgencyWorkspace(f.store,f.projects,new ControlledCodex(),()=>{},{autoStart:false});workspaces.push(reopened);
    expect(reopened.briefing().id).toBe(b.id);reopened.presentBriefing(b.id);
    expect(reopened.snapshot().assignments[0].status).toBe('review');expect(reopened.snapshot().briefings[0].status).toBe('presented');expect(reopened.presentBriefing(b.id).committed).toBe(false);
    expect(()=>reopened.briefing()).toThrow('No pending briefing');
  });
  it('adopts Donna while preserving projects, workers, deliveries and native sessions',()=>{
    const f=fixture();delegate(f);const saved=f.workspace.snapshot();saved.secretary.name='Mara';
    saved.workers[0].sessionId='preserved-native-session';
    writeFileSync(resolve(f.root,'workspace.json'),JSON.stringify(saved));
    const second=new AgencyWorkspace(f.store,f.projects,new ControlledCodex(),()=>{},{autoStart:false});workspaces.push(second);
    const next=second.snapshot();expect(next.secretary.name).toBe('Donna');expect(next.secretary.id).toBe('mara');
    expect(next.projects).toEqual(saved.projects);expect(next.workers).toEqual(saved.workers);expect(next.assignments).toEqual(saved.assignments);expect(next.decisions).toEqual(saved.decisions);
    expect(JSON.parse(readFileSync(resolve(f.root,'workspace.json'),'utf8')).secretary.name).toBe('Donna');
  });
  it('adds compact project memory without rewriting existing project files',()=>{
    const f=fixture();let old=f.store.load(f.project.id);
    old.documents.push({id:'legacy',title:'Preserved draft',body:'Existing English deliverable that must survive the workspace migration.',author:'mara',revision:1,updatedAt:'2026-10-23T00:00:00Z'});f.store.save(old);
    const path=resolve(f.root,'rooms',f.project.id+'.json'),before=readFileSync(path,'utf8'),catalog=readFileSync(resolve(f.root,'projects.json'),'utf8');
    const second=new AgencyWorkspace(f.store,f.projects,new ControlledCodex(),()=>{},{autoStart:false});workspaces.push(second);second.syncProjects();
    expect(second.snapshot().projects.map(p=>p.id)).toContain(f.project.id);
    expect(readFileSync(path,'utf8')).toBe(before);expect(readFileSync(resolve(f.root,'projects.json'),'utf8')).toBe(catalog);
    expect(f.store.load(f.project.id).documents[0].body).toContain('must survive');
  });
  it('allocates exactly the secretary-selected count and rejects cycles atomically',()=>{
    const f=fixture(),one=delegate(f);expect(one.workers).toHaveLength(1);expect(one.workers[0].name).toBeUndefined();
    const two=delegate(f,[work('research'),work('write',['research'])]);expect(two.workers).toHaveLength(2);
    expect(two.assignments[1].dependsOn).toEqual([two.assignments[0].id]);
    const before=f.workspace.snapshot();expect(()=>delegate(f,[work('one',['two']),work('two',['one'])])).toThrow('Cyclic');expect(f.workspace.snapshot()).toEqual(before);
    expect(()=>delegate(f,[work('same'),work('same')])).toThrow('unique');
  });
  it('runs one native writer at a time, delivers for review, then starts its dependent',async()=>{
    const f=fixture(),plan=delegate(f,[work(),work('review',['build'])]),pumping=f.workspace.pump();
    await until(()=>f.codex.pending.length===1);expect(f.workspace.snapshot().assignments.map(a=>a.status)).toEqual(['working','queued']);
    expect(f.codex.pending[0].input.prompt).toContain('Choose your own short English personal name');
    f.codex.deliver(0,{name:'Rowan',path:'build.md'});await until(()=>f.codex.pending.length===2);
    expect(f.workspace.snapshot().assignments[0].status).toBe('review');
    expect(f.codex.pending[1].input.prompt).toContain('build.md');
    f.codex.deliver(1,{name:'Ellis',path:'review.md'});await pumping;
    const state=f.workspace.snapshot();expect(state.assignments.map(a=>a.status)).toEqual(['review','review']);expect(state.workers.map(w=>w.name)).toEqual(['Rowan','Ellis']);
    expect(state.workers.every(w=>!!w.sessionId)).toBe(true);expect(state.assignments[0].tokens).toEqual({total:{totalTokens:12}});
    expect(readFileSync(f.workspace.artifact(plan.assignments[0].id,'build.md'),'utf8')).toContain('Actual fixture');
    f.workspace.accept(plan.assignments[0].id);expect(f.workspace.snapshot().assignments[0].status).toBe('done');
    expect(()=>f.workspace.accept(plan.assignments[1].id+'missing')).toThrow('Unknown');
  });
  it('does not claim completion without real nonempty deliverable files',async()=>{
    const f=fixture();delegate(f);const pumping=f.workspace.pump();await until(()=>f.codex.pending.length===1);
    const run=f.codex.pending[0];run.finish({threadId:run.threadId,status:'completed',text:JSON.stringify({name:'Rowan',summary:'A promise is not an artifact.',artifacts:[],verification:[]})});await pumping;
    expect(f.workspace.snapshot().assignments[0].status).toBe('failed');expect(f.workspace.snapshot().assignments[0].error).toContain('No real deliverable');
  });
  it('retains completed evidence after another assignment changes or removes the original file',async()=>{
    const f=fixture(),plan=delegate(f),id=plan.assignments[0].id,pumping=f.workspace.pump();await until(()=>f.codex.pending.length===1);f.codex.deliver(0,{path:'nested/result.md'});await pumping;
    const delivered=f.workspace.snapshot().assignments[0].artifacts[0],original=resolve(plan.assignments[0].cwd,delivered.path),retained=f.workspace.artifact(id,delivered.path),content=readFileSync(retained,'utf8');
    expect(retained).not.toBe(original);expect(statSync(retained).size).toBe(delivered.size);
    writeFileSync(original,'A subsequent worker changed the same project file.');
    expect(readFileSync(f.workspace.artifact(id,delivered.path),'utf8')).toBe(content);expect(statSync(f.workspace.artifact(id,delivered.path)).size).toBe(delivered.size);
    unlinkSync(original);expect(readFileSync(f.workspace.artifact(id,delivered.path),'utf8')).toBe(content);
    f.workspace.accept(id);expect(f.workspace.snapshot().assignments[0].status).toBe('done');
  });
  it('rejects tampered snapshot paths and symlink escapes outside the delivery store',async()=>{
    const f=fixture(),plan=delegate(f),id=plan.assignments[0].id,pumping=f.workspace.pump();await until(()=>f.codex.pending.length===1);f.codex.deliver(0);await pumping;
    const outside=resolve(f.root,'outside-snapshots');mkdirSync(outside);writeFileSync(resolve(outside,'private.md'),'This is outside the deliveries store.');
    symlinkSync(outside,resolve(f.root,'deliveries','escape'),process.platform==='win32'?'junction':'dir');
    const saved=f.workspace.snapshot();
    for(const storage of ['../outside-snapshots/private.md','escape/private.md',resolve(outside,'private.md')]){
      const tampered=structuredClone(saved);tampered.assignments[0].artifacts[0].storage=storage;
      writeFileSync(resolve(f.root,'workspace.json'),JSON.stringify(tampered));
      const restored=new AgencyWorkspace(f.store,f.projects,new ControlledCodex(),()=>{},{autoStart:false});workspaces.push(restored);
      expect(()=>restored.artifact(id,'result.md')).toThrow(/relative|escapes/);
    }
    const escapedVersion='11111111-1111-4111-8111-111111111111';
    writeFileSync(resolve(outside,'manifest.json'),JSON.stringify(saved.assignments[0].artifacts));
    symlinkSync(outside,resolve(f.root,'deliveries',id,escapedVersion),process.platform==='win32'?'junction':'dir');
    expect(()=>f.workspace.artifact(id,'result.md',escapedVersion)).toThrow(/escapes/);
  });
  it('keeps an earlier delivery URL addressable after revising and rerunning its assignment',async()=>{
    const f=fixture(),plan=delegate(f),id=plan.assignments[0].id,pumping=f.workspace.pump();await until(()=>f.codex.pending.length===1);f.codex.deliver(0,{content:'# Version one\nOriginal review evidence.'});await pumping;
    const first=f.workspace.snapshot().assignments[0].artifacts[0],version=new URL(first.url,'http://localhost').searchParams.get('version');expect(version).toBeTruthy();
    f.workspace.revise({assignment_id:id,brief:'Prepare an updated version.'});const rerun=f.workspace.pump();await until(()=>f.codex.pending.length===2);f.codex.deliver(1,{content:'# Version two\nUpdated review evidence.'});await rerun;
    expect(readFileSync(f.workspace.artifact(id,'result.md'),'utf8')).toContain('Version two');
    expect(readFileSync(f.workspace.artifact(id,'result.md',version!),'utf8')).toContain('Version one');
    expect(()=>f.workspace.artifact(id,'result.md','../../outside-snapshots')).toThrow();
  });
  it('rejects symlink escapes even when the returned path appears project-relative',async()=>{
    const f=fixture(),plan=delegate(f),cwd=plan.assignments[0].cwd,outside=resolve(f.root,'outside');mkdirSync(outside);writeFileSync(resolve(outside,'private.md'),'outside project');
    symlinkSync(outside,resolve(cwd,'external'),process.platform==='win32'?'junction':'dir');
    const pumping=f.workspace.pump();await until(()=>f.codex.pending.length===1);const run=f.codex.pending[0];
    run.finish({threadId:run.threadId,status:'completed',text:JSON.stringify({name:'Rowan',summary:'Invalid external artifact.',artifacts:['external/private.md'],verification:[]})});await pumping;
    const a=f.workspace.snapshot().assignments[0];expect(a.status).toBe('failed');expect(a.error).toContain('escapes');expect(a.artifacts).toHaveLength(0);
  });
  it('does not apply a completion racing with pause and resumes the saved native session',async()=>{
    const f=fixture(),plan=delegate(f),id=plan.assignments[0].id,pumping=f.workspace.pump();await until(()=>f.codex.pending.length===1);
    f.workspace.pause(id);expect(f.codex.interrupted).toEqual(['native-test-1']);f.codex.deliver(0,{name:'Obsolete'});await pumping;
    let state=f.workspace.snapshot();expect(state.assignments[0].status).toBe('paused');expect(state.assignments[0].summary).toBeUndefined();expect(state.workers[0].name).toBeUndefined();
    f.workspace.resume(id);const resumed=f.workspace.pump();await until(()=>f.codex.pending.length===2);expect(f.codex.pending[1].input.threadId).toBe('native-test-1');
    f.codex.deliver(1,{name:'Rowan'});await resumed;state=f.workspace.snapshot();expect(state.assignments[0].status).toBe('review');expect(state.workers[0].name).toBe('Rowan');
  });
  it('discards stale results after edits and executes the latest revision',async()=>{
    const f=fixture(),plan=delegate(f),id=plan.assignments[0].id,pumping=f.workspace.pump();await until(()=>f.codex.pending.length===1);
    f.workspace.revise({assignment_id:id,brief:'Use the new requirements, not the old draft.'});f.codex.deliver(0,{name:'Obsolete',summary:'Stale result'});
    await until(()=>f.codex.pending.length===2);expect(f.codex.pending[1].input.prompt).toContain('new requirements');expect(f.workspace.snapshot().assignments[0].summary).toBeUndefined();
    f.codex.deliver(1,{name:'Rowan',summary:'Latest requirements delivered.'});await pumping;expect(f.workspace.snapshot().assignments[0].summary).toBe('Latest requirements delivered.');
  });
  it('honors a pause issued while native availability is still being checked',async()=>{
    const f=fixture();let finishHealth!:(value:{available:boolean;authenticated:boolean})=>void;
    f.codex.health=new Promise(resolve=>{finishHealth=resolve;});
    const plan=delegate(f),pumping=f.workspace.pump();f.workspace.pause(plan.assignments[0].id);finishHealth({available:true,authenticated:true});
    await new Promise(r=>setTimeout(r,0));
    // Settle an erroneously started run so a regression produces a bounded assertion failure.
    if(f.codex.pending.length)f.codex.deliver(0);
    await pumping;expect(f.codex.pending).toHaveLength(0);expect(f.workspace.snapshot().assignments[0].status).toBe('paused');
  });
  it('propagates failed dependency as waiting without running dependent work',async()=>{
    const f=fixture();delegate(f,[work(),work('review',['build'])]);const pumping=f.workspace.pump();await until(()=>f.codex.pending.length===1);const run=f.codex.pending[0];
    run.finish({threadId:run.threadId,status:'failed',text:'',error:'Real command failed.'});await pumping;
    expect(f.workspace.snapshot().assignments.map(a=>a.status)).toEqual(['failed','waiting']);expect(f.codex.pending).toHaveLength(1);expect(f.workspace.snapshot().assignments[1].error).toContain('Dependency');
  });
  it('retains independently scoped project memory and decisions after reload',()=>{
    const f=fixture(),other=f.projects.create({name:'Another project',brief:'Separate goal'});f.workspace.syncProjects();
    f.workspace.updateProject({project_id:f.project.id,goal:'The revised real outcome.',checkpoint:'Verify the result',next_step:'Review actual evidence'});
    const open=f.workspace.decide({project_id:f.project.id,title:'Choose scope',context:'A real tradeoff',options:['Small','Large'],status:'open'});
    f.workspace.decide({id:open.decision.id,project_id:f.project.id,status:'decided',decision:'Small',reason:'Finish the bounded demo first.'});
    expect(()=>f.workspace.decide({id:open.decision.id,project_id:other.id,status:'decided',decision:'Large'})).toThrow('Wrong decision');
    const restored=new AgencyWorkspace(f.store,f.projects,new ControlledCodex(),()=>{},{autoStart:false});workspaces.push(restored);
    expect(restored.snapshot().projects.find(p=>p.id===f.project.id)?.memory.nextStep).toBe('Review actual evidence');expect(restored.snapshot().projects.find(p=>p.id===other.id)?.goal).toBe('Separate goal');
    expect(restored.snapshot().decisions[0]).toMatchObject({status:'decided',decision:'Small',reason:'Finish the bounded demo first.'});
  });
  it('keeps named worker identity and native context when reused',async()=>{
    const f=fixture(),first=delegate(f),pumping=f.workspace.pump();await until(()=>f.codex.pending.length===1);f.codex.deliver(0,{name:'Rowan'});await pumping;f.workspace.accept(first.assignments[0].id);
    const second=delegate(f,[{...work('followup'),reuse_worker_id:first.workers[0].id}]),running=f.workspace.pump();await until(()=>f.codex.pending.length===2);
    expect(second.workers[0].name).toBe('Rowan');expect(f.codex.pending[1].input.threadId).toBe('native-test-1');expect(f.codex.pending[1].input.prompt).toContain('Your established name is Rowan');
    f.codex.deliver(1,{name:'ChangedName',path:'followup.md'});await running;expect(f.workspace.snapshot().workers).toHaveLength(1);expect(f.workspace.snapshot().workers[0].name).toBe('Rowan');
  });
  it('retains native session but pauses unverified active work on host recovery',async()=>{
    const f=fixture();delegate(f);const pumping=f.workspace.pump();await until(()=>f.codex.pending.length===1);
    const restored=new AgencyWorkspace(f.store,f.projects,new ControlledCodex(),()=>{},{autoStart:false});workspaces.push(restored);await restored.recover();
    expect(restored.snapshot().assignments[0]).toMatchObject({status:'paused',sessionId:'native-test-1'});
    // Settle the old controlled host before fixture cleanup; the recovery assertion above checks the persisted checkpoint.
    f.workspace.pause(f.workspace.snapshot().assignments[0].id);f.codex.deliver(0);await pumping;
  });
  it('runs a Claude worker on the Claude runner, records its engine, and keeps Codex as the default',async()=>{
    const f=withClaude(),plan=delegate(f,[{...work(),provider:'claude'}]),pumping=f.workspace.pump();await until(()=>f.claude.pending.length===1);
    expect(f.codex.pending).toHaveLength(0);expect(plan.assignments[0].provider).toBe('claude');expect(plan.workers[0].provider).toBe('claude');
    f.claude.deliver(0);await pumping;
    const state=f.workspace.snapshot();expect(state.assignments[0]).toMatchObject({status:'review',provider:'claude'});expect(state.workers[0].provider).toBe('claude');
    expect(f.workspace.briefing().id).toBe(state.briefings[0].id);expect(executions(f)[0].provider).toBe('claude');
    delegate(f,[work('other')]);const other=f.workspace.pump();await until(()=>f.codex.pending.length===1);f.codex.deliver(0,{name:'Ellis',path:'other.md'});await other;
    expect(f.claude.pending).toHaveLength(1);expect(executions(f)[1].provider).toBe('codex');expect(f.workspace.snapshot().assignments[1].provider).toBe('codex');
  });
  it('keeps a reused worker on its native engine and rejects switching engines atomically',async()=>{
    const f=withClaude(),first=delegate(f,[{...work(),provider:'claude'}]),pumping=f.workspace.pump();await until(()=>f.claude.pending.length===1);f.claude.deliver(0,{name:'Rowan'});await pumping;f.workspace.accept(first.assignments[0].id);
    const before=f.workspace.snapshot();expect(()=>delegate(f,[{...work('followup'),reuse_worker_id:first.workers[0].id,provider:'codex'}])).toThrow('Reused worker is bound');expect(f.workspace.snapshot()).toEqual(before);
    delegate(f,[{...work('followup'),reuse_worker_id:first.workers[0].id}]);const running=f.workspace.pump();await until(()=>f.claude.pending.length===2);
    expect(f.claude.pending[1].input.threadId).toBe('native-test-1');expect(f.codex.pending).toHaveLength(0);f.claude.deliver(1,{path:'followup.md'});await running;
    expect(f.workspace.snapshot().assignments[1].provider).toBe('claude');
  });
  it('rejects Claude work before any mutation when Claude Code is not connected',()=>{
    const f=fixture(),before=f.workspace.snapshot();
    expect(()=>delegate(f,[{...work(),provider:'claude'}])).toThrow('not connected');expect(f.workspace.snapshot()).toEqual(before);
  });
  it('interrupts a paused running Claude assignment on the Claude runner',async()=>{
    const f=withClaude(),plan=delegate(f,[{...work(),provider:'claude'}]),pumping=f.workspace.pump();await until(()=>f.claude.pending.length===1);
    f.workspace.pause(plan.assignments[0].id);expect(f.claude.interrupted).toEqual(['native-test-1']);expect(f.codex.interrupted).toEqual([]);
    f.claude.deliver(0);await pumping;expect(f.workspace.snapshot().assignments[0].status).toBe('paused');
  });
});
