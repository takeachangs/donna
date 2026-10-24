import {afterEach,describe,expect,it} from 'vitest';
import {existsSync,mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {AgencyWorkspace,type CodexRunner} from '../apps/server/src/agency/workspace';
import {OfficeStore} from '../apps/server/src/agency/state';
import {Projects} from '../apps/server/src/agency/projects';
import {agentEvents,parseTranscript,statusSentence} from '../apps/server/src/agency/transcript';

type RunInput=Parameters<CodexRunner['run']>[0];
type RunResult=Awaited<ReturnType<CodexRunner['run']>>;
class ControlledBrain implements CodexRunner {
  pending:{input:RunInput;finish:(result:RunResult)=>void;threadId:string}[]=[];injected:{threadId:string;text:string}[]=[];accepts=true;
  status(){return Promise.resolve({available:true,authenticated:true});}
  run(input:RunInput):Promise<RunResult>{
    const threadId=input.threadId||`brain-${this.pending.length+1}`;input.onThread?.(threadId);
    return new Promise(finish=>this.pending.push({input,finish,threadId}));
  }
  inject(threadId:string,text:string){if(this.accepts)this.injected.push({threadId,text});return this.accepts;}
  async interrupt(){}
  close(){}
  emit(i:number,e:any){this.pending[i].input.onEvent!({method:'claude/'+e.type,params:e});}
  reply(i:number,body:unknown){const run=this.pending[i];run.finish({threadId:run.threadId,status:'completed',text:JSON.stringify(body)});}
}
const roots:string[]=[];
const workspaces:AgencyWorkspace[]=[];
afterEach(()=>{
  for(const w of workspaces.splice(0))w.close();
  for(const path of roots.splice(0)){if(!path.startsWith(join(tmpdir(),'agency-orch-')))throw Error('Unexpected fixture directory');rmSync(path,{recursive:true,force:true});}
});
function fixture(){
  const root=mkdtempSync(join(tmpdir(),'agency-orch-'));roots.push(root);
  const store=new OfficeStore(root),projects=new Projects(store),project=projects.create({name:'Demo',brief:'Deliver a working local demo.'}),brain=new ControlledBrain();
  const codex={status:()=>Promise.resolve({available:true,authenticated:true}),run:()=>Promise.reject(Error('the pump must not run a crew row')),interrupt:async()=>{},close(){}} as CodexRunner;
  const workspace=new AgencyWorkspace(store,projects,codex,()=>{},{autoStart:false,brain});workspaces.push(workspace);
  return {root,store,projects,project,brain,workspace};
}
type F=ReturnType<typeof fixture>;
async function until(predicate:()=>boolean){const start=Date.now();while(!predicate()){if(Date.now()-start>2000)throw Error('Timed out');await new Promise(r=>setTimeout(r,0));}}
async function running(f:F,goal='Build a page and its form.'){
  const {assignment}=f.workspace.delegate({project_id:f.project.id,goal}) as {assignment:{cwd:string}},pumping=f.workspace.pump();
  await until(()=>f.brain.pending.length===1);return {pumping,cwd:assignment.cwd};
}
const use=(id:string,name:string,input:object,parent?:string)=>({type:'assistant',parent_tool_use_id:parent,message:{content:[{type:'tool_use',id,name,input}]}});
const agent=(id:string,description:string,extra:object={})=>use(id,'Agent',{description,prompt:`Do: ${description}`,run_in_background:true,model:'sonnet',...extra});
const ack=(id:string,agentId:string)=>({type:'user',message:{content:[{type:'tool_result',tool_use_id:id,content:[{type:'text',text:`Async agent launched successfully.\nagentId: ${agentId}`}]}]}});
const started=(task:string,tool:string)=>({type:'system',subtype:'task_started',task_id:task,tool_use_id:tool,task_type:'local_agent'});
const notified=(task:string,tool:string,status='completed')=>({type:'system',subtype:'task_notification',task_id:task,tool_use_id:tool,status,summary:'Agent finished'});
const text=(t:string,parent?:string)=>({type:'assistant',parent_tool_use_id:parent,message:{content:[{type:'text',text:t}]}});
const crewOf=(f:F)=>f.workspace.snapshot().assignments.filter(a=>a.agent);
const workerOf=(f:F,name:string)=>f.workspace.snapshot().workers.find(w=>w.name===name)!;

describe('transcript',()=>{
  it('turns one stream-json event into typed facts',()=>{
    expect(agentEvents(agent('t1','Build the page',{name:'Mika',effort:'low'}))).toEqual([{kind:'spawn',toolUseId:'t1',name:'Mika',description:'Build the page',prompt:'Do: Build the page',model:'sonnet',effort:'low'}]);
    expect(agentEvents(ack('t1','a1'))).toEqual([{kind:'ack',toolUseId:'t1',agentId:'a1'}]);
    expect(agentEvents({type:'user',message:{content:[{type:'tool_result',tool_use_id:'t2',content:'[Subagent hand-back] all done'}]}})).toEqual([{kind:'result',toolUseId:'t2',report:'[Subagent hand-back] all done'}]);
    expect(agentEvents(started('k1','t1'))).toEqual([{kind:'task',toolUseId:'t1',taskId:'k1'}]);
    expect(agentEvents(notified('k1','t1','failed'))).toEqual([{kind:'done',toolUseId:'t1',taskId:'k1',ok:false,report:'Agent finished'}]);
    expect(agentEvents({type:'queue-operation',operation:'enqueue',content:'<task-notification><task-id>k1</task-id><tool-use-id>t1</tool-use-id><status>completed</status></task-notification>'})).toEqual([{kind:'done',toolUseId:'t1',ok:true}]);
    const act=(name:string,input:object)=>agentEvents(use('x',name,input,'t1'));
    expect(act('Write',{file_path:'/p/index.html'})).toEqual([{kind:'action',parent:'t1',tool:'Write',action:'Editing /p/index.html',file:'/p/index.html'}]);
    expect(act('Read',{file_path:'a.md'})[0]).toMatchObject({action:'Reading a.md'});
    expect(act('Bash',{command:'ls'+' x'.repeat(80),description:'List files'})[0]).toMatchObject({action:'Running List files'});
    expect((act('Bash',{command:'y'.repeat(200)})[0] as {action:string}).action).toHaveLength('Running '.length+80);
    expect(act('Grep',{pattern:'x'})[0]).toMatchObject({action:'Searching the project'});expect(act('Glob',{pattern:'*'})[0]).toMatchObject({action:'Searching the project'});
    expect(agentEvents(text('Finished the page.',  't1'))).toEqual([{kind:'said',parent:'t1',text:'Finished the page.'}]);
    expect(agentEvents(use('m','SendMessage',{to:'Mika',message:'Use blue'}))).toEqual([{kind:'message',to:'Mika',text:'Use blue'}]);
    expect(agentEvents(text('First line\nsecond line'))).toEqual([{kind:'note',text:'First line'}]);
    expect(agentEvents(text('  {"summary":"final briefing JSON"}'))).toEqual([]);
    expect(agentEvents(use('w','Edit',{file_path:'/p/a.md'}))).toEqual([{kind:'file',file:'/p/a.md'}]);
    expect(agentEvents(null)).toEqual([]);expect(agentEvents({type:'result',result:'x'})).toEqual([]);
  });
  it('folds a transcript like dash.py: the launch ack is not completion',()=>{
    const lines=[agent('t1','Build the page',{name:'Mika'}),ack('t1','a1'),agent('t2','Write the form handler'),text('On it'),agent('t3','Check links')].map(e=>JSON.stringify(e));
    const open=parseTranscript(['not json',...lines]);
    expect(open.note).toBe('On it');expect(open.agents.map(a=>[a.name,a.agentId,a.done])).toEqual([['Mika','a1',false],['Write the',undefined,false],['Check links',undefined,false]]);
    const done=parseTranscript([...lines,JSON.stringify(started('k1','t1')),JSON.stringify(notified('k1','t1')),JSON.stringify(notified('k2','t2','failed')),
      JSON.stringify({type:'user',message:{content:[{type:'tool_result',tool_use_id:'t3',content:'Report text'}]}}),
      JSON.stringify({type:'queue-operation',operation:'enqueue',content:'<task-notification><tool-use-id>t3</tool-use-id><status>killed</status></task-notification>'})]);
    expect(done.agents.map(a=>[a.done,a.ok])).toEqual([[true,true],[true,false],[true,false]]);
    const resumed=parseTranscript([...lines,JSON.stringify(started('k1','t1')),JSON.stringify(notified('k1','t1')),JSON.stringify(started('k1','msg1'))]);
    expect(resumed.agents[0].done).toBe(false);
  });
  it('says what a worker is doing, how long, and how it ended',()=>{
    const now=Date.parse('2026-01-01T00:10:00Z'),at=(s:number)=>new Date(now-s*1000).toISOString();
    expect(statusSentence({name:'Mika',status:'working',title:'Page',action:'Editing index.html',actionAt:at(12),startedAt:at(120)},now)).toBe('Mika is editing index.html (12 s ago), on it for 2 min.');
    expect(statusSentence({name:'Mika',status:'working',title:'Page'},now)).toBe('Mika is working.');
    expect(statusSentence({name:'Wren',status:'review',title:'Contact form',completedAt:at(40)},now)).toBe('Wren finished "Contact form" 40 s ago.');
    expect(statusSentence({name:'Wren',status:'failed',title:'Contact form',error:'Did not report back'},now)).toBe('Wren failed "Contact form": Did not report back.');
    expect(statusSentence({name:'Wren',status:'paused',title:'x',action:"Unknown after restart; Donna's brain re-checks it on its next turn"},now)).toBe("Wren is paused (unknown after restart; Donna's brain re-checks it on its next turn).");
    expect(statusSentence({name:'Wren',status:'queued',title:'x'},now)).toBe('Wren is queued.');
  });
});

describe('Donna\'s brain as orchestrator',()=>{
  it('maps parallel Agent spawns to named workers, then writes one briefing credited to them',async()=>{
    const f=fixture(),{pumping,cwd}=await running(f);
    expect(f.brain.pending[0].input.prompt).toMatch(/^Follow the donna-brain skill\.\nPROJECT: Demo\n/);expect(f.brain.pending[0].input.prompt).toContain('REQUEST: Build a page and its form.');
    f.brain.emit(0,text('Splitting this into a page and a form.'));f.brain.emit(0,agent('toolu_a','Build the page',{name:'Mika'}));f.brain.emit(0,agent('toolu_b','Write contact form handler'));
    f.brain.emit(0,ack('toolu_a','ag1'));f.brain.emit(0,ack('toolu_b','ag2'));f.brain.emit(0,started('task_a','toolu_a'));f.brain.emit(0,started('task_b','toolu_b'));
    let snap=f.workspace.snapshot(),crew=snap.assignments.filter(a=>a.agent);
    expect(crew.map(c=>[c.title,c.status,c.agent!.model])).toEqual([['Build the page','working','sonnet'],['Write contact form handler','working','sonnet']]);
    expect(snap.workers.filter(w=>!w.lead).map(w=>[w.name,w.status])).toEqual([['Mika','working'],['Write contact','working']]);
    expect(new Set(snap.workers.filter(w=>!w.lead).map(w=>w.characterKey)).size).toBe(2);
    expect(snap.workers.find(w=>w.lead)!.currentAction).toBe('Splitting this into a page and a form.');
    expect(workerOf(f,'Mika').currentAction).toBe('Starting: Build the page');
    mkdirSync(cwd,{recursive:true});writeFileSync(resolve(cwd,'index.html'),'<h1>Hi</h1>');writeFileSync(resolve(cwd,'form.js'),'export const x=1;');
    f.brain.emit(0,use('s1','Write',{file_path:resolve(cwd,'index.html')},'toolu_a'));
    expect(workerOf(f,'Mika').currentAction).toBe('Editing index.html');expect(workerOf(f,'Mika').actionAt).toBeTruthy();
    f.brain.emit(0,use('s2','Edit',{file_path:'form.js'},'toolu_b'));f.brain.emit(0,use('s3','Write',{file_path:resolve(cwd,'.claude/skills/x.md')},'toolu_b'));
    f.brain.emit(0,text('Built index.html.','toolu_a'));f.brain.emit(0,notified('task_a','toolu_a'));
    snap=f.workspace.snapshot();crew=snap.assignments.filter(a=>a.agent);
    expect(crew[0]).toMatchObject({status:'review',summary:'Built index.html.'});expect(crew[0].artifacts.map(a=>a.path)).toEqual(['index.html']);expect(crew[0].completedAt).toBeTruthy();
    expect(workerOf(f,'Mika')).toMatchObject({status:'review',currentAction:"Reported to Donna's brain"});expect(snap.briefings).toHaveLength(0);
    f.brain.emit(0,{type:'user',message:{content:[{type:'tool_result',tool_use_id:'toolu_b',content:'[Subagent hand-back] Form handler done.'}]}});
    expect(f.workspace.snapshot().assignments.filter(a=>a.agent)[1]).toMatchObject({status:'review',summary:'[Subagent hand-back] Form handler done.'});
    writeFileSync(resolve(cwd,'notes.txt'),'left behind by the brain');mkdirSync(resolve(cwd,'node_modules/x'),{recursive:true});writeFileSync(resolve(cwd,'node_modules/x/i.js'),'no');
    f.brain.reply(0,{summary:'Mika built the page and Write contact the form.',verification:['Read both files']});await f.workspace.pump();await pumping;
    snap=f.workspace.snapshot();const step=snap.assignments.find(a=>a.kind==='plan')!;
    expect(step.status).toBe('review');expect(step.dependsOn).toEqual(crew.map(c=>c.id));expect(step.artifacts.map(a=>a.path)).toEqual(['notes.txt']);
    expect(snap.briefings).toHaveLength(1);const [b]=snap.briefings;
    expect(b.contributors.map(c=>c.name)).toEqual(['Mika','Write contact']);expect(b.artifacts.map(a=>a.path)).toEqual(['index.html','form.js','notes.txt']);expect(b.summary).toContain('Mika built the page');
    expect(f.workspace.progress(f.project.id)).toBe('Your brain is done with "Build a page and its form."; the briefing is ready.');
  });
  it('names workers: case-insensitive reuse when idle, a number when busy',async()=>{
    const f=fixture(),{pumping}=await running(f);
    f.brain.emit(0,agent('t1','Build the page',{name:'Mika'}));f.brain.emit(0,agent('t2','Another page',{name:'mika'}));f.brain.emit(0,agent('t3','Third',{name:'MIKA'}));
    const names=()=>f.workspace.snapshot().workers.filter(w=>!w.lead).map(w=>[w.name,w.status]);
    expect(names()).toEqual([['Mika','working'],['mika 2','working'],['MIKA 3','working']]);
    f.brain.emit(0,{type:'user',message:{content:[{type:'tool_result',tool_use_id:'t1',content:'done'}]}});expect(names()[0]).toEqual(['Mika','review']);
    f.brain.emit(0,agent('t4','Fourth',{name:'mika'}));
    expect(names()).toEqual([['Mika','working'],['mika 2','working'],['MIKA 3','working']]);expect(crewOf(f)).toHaveLength(4);
    f.brain.reply(0,{summary:'ok'});await pumping;
    const snap=f.workspace.snapshot();expect(crewOf(f).map(c=>[c.status,c.error])).toEqual([['review',undefined],['failed','Did not report back'],['failed','Did not report back'],['failed','Did not report back']]);
    expect(snap.assignments.find(a=>a.kind==='plan')!.dependsOn).toEqual([crewOf(f)[0].id]);
  });
  it('does not reuse a name that another room holds',async()=>{
    const f=fixture(),other=f.projects.create({name:'Other',brief:'x'});f.workspace.syncProjects();
    f.workspace.delegate({project_id:other.id,goal:'Other room job'});f.workspace.delegate({project_id:f.project.id,goal:'Mine'});const pumping=f.workspace.pump();
    await until(()=>f.brain.pending.length===1);f.brain.emit(0,agent('t1','Theirs',{name:'Mika'}));f.brain.reply(0,{summary:'ok'});
    await until(()=>f.brain.pending.length===2);f.brain.emit(1,agent('t2','Mine',{name:'Mika'}));f.brain.reply(1,{summary:'ok'});await pumping;
    expect(f.workspace.snapshot().workers.filter(w=>!w.lead).map(w=>[w.name,w.projectId])).toEqual([['Mika',other.id],['Mika 2',f.project.id]]);
  });
  it('maps a SendMessage-resumed task back to its worker by task id',async()=>{
    const f=fixture(),{pumping}=await running(f);
    f.brain.emit(0,agent('t1','Build the page',{name:'Mika'}));f.brain.emit(0,started('k1','t1'));f.brain.emit(0,notified('k1','t1'));
    expect(crewOf(f)[0].status).toBe('review');
    f.brain.emit(0,use('msg1','SendMessage',{to:'Mika',message:'Make it blue please'}));expect(workerOf(f,'Mika').currentAction).toBe("Message from Donna's brain: Make it blue please");
    f.brain.emit(0,started('k1','msg1'));
    expect(crewOf(f)).toHaveLength(1);expect(crewOf(f)[0]).toMatchObject({status:'working',completedAt:undefined});expect(workerOf(f,'Mika').status).toBe('working');
    f.brain.emit(0,use('s1','Bash',{command:'ls',description:'List files'},'t1'));expect(workerOf(f,'Mika').currentAction).toBe('Running List files');
    f.brain.emit(0,notified('k1','msg1'));expect(crewOf(f)[0].status).toBe('review');
    f.brain.reply(0,{summary:'Done.'});await pumping;
  });
  it('resumes a worker from an earlier turn under a new crew row, with its own briefing and title',async()=>{
    const f=fixture(),{pumping,cwd}=await running(f);mkdirSync(cwd,{recursive:true});writeFileSync(resolve(cwd,'index.html'),'<h1>Hi</h1>');
    f.brain.emit(0,agent('t1','Build the page',{name:'Mika'}));f.brain.emit(0,started('k1','t1'));f.brain.emit(0,use('s1','Write',{file_path:resolve(cwd,'index.html')},'t1'));f.brain.emit(0,notified('k1','t1'));
    f.brain.reply(0,{title:'The page',summary:'Mika built it.',verification:['Read it']});await pumping;
    let snap=f.workspace.snapshot();const first=snap.briefings[0];expect(snap.briefings).toHaveLength(1);expect(first.title).toBe('The page');expect(snap.assignments.find(a=>a.kind==='plan')!.title).toBe('The page');
    f.workspace.message({project_id:f.project.id,worker:'Mika',text:'Use a blue palette'});const again=f.workspace.pump();await until(()=>f.brain.pending.length===2);
    f.brain.emit(1,use('msg1','SendMessage',{to:'Mika',message:'Use a blue palette'}));f.brain.emit(1,started('k1','msg1'));
    expect(crewOf(f)).toHaveLength(2);expect(crewOf(f)[1]).toMatchObject({status:'working',title:'Build the page',workerId:crewOf(f)[0].workerId});expect(crewOf(f)[0].status).toBe('review');expect(workerOf(f,'Mika').status).toBe('working');
    writeFileSync(resolve(cwd,'style.css'),'body{color:blue}');
    f.brain.emit(1,use('s2','Write',{file_path:resolve(cwd,'style.css')},'t1'));expect(workerOf(f,'Mika').currentAction).toBe('Editing style.css');
    f.brain.emit(1,notified('k1','msg1'));
    snap=f.workspace.snapshot();const [old,fresh]=crewOf(f);
    expect(fresh).toMatchObject({status:'review',agent:{brainId:snap.assignments.filter(a=>a.kind==='plan')[1].id}});expect(fresh.artifacts.map(a=>a.path)).toEqual(['style.css']);expect(old.artifacts.map(a=>a.path)).toEqual(['index.html']);
    f.brain.reply(1,{summary:'Mika made it blue.',verification:['Read style.css']});await again;
    snap=f.workspace.snapshot();const step2=snap.assignments.filter(a=>a.kind==='plan')[1];
    expect(step2.dependsOn).toEqual([fresh.id]);expect(step2.title).toBe(step2.brief.slice(0,120));
    expect(snap.briefings).toHaveLength(2);expect(snap.briefings[0]).toMatchObject({id:first.id,status:'queued'});expect(snap.briefings[1].contributors.map(c=>c.name)).toEqual(['Mika']);expect(snap.briefings[1].artifacts.map(a=>a.path)).toEqual(['style.css']);
  });
  it('answers worker_status for one worker and for all',async()=>{
    const f=fixture(),{pumping,cwd}=await running(f);
    expect(f.workspace.workerStatus('all',f.project.id).status).toBe("Donna's brain: Planning the team");
    f.brain.emit(0,agent('t1','Build the page',{name:'Mika'}));f.brain.emit(0,agent('t2','Contact form',{name:'Wren'}));
    mkdirSync(cwd,{recursive:true});f.brain.emit(0,use('s1','Write',{file_path:resolve(cwd,'index.html')},'t1'));
    expect(f.workspace.workerStatus('mika',f.project.id).status).toMatch(/^Mika is editing index\.html \(\d+ s ago\), on it for \d+ s\.$/);
    f.brain.emit(0,{type:'user',message:{content:[{type:'tool_result',tool_use_id:'t2',content:'Form done'}]}});
    const all=f.workspace.workerStatus('ALL').status;expect(all).toContain("Donna's brain: Planning the team");expect(all).toMatch(/Mika is editing index\.html.*Wren finished "Contact form" \d+ s ago\./);
    expect(f.workspace.progress(f.project.id)).toMatch(/^Your brain is on "Build a page and its form\.": Mika is editing index\.html .* Wren finished "Contact form" \d+ s ago\.$/);
    expect(()=>f.workspace.workerStatus('Zed')).toThrow('Known workers: Mika, Wren');
    f.brain.reply(0,{summary:'Done.'});await pumping;
  });
  it('delivers a message now when the live session takes it',async()=>{
    const f=fixture(),{pumping}=await running(f);f.brain.emit(0,agent('t1','Build the page',{name:'Mika'}));
    const r=f.workspace.message({project_id:f.project.id,worker:'MIKA',text:'Use blue'});
    expect(r).toMatchObject({committed:true,delivered:'now',worker:'Mika'});expect(r.note).toContain('forwards it to Mika now');
    expect(f.brain.injected).toEqual([{threadId:'brain-1',text:"MESSAGE FOR Mika (from the user, through Donna's voice): Use blue"}]);
    expect(()=>f.workspace.message({worker:'Zed',text:'hi'})).toThrow('Known workers: Mika');
    f.brain.reply(0,{summary:'Done.'});await pumping;expect(f.brain.pending).toHaveLength(1);
  });
  it('keeps a refused message for the brain: running turn queues a follow-up, queued turn drains into its prompt, idle starts a turn',async()=>{
    const f=fixture(),{pumping}=await running(f);f.brain.emit(0,agent('t1','Build the page',{name:'Mika'}));f.brain.accepts=false;
    expect(f.workspace.message({project_id:f.project.id,worker:'Mika',text:'Use blue'})).toMatchObject({delivered:'queued'});
    expect(f.workspace.snapshot().inbox).toHaveLength(1);
    f.brain.reply(0,{summary:'Done.'});await until(()=>f.brain.pending.length===2);
    const line="MESSAGE FOR Mika (from the user, through Donna's voice): Use blue";
    expect(f.brain.pending[1].input.prompt).toContain(`REQUEST: ${line}`);expect(f.workspace.snapshot().inbox).toHaveLength(0);
    // a brain turn that is queued but not yet started: the message rides in its prompt and the inbox drains
    f.workspace.delegate({project_id:f.project.id,goal:'Add a footer.'});expect(f.workspace.message({worker:'Mika',text:'Keep it short'})).toMatchObject({delivered:'queued'});
    expect(f.workspace.snapshot().inbox).toHaveLength(1);
    f.brain.reply(1,{summary:'Second.'});await until(()=>f.brain.pending.length===3);
    expect(f.brain.pending[2].input.prompt).toContain("MESSAGE FOR Mika (from the user, through Donna's voice): Keep it short\nREQUEST: Add a footer.");expect(f.workspace.snapshot().inbox).toHaveLength(0);
    f.brain.reply(2,{summary:'Third.'});await pumping;
    // idle: nothing queued or running, so the message becomes a brain turn of its own
    const before=f.workspace.snapshot().assignments.length;
    expect(f.workspace.message({project_id:f.project.id,worker:'Mika',text:'Thanks, all good'})).toMatchObject({delivered:'queued'});
    const snap=f.workspace.snapshot();expect(snap.assignments).toHaveLength(before+1);expect(snap.assignments.at(-1)).toMatchObject({kind:'plan',status:'queued',brief:"MESSAGE FOR Mika (from the user, through Donna's voice): Thanks, all good"});expect(snap.inbox ?? []).toHaveLength(0);
  });
  it('installs the skills into every room workspace',async()=>{
    const f=fixture(),dir=(id:string)=>resolve(f.root,'workspaces',id,'.claude/skills');
    expect(existsSync(resolve(dir(f.project.id),'donna-brain/SKILL.md'))).toBe(true);expect(existsSync(resolve(dir(f.project.id),'donna-worker/SKILL.md'))).toBe(true);
    const r=f.workspace.createProject({name:'Fresh',brief:'x',initial_work:'Build x'}) as {project:{id:string}};
    expect(existsSync(resolve(dir(r.project.id),'donna-brain/SKILL.md'))).toBe(true);
  });
  it('marks working crew paused after a restart, tells the brain, and fails what it never resumes',async()=>{
    const f=fixture(),{pumping}=await running(f);f.brain.emit(0,agent('t1','Build the page',{name:'Mika'}));f.brain.emit(0,agent('t2','Contact form',{name:'Wren'}));f.brain.emit(0,{type:'user',message:{content:[{type:'tool_result',tool_use_id:'t2',content:'done'}]}});
    await f.workspace.recover();
    let snap=f.workspace.snapshot();const mika=snap.assignments.find(a=>a.agent?.toolUseId==='t1')!;
    expect(mika.status).toBe('paused');expect(snap.workers.find(w=>w.id===mika.workerId)!.currentAction).toBe("Unknown after restart; Donna's brain re-checks it on its next turn");
    expect(snap.assignments.find(a=>a.agent?.toolUseId==='t2')!.status).toBe('review');expect(snap.assignments.find(a=>a.kind==='plan')!.status).toBe('paused');
    expect(()=>f.workspace.revise({assignment_id:mika.id,brief:'x'})).toThrow("Use message_worker to change a subagent's work");
    f.workspace.resume(mika.id);expect(f.workspace.snapshot().assignments.find(a=>a.kind==='plan')!.status).toBe('queued');
    f.brain.reply(0,{summary:'stale'});await until(()=>f.brain.pending.length===2);
    expect(f.brain.pending[1].input.prompt).toContain('RESTART: [{"name":"Mika","lastTask":"Build the page"}]');
    f.brain.reply(1,{summary:'Wren finished; Mika never came back.'});await pumping;
    snap=f.workspace.snapshot();expect(snap.assignments.find(a=>a.agent?.toolUseId==='t1')).toMatchObject({status:'failed',error:'Lost in a restart'});
    expect(snap.assignments.find(a=>a.kind==='plan')!.dependsOn).toEqual([snap.assignments.find(a=>a.agent?.toolUseId==='t2')!.id]);
  });
  it('never runs a crew row in the pump',async()=>{
    const f=fixture(),{pumping}=await running(f);f.brain.emit(0,agent('t1','Build the page',{name:'Mika'}));f.brain.reply(0,{summary:'Done.'});await pumping;
    (f.workspace as unknown as {data:{assignments:{agent?:object;status:string}[]}}).data.assignments.find(a=>a.agent)!.status='queued';
    await f.workspace.pump();expect(f.workspace.snapshot().assignments.find(a=>a.agent)!.status).toBe('queued');
  });
});
