import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {AgencyWorkspace,type CodexRunner} from '../apps/server/src/agency/workspace';
import {OfficeStore} from '../apps/server/src/agency/state';
import {Projects} from '../apps/server/src/agency/projects';
import {parsePlan} from '../apps/server/src/agency/plans';

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
  deliver(index:number,{name='Rowan',path='result.md'}:{name?:string;path?:string}={}){
    const run=this.pending[index],file=resolve(run.input.cwd,path);
    mkdirSync(dirname(file),{recursive:true});writeFileSync(file,'# Fixture artifact\n\nWritten by the controlled test runner.');
    run.finish({threadId:run.threadId,status:'completed',text:JSON.stringify({name,summary:`${name} built ${path}.`,artifacts:[path],verification:['Fixture file was written.']})});
  }
  reply(index:number,body:unknown,prefix=''){const run=this.pending[index];run.finish({threadId:run.threadId,status:'completed',text:prefix+JSON.stringify(body)});}
}
const roots:string[]=[];
const workspaces:AgencyWorkspace[]=[];
afterEach(()=>{
  for(const workspace of workspaces.splice(0))workspace.close();
  for(const path of roots.splice(0)){
    if(!path.startsWith(join(tmpdir(),'agency-brain-')))throw Error('Unexpected fixture directory');
    rmSync(path,{recursive:true,force:true});
  }
});
function fixture(options:{defaultProvider?:'claude'|'codex';brain?:boolean}={}){
  const root=mkdtempSync(join(tmpdir(),'agency-brain-'));roots.push(root);
  const store=new OfficeStore(root),projects=new Projects(store),project=projects.create({name:'Demo',brief:'Deliver a working local demo.'}),codex=new ControlledCodex(),claude=new ControlledCodex(),brain=new ControlledCodex();
  const workspace=new AgencyWorkspace(store,projects,codex,()=>{},{autoStart:false,claude,brain:options.brain===false?undefined:brain,defaultProvider:options.defaultProvider});workspaces.push(workspace);
  return {root,store,projects,project,codex,claude,brain,workspace};
}
const work=(key:string,depends_on:string[]=[],extra:object={})=>({key,role:key,responsibility:`Own ${key}.`,brief:`Produce ${key}.`,acceptance:'A nonempty file.',depends_on,...extra});
const plan=(workers:object[])=>({title:'Demo outcome',checkpoint:'A verified deliverable',rationale:'Split by file ownership.',workers});
async function until(predicate:()=>boolean){
  const start=Date.now();while(!predicate()){if(Date.now()-start>2000)throw Error('Timed out awaiting controlled execution');await new Promise(r=>setTimeout(r,0));}
}
/** Delegate a goal and run the brain's plan step to the point where the crew is staffed. */
async function planned(f:ReturnType<typeof fixture>,workers:object[]){
  f.workspace.delegate({project_id:f.project.id,goal:'Build a page and its form.'});const pumping=f.workspace.pump();
  await until(()=>f.brain.pending.length===1);f.brain.reply(0,plan(workers),'Here is the plan:\n');
  return pumping;
}

