import {afterAll,afterEach,beforeAll,describe,expect,it} from 'vitest';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AgencyWorkspace,type CodexRunner} from '../apps/server/src/agency/workspace';
import {OfficeStore} from '../apps/server/src/agency/state';
import {Projects} from '../apps/server/src/agency/projects';
import {gitDir} from '../apps/server/src/agency/git';

type RunInput=Parameters<CodexRunner['run']>[0];
type RunResult=Awaited<ReturnType<CodexRunner['run']>>;
class ControlledBrain implements CodexRunner {
  pending:{input:RunInput;finish:(result:RunResult)=>void;threadId:string}[]=[];injected:{threadId:string;text:string}[]=[];
  status(){return Promise.resolve({available:true,authenticated:true});}
  run(input:RunInput):Promise<RunResult>{
    const threadId=input.threadId||`brain-${this.pending.length+1}`;input.onThread?.(threadId);
    return new Promise(finish=>this.pending.push({input,finish,threadId}));
  }
  inject(threadId:string,text:string){this.injected.push({threadId,text});return true;}
  async interrupt(){}
  close(){}
  emit(i:number,e:any){this.pending[i].input.onEvent!({method:'claude/'+e.type,params:e});}
  reply(i:number,body:unknown){const run=this.pending[i];run.finish({threadId:run.threadId,status:'completed',text:JSON.stringify(body)});}
}
const tmp=realpathSync(tmpdir()),roots:string[]=[],workspaces:AgencyWorkspace[]=[],saved:Record<string,string|undefined>={};
const g=(dir:string,...a:string[])=>execFileSync('git',['-C',dir,...a],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
// Hermetic git: ignore the developer's global/system config so identity and signing never leak into the tests.
beforeAll(()=>{for(const k of ['GIT_CONFIG_GLOBAL','GIT_CONFIG_NOSYSTEM','AGENCY_GH_BIN'])saved[k]=process.env[k];process.env.GIT_CONFIG_GLOBAL='/dev/null';process.env.GIT_CONFIG_NOSYSTEM='1'});
afterAll(()=>{for(const [k,v] of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v});
afterEach(()=>{
  for(const w of workspaces.splice(0))w.close();
  for(const p of roots.splice(0)){if(!p.startsWith(join(tmp,'agency-repos-')))throw Error('Unexpected fixture directory');rmSync(p,{recursive:true,force:true});}
});
function fixture(){
  const root=realpathSync(mkdtempSync(join(tmp,'agency-repos-')));roots.push(root);
  const repo=join(root,'repo');mkdirSync(join(repo,'src'),{recursive:true});g(repo,'init','-q','-b','main');g(repo,'config','user.email','u@example.com');g(repo,'config','user.name','U');
  writeFileSync(join(repo,'README.md'),'hi\n');writeFileSync(join(repo,'CLAUDE.md'),'Rules: be brief.\n');writeFileSync(join(repo,'same.txt'),'base\n');writeFileSync(join(repo,'src/a.ts'),'export const a=1;\n');
  g(repo,'add','-A');g(repo,'commit','-q','-m','init');
  const store=new OfficeStore(join(root,'data')),projects=new Projects(store),brain=new ControlledBrain();
  const codexCwds:string[]=[],codex={status:()=>Promise.resolve({available:true,authenticated:true}),run:async(i:RunInput)=>{codexCwds.push(i.cwd);writeFileSync(join(i.cwd,'codex.txt'),'c\n');return {threadId:'c1',status:'completed',text:JSON.stringify({name:'Rhea',summary:'Wrote it',artifacts:['codex.txt'],verification:['ls']})} as RunResult;},interrupt:async()=>{},close(){}} as CodexRunner;
  const ws=new AgencyWorkspace(store,projects,codex,()=>{},{autoStart:false,brain});workspaces.push(ws);
  const project=projects.create({name:'App',brief:'',path:repo});ws.syncProjects();
  return {codexCwds,root,repo,store,projects,brain,ws,project,data:join(root,'data'),wt:join(root,'data','worktrees',project.id),head:g(repo,'rev-parse','HEAD')};
}
type F=ReturnType<typeof fixture>;
async function until(predicate:()=>boolean){const start=Date.now();while(!predicate()){if(Date.now()-start>3000)throw Error('Timed out');await new Promise(r=>setTimeout(r,0));}}
/** delegate a goal and wait for the brain step with index n to be running */
async function turn(f:F,goal:string,n:number){f.ws.delegate({project_id:f.project.id,goal});const pumping=f.ws.pump();await until(()=>f.brain.pending.length===n+1);return {pumping};}
const use=(id:string,name:string,input:object,parent?:string)=>({type:'assistant',parent_tool_use_id:parent,message:{content:[{type:'tool_use',id,name,input}]}});
const agent=(id:string,description:string,name:string)=>use(id,'Agent',{description,name,prompt:`Do: ${description}`,run_in_background:true,model:'sonnet'});
const notified=(task:string,tool:string)=>({type:'system',subtype:'task_notification',task_id:task,tool_use_id:tool,status:'completed',summary:'Agent finished'});
const started=(task:string,tool:string)=>({type:'system',subtype:'task_started',task_id:task,tool_use_id:tool,task_type:'local_agent'});
const plans=(f:F)=>f.ws.snapshot().assignments.filter(a=>a.kind==='plan');
/** two parallel workers that each write a file into their own checkout, then report */
function crew(f:F,files:Record<string,[string,string]>){
  f.brain.emit(0,agent('t1','Build page','Maya'));f.brain.emit(0,agent('t2','Write tests','Theo'));f.brain.emit(0,started('k1','t1'));f.brain.emit(0,started('k2','t2'));
  for(const [i,name] of [[1,'Maya'],[2,'Theo']] as const){const [file,text]=files[name];writeFileSync(join(f.wt,name,file),text);f.brain.emit(0,use('w'+i,'Write',{file_path:join(f.wt,name,file)},'t'+i));}
}

describe('attaching a folder',()=>{
  it('validates the path and keeps one room per repository',()=>{
    const f=fixture(),plain=join(f.root,'plain'),file=join(f.root,'file.txt');mkdirSync(plain);writeFileSync(file,'x');
    expect(()=>f.projects.create({name:'x',path:'foo/bar'})).toThrow('Give the full folder path, like /Users/you/projects/app.');
    expect(()=>f.projects.create({name:'x',path:join(f.root,'missing')})).toThrow(`No folder at ${join(f.root,'missing')}.`);
    expect(()=>f.projects.create({name:'x',path:file})).toThrow('is a file, not a folder.');
    expect(()=>f.projects.create({name:'x',path:f.data})).toThrow("is inside Chamber's own data folder; pick a project folder.");
    expect(()=>f.projects.create({name:'x',path:join(f.data,'rooms')})).toThrow("inside Chamber's own data folder");
    expect(()=>f.projects.create({name:'x',path:plain})).toThrow(/not a git repository\. Ask the user whether Donna may work directly in it without branches/);
    const loose=f.projects.create({name:'Loose',path:plain,allow_non_git:true});expect(loose).toMatchObject({path:plain,git:false});
    expect(f.project).toMatchObject({path:f.repo,git:true});
    const sub=f.projects.create({name:'Other',path:join(f.repo,'src')});expect(sub).toMatchObject({existing:true,id:f.project.id,path:f.repo});
    expect(f.projects.create({name:'Again',path:f.repo})).toMatchObject({existing:true,id:f.project.id});expect(f.projects.list()).toHaveLength(2);
    f.projects.setDeleted(f.project.id,true);expect(()=>f.projects.create({name:'x',path:f.repo})).toThrow('Project is in Recently deleted. Restore it explicitly.');
  });
  it('createProject names the room after the folder, reuses an existing room and still queues the work',()=>{
    const f=fixture(),r=f.ws.createProject({path:f.repo,initial_work:'Add a greeting'}) as {project:{id:string;name:string};note:string;assignment:{cwd:string}};
    expect(r.project.id).toBe(f.project.id);expect(r.note).toMatch(/already has the room/);expect(r.assignment.cwd).toBe(join(f.wt,'job'));
    const loose=join(f.root,'plain-dir');mkdirSync(loose);
    expect(()=>f.ws.createProject({path:loose,initial_work:null})).toThrow(/not a git repository/);
    const l=f.ws.createProject({path:loose,allow_non_git:true,initial_work:null}) as {project:{name:string}};expect(l.project.name).toBe('plain-dir');
    expect(f.ws.snapshot().projects.find(p=>p.name==='plain-dir')).toMatchObject({path:loose,git:false});expect(f.ws.snapshot().projects.find(p=>p.id===f.project.id)).toMatchObject({path:f.repo,git:true});
  });
  it('runs a non-git folder directly, with no .claude written into it',async()=>{
    const f=fixture(),plain=join(f.root,'plain');mkdirSync(plain);writeFileSync(join(plain,'.env'),'KEY=1');
    const p=f.projects.create({name:'Loose',path:plain,allow_non_git:true});f.ws.syncProjects();
    f.ws.delegate({project_id:p.id,goal:'Tidy up'});const pumping=f.ws.pump();await until(()=>f.brain.pending.length===1);
    const run=f.brain.pending[0].input;expect(run.cwd).toBe(plain);expect(run.sandbox).toEqual({write:[plain],deny:[],secrets:[join(plain,'.env')],network:false,addDir:join(f.data,'office')});
    expect(run.prompt).not.toContain('JOB BRANCH');expect(run.prompt).toContain('NETWORK: off');expect(existsSync(join(plain,'.claude'))).toBe(false);
    f.brain.reply(0,{summary:'Done.'});await pumping;
  });
});

describe('a git room',{timeout:30000},()=>{
  it('works on a job branch: checkouts per worker, merged into one briefing, the user checkout untouched, follow-ups on one branch',async()=>{
    const f=fixture(),{pumping}=await turn(f,'Add a greeting',0),run=f.brain.pending[0].input,job=join(f.wt,'job'),branch='donna/add-a-greeting';
    expect(run.cwd).toBe(job);expect(g(job,'rev-parse','--abbrev-ref','HEAD')).toBe(branch);
    expect(run.sandbox).toEqual({write:[f.wt],deny:[gitDir(f.repo),job],secrets:[],network:false,addDir:join(f.data,'office')});
    for(const line of [`REPOSITORY: ${f.repo} (the user's checkout; never touch it)`,`JOB BRANCH: ${branch} from main;`,`WORKER CHECKOUTS: ${f.wt}/<Name>`,'REPO RULES: CLAUDE.md - read them first','NETWORK: off - a needed install goes into "install"'])expect(run.prompt).toContain(line);
    crew(f,{Maya:['maya.txt','maya\n'],Theo:['theo.txt','theo\n']});
    expect(g(join(f.wt,'Maya'),'rev-parse','--abbrev-ref','HEAD')).toBe(`${branch}-maya`);expect(g(join(f.wt,'Theo'),'rev-parse','--abbrev-ref','HEAD')).toBe(`${branch}-theo`);
    const crewRows=()=>f.ws.snapshot().assignments.filter(a=>a.agent);
    expect(crewRows().map(c=>[c.cwd,c.git?.branch])).toEqual([[join(f.wt,'Maya'),`${branch}-maya`],[join(f.wt,'Theo'),`${branch}-theo`]]);
    expect(f.ws.snapshot().workers.find(w=>w.name==='Maya')!.currentAction).toBe('Editing maya.txt');
    f.brain.emit(0,notified('k1','t1'));f.brain.emit(0,notified('k2','t2'));
    expect(crewRows().map(c=>[c.status,c.artifacts.map(a=>a.path)])).toEqual([['review',['maya.txt']],['review',['theo.txt']]]);
    expect(g(job,'ls-files')).toContain('maya.txt');expect(g(job,'ls-files')).toContain('theo.txt');
    f.brain.reply(0,{title:'Greeting',summary:'Maya and Theo added it.',verification:['Read both files']});await pumping;
    const snap=f.ws.snapshot(),[b]=snap.briefings,step=plans(f)[0];
    expect(snap.briefings).toHaveLength(1);expect(b.git).toMatchObject({repo:f.repo,branch,base:'main'});expect(b.git!.diffStat).toContain('maya.txt');expect(b.git!.diffStat).toContain('theo.txt');
    expect(b.git!.commits!.join('\n')).toContain('Maya: Build page');expect(b.git!.commits!.join('\n')).toContain('Theo: Write tests');
    expect(b.artifacts.map(a=>a.path).sort()).toEqual(['maya.txt','theo.txt']);expect(step.artifacts).toEqual([]);
    // the user's own checkout was never touched
    expect(g(f.repo,'rev-parse','--abbrev-ref','HEAD')).toBe('main');expect(g(f.repo,'status','--porcelain')).toBe('');expect(g(f.repo,'rev-parse','HEAD')).toBe(f.head);
    // a follow-up piles onto the same branch until its PR is opened
    const {pumping:again}=await turn(f,'Rename the banner',1);
    expect(f.brain.pending[1].input.prompt).toContain(`JOB BRANCH: ${branch} from main;`);expect(plans(f)[1].git!.branch).toBe(branch);expect(g(job,'rev-parse','--abbrev-ref','HEAD')).toBe(branch);
    writeFileSync(join(job,'banner.txt'),'b\n');f.brain.emit(1,use('f1','Write',{file_path:join(job,'banner.txt')}));
    f.brain.reply(1,{summary:'Renamed.',verification:[]});await again;
    const last=f.ws.snapshot().briefings.at(-1)!;expect(last.git!.files).toEqual(expect.arrayContaining(['maya.txt','theo.txt','banner.txt']));expect(last.artifacts.map(a=>a.path).sort()).toEqual(['banner.txt','maya.txt','theo.txt']);
    expect(g(f.repo,'status','--porcelain')).toBe('');
  });
  it('turns a merge conflict into a decision, tells the brain, and applies the answer',async()=>{
    const f=fixture(),{pumping}=await turn(f,'Edit the shared file',0);
    crew(f,{Maya:['same.txt','maya\n'],Theo:['same.txt','theo\n']});
    f.brain.emit(0,notified('k1','t1'));expect(f.ws.snapshot().decisions).toHaveLength(0);f.brain.emit(0,notified('k2','t2'));
    const [d]=f.ws.snapshot().decisions;
    expect(d).toMatchObject({title:"Merge conflict: Theo's work",status:'open',options:["Use Theo's version",'Keep the current version'],action:{kind:'merge',branch:'donna/edit-the-shared-file-theo',worker:'Theo',jobId:plans(f)[0].id}});
    expect(d.context).toContain('same.txt');expect(f.brain.injected).toEqual([{threadId:'brain-1',text:"MERGE CONFLICT: Theo's work conflicts in same.txt; it is not merged and the user decides. Say so in your summary."}]);
    expect(readFileSync(join(f.wt,'job/same.txt'),'utf8')).toBe('maya\n');
    f.brain.reply(0,{summary:'Maya merged; Theo conflicts.',verification:[]});await pumping;
    f.ws.decide({id:d.id,project_id:f.project.id,status:'decided',decision:"Use Theo's version"});
    expect(readFileSync(join(f.wt,'job/same.txt'),'utf8')).toBe('theo\n');
    const next=plans(f).at(-1)!;expect(next).toMatchObject({status:'queued',brief:expect.stringContaining("The user decided the merge conflict for Theo's work: \"Use Theo's version\"")});
    const again=f.ws.pump();await until(()=>f.brain.pending.length===2);expect(f.brain.pending[1].input.prompt).toContain('JOB BRANCH: donna/edit-the-shared-file from main;');
    f.brain.reply(1,{summary:'Checked.',verification:[]});await again;
    // keeping the current version leaves the job branch alone but still wakes the brain
    const f2=fixture(),{pumping:p2}=await turn(f2,'Edit the shared file',0);crew(f2,{Maya:['same.txt','maya\n'],Theo:['same.txt','theo\n']});f2.brain.emit(0,notified('k1','t1'));f2.brain.emit(0,notified('k2','t2'));
    f2.brain.reply(0,{summary:'x',verification:[]});await p2;f2.ws.decide({id:f2.ws.snapshot().decisions[0].id,project_id:f2.project.id,status:'decided',decision:'Keep the current version'});
    expect(readFileSync(join(f2.wt,'job/same.txt'),'utf8')).toBe('maya\n');expect(plans(f2).at(-1)!.status).toBe('queued');
  });
  it('asks before an install and opens the network for one turn only on yes',async()=>{
    const f=fixture(),{pumping}=await turn(f,'Add left-pad',0);
    f.brain.reply(0,{summary:'Needs a package.',verification:[],install:'npm install left-pad'});await pumping;
    const [d]=f.ws.snapshot().decisions;expect(d).toMatchObject({title:'Allow a package install',status:'open',options:['Yes, allow it','No'],action:{kind:'install',command:'npm install left-pad'}});
    expect(d.context).toContain('npm install left-pad');
    f.ws.decide({id:d.id,project_id:f.project.id,status:'decided',decision:'Yes, allow it'});
    const next=plans(f).at(-1)!;expect(next).toMatchObject({status:'queued',network:true,brief:expect.stringContaining('The user said yes to this install: npm install left-pad.')});
    const again=f.ws.pump();await until(()=>f.brain.pending.length===2);
    expect(f.brain.pending[1].input.sandbox!.network).toBe(true);expect(f.brain.pending[1].input.prompt).toContain('NETWORK: on for this turn');
    f.brain.reply(1,{summary:'Installed.',verification:[]});await again;
    // the next turn is closed again, and a no only logs
    f.ws.delegate({project_id:f.project.id,goal:'Something else entirely'});const third=f.ws.pump();await until(()=>f.brain.pending.length===3);expect(f.brain.pending[2].input.sandbox!.network).toBe(false);
    f.brain.reply(2,{summary:'Needs another.',verification:[],install:'pip install x'});await third;
    const d2=f.ws.snapshot().decisions.at(-1)!;f.ws.decide({id:d2.id,project_id:f.project.id,status:'decided',decision:'No'});
    expect(plans(f)).toHaveLength(3);
  });
  it('opens a pull request only after a confirmation the user spoke after the question, without leaking secrets',async()=>{
    const f=fixture(),origin=join(f.root,'origin.git'),log=join(f.root,'gh.log'),gh=join(f.root,'gh.sh');
    execFileSync('git',['init','-q','--bare',origin]);g(f.repo,'remote','add','origin',origin);
    writeFileSync(gh,`#!/bin/sh\nprintf '%s\\0' "$@" >> '${log}'\necho https://github.com/acme/app/pull/7\n`);chmodSync(gh,0o755);process.env.AGENCY_GH_BIN=gh;
    const pr=()=>f.ws.pullRequest({project_id:f.project.id,confirm:true},Date.now()+60000);
    expect(()=>f.ws.pullRequest({},0)).toThrow('Select the room first.');expect(()=>f.ws.pullRequest({project_id:f.project.id},0)).toThrow('There is no finished job branch to open a pull request for.');
    const token=['ghp','x'.repeat(36)].join('_'),{pumping}=await turn(f,'Add a greeting',0);crew(f,{Maya:['maya.txt','maya\n'],Theo:['theo.txt','theo\n']});
    expect(()=>f.ws.pullRequest({project_id:f.project.id},0)).toThrow(/still in progress/);
    f.brain.emit(0,notified('k1','t1'));f.brain.emit(0,notified('k2','t2'));f.brain.reply(0,{title:'Greeting',summary:`Done. Token ${token} was in the log.`,verification:[`API_KEY=${'s'.repeat(20)}`]});await pumping;
    expect(plans(f)[0].summary).not.toContain(token);expect(plans(f)[0].verification![0]).toContain('[redacted]');
    const ask=f.ws.pullRequest({project_id:f.project.id},Date.now());
    expect(ask).toMatchObject({committed:false,needsConfirmation:true,question:'Open a pull request for "Greeting" from donna/add-a-greeting into main?'});
    // a confirm from the same model turn (user spoke before the question) is refused and re-asks
    expect(f.ws.pullRequest({project_id:f.project.id,confirm:true},Date.now()-100000)).toMatchObject({needsConfirmation:true});
    expect(existsSync(log)).toBe(false);expect(g(origin,'branch','--list')).toBe('');
    const done=pr() as {committed:boolean;url:string;branch:string};
    expect(done).toMatchObject({committed:true,url:'https://github.com/acme/app/pull/7',branch:'donna/add-a-greeting'});
    expect(g(origin,'branch','--list')).toContain('donna/add-a-greeting');
    const args=readFileSync(log,'utf8').split('\0'),body=args[args.indexOf('--body')+1];
    expect(args.slice(0,9)).toEqual(['pr','create','--head','donna/add-a-greeting','--base','main','--title','Greeting','--body']);
    expect(body).toContain('maya.txt');expect(body).toContain('theo.txt');expect(body).toContain('Maya: Build page');expect(body).not.toContain(token);expect(body).not.toContain('s'.repeat(20));
    const snap=f.ws.snapshot();expect(snap.briefings[0].git!.prUrl).toBe('https://github.com/acme/app/pull/7');expect(plans(f)[0].git!.prUrl).toBe('https://github.com/acme/app/pull/7');
    expect(existsSync(join(f.wt,'Maya'))).toBe(false);expect(existsSync(join(f.wt,'job'))).toBe(true);
    expect(f.ws.pullRequest({project_id:f.project.id,confirm:true},Date.now()+90000)).toMatchObject({committed:false,url:'https://github.com/acme/app/pull/7',note:'already open'});
    // after the PR the same goal starts a fresh branch
    const {pumping:next}=await turn(f,'Add a greeting',1);expect(plans(f)[1].git!.branch).toBe('donna/add-a-greeting-2');expect(g(join(f.wt,'job'),'rev-parse','--abbrev-ref','HEAD')).toBe('donna/add-a-greeting-2');
    f.brain.reply(1,{summary:'Again.',verification:[]});await next;
    expect(g(f.repo,'rev-parse','--abbrev-ref','HEAD')).toBe('main');expect(g(f.repo,'status','--porcelain')).toBe('');
  });
  it('runs Codex-path workers in the job checkout and commits their work at review',async()=>{
    const f=fixture(),{pumping}=await turn(f,'Attach the repository at /tmp/app and add a codex file',0),job=join(f.wt,'job');
    f.brain.reply(0,{title:'Codex file',checkpoint:'c',rationale:'r',workers:[{key:'a',role:'Dev',responsibility:'x',brief:'y',acceptance:'z',provider:'codex'}]});
    await until(()=>f.brain.pending.length===2);
    expect(f.codexCwds).toEqual([job]);const review=f.ws.snapshot().assignments.find(a=>a.kind==='review')!;expect(review.git!.branch).toBe('donna/add-a-codex-file');
    expect(f.brain.pending[1].input.cwd).toBe(job);expect(f.brain.pending[1].input.sandbox!.write).toEqual([f.wt]);
    f.brain.reply(1,{summary:'Rhea wrote it.',verification:['Read codex.txt']});await pumping;
    const [b]=f.ws.snapshot().briefings;expect(b.git).toMatchObject({branch:'donna/add-a-codex-file',files:['codex.txt']});expect(b.git!.commits).toHaveLength(1);expect(b.artifacts.map(a=>a.path)).toEqual(['codex.txt']);
    expect(g(f.repo,'status','--porcelain')).toBe('');
  });
});