describe('Donna\'s brain',()=>{
  it('parses a fenced or prose-prefixed plan and rejects malformed ones',()=>{
    const good=plan([work('page')]);
    expect(parsePlan('```json\n'+JSON.stringify(good)+'\n```').workers).toHaveLength(1);expect(parsePlan('Sure, here you go: '+JSON.stringify(good)+' Done.').title).toBe('Demo outcome');
    expect(()=>parsePlan(JSON.stringify(plan([work('a',['b']),work('b',['a'])])))).toThrow('Cyclic');
    expect(()=>parsePlan(JSON.stringify(plan([work('a',['ghost'])])))).toThrow('Dependencies must refer');
    expect(()=>parsePlan(JSON.stringify(plan(['a','b','c','d','e'].map(k=>work(k)))))).toThrow();
    expect(()=>parsePlan(JSON.stringify({...good,title:undefined}))).toThrow();
    expect(()=>parsePlan('I could not decide on a plan.')).toThrow('no JSON object');
  });
  it('queues a lead-owned plan, then fans out the crew in dependency order and reviews with the same brain session',async()=>{
    const f=fixture(),queued=f.workspace.delegate({project_id:f.project.id,goal:'Build a page and its form.'}).assignment;
    const before=f.workspace.snapshot(),lead=before.workers.find(w=>w.id===queued.workerId)!;
    expect(lead.lead).toBe(true);expect(before.assignments).toHaveLength(1);expect(before.assignments[0]).toMatchObject({kind:'plan',status:'queued'});
    expect(f.workspace.progress(f.project.id)).toBe('Your brain is planning "Build a page and its form." (queued)');
    const pumping=f.workspace.pump();await until(()=>f.brain.pending.length===1);
    expect(f.brain.pending[0].input.prompt).toContain('Build a page and its form.');expect(f.brain.pending[0].input.prompt).toContain(queued.cwd);
    f.brain.reply(0,plan([work('page'),work('form',['page'])]),'Plan:\n');
    await until(()=>f.codex.pending.length===1);await new Promise(r=>setTimeout(r,20));
    expect(f.codex.pending).toHaveLength(1);expect(f.codex.pending[0].input.prompt).toContain('Produce page.');
    expect(f.workspace.progress(f.project.id)).toMatch(/^Plan done\. Team: \w+: working \(.+\); \w+: queued\. Review: waits for the team$/);
    f.codex.deliver(0,{name:'Rowan',path:'page.html'});await until(()=>f.codex.pending.length===2);expect(f.codex.pending[1].input.prompt).toContain('Produce form.');
    f.codex.deliver(1,{name:'Ellis',path:'form.js'});await until(()=>f.brain.pending.length===2);
    expect(f.brain.pending[1].input.threadId).toBe(f.brain.pending[0].threadId);
    f.brain.reply(1,{summary:'Rowan and Ellis built the page and form.',verification:['Read both files']});await pumping;
    const snap=f.workspace.snapshot();
    expect(f.workspace.progress(f.project.id)).toBe('Plan done. Team: Rowan: review; Ellis: review. Review: done; the briefing is ready');
    expect(snap.assignments.map(a=>[a.kind||a.title,a.status])).toEqual([['plan','done'],['page','review'],['form','review'],['review','review']]);
  });
  it('writes exactly one briefing from the review, credited to the crew rather than the lead',async()=>{
    const f=fixture(),pumping=planned(f,[work('page'),work('form',['page'])]);
    await until(()=>f.codex.pending.length===1);f.codex.deliver(0,{name:'Rowan',path:'page.html'});await until(()=>f.codex.pending.length===2);f.codex.deliver(1,{name:'Ellis',path:'form.js'});
    await until(()=>f.brain.pending.length===2);f.brain.reply(1,{summary:'Rowan and Ellis built it.',verification:['Read both files']});await pumping;
    const snap=f.workspace.snapshot(),crew=snap.assignments.filter(a=>!a.kind),[b]=snap.briefings;
    expect(snap.briefings).toHaveLength(1);expect(b.status).toBe('queued');expect(b.contributors.map(c=>c.name)).toEqual(['Rowan','Ellis']);expect(JSON.stringify(b.contributors)).not.toContain('Donna');
    expect(b.artifacts.map(a=>a.path)).toEqual(['page.html','form.js']);expect(b.summary).toBe('Rowan and Ellis built it.');expect(b.workerId).toBe(crew[1].workerId);
    expect(snap.workers.find(w=>w.id===b.workerId)!.lead).toBeUndefined();
  });
  it('fails an invalid plan without staffing anyone or writing a briefing',async()=>{
    const f=fixture();await planned(f,[work('a',['b']),work('b',['a'])]);
    const snap=f.workspace.snapshot();expect(snap.assignments).toHaveLength(1);expect(snap.assignments[0]).toMatchObject({kind:'plan',status:'failed'});expect(snap.assignments[0].error).toContain('Cyclic');
    expect(snap.workers.filter(w=>!w.lead)).toHaveLength(0);expect(snap.briefings).toHaveLength(0);expect(f.codex.pending).toHaveLength(0);
  });
  it('sends unmarked crew to defaultProvider and honors an explicit provider in the plan',async()=>{
    const f=fixture({defaultProvider:'claude'}),pumping=planned(f,[work('a'),work('b',[],{provider:'codex'})]);
    await until(()=>f.claude.pending.length===1);expect(f.codex.pending).toHaveLength(0);
    const crew=f.workspace.snapshot().assignments.filter(a=>!a.kind);expect(crew.map(a=>a.provider)).toEqual(['claude','codex']);
    f.claude.deliver(0,{name:'Rowan',path:'a.md'});await until(()=>f.codex.pending.length===1);f.codex.deliver(0,{name:'Ellis',path:'b.md'});
    await until(()=>f.brain.pending.length===2);f.brain.reply(1,{summary:'Both done.'});await pumping;
  });
  it('refuses to delegate without a brain and leaves the office untouched',()=>{
    const f=fixture({brain:false}),before=f.workspace.snapshot(),catalog=f.projects.list();
    expect(()=>f.workspace.delegate({project_id:f.project.id,goal:'Build it'})).toThrow('brain is not connected');expect(f.workspace.snapshot()).toEqual(before);
    expect(()=>f.workspace.createProject({name:'New room',brief:'Build it',initial_work:'Build it'})).toThrow('brain is not connected');expect(f.projects.list()).toEqual(catalog);expect(f.workspace.snapshot()).toEqual(before);
  });
  it('still lands the briefing and records one open decision when the review needs input',async()=>{
    const f=fixture(),pumping=planned(f,[work('page')]);
    await until(()=>f.codex.pending.length===1);f.codex.deliver(0,{name:'Rowan',path:'page.html'});await until(()=>f.brain.pending.length===2);
    f.brain.reply(1,{summary:'The page works.',verification:['Read page.html'],needsInput:'Should the form use dark mode?'});await pumping;
    const snap=f.workspace.snapshot(),open=snap.decisions.filter(d=>d.status==='open');
    expect(snap.assignments.find(a=>a.kind==='review')!.status).toBe('review');expect(snap.briefings).toHaveLength(1);expect(snap.briefings[0].summary).toContain('Should the form use dark mode?');
    expect(open).toHaveLength(1);expect(open[0].context).toBe('Should the form use dark mode?');
  });
});
