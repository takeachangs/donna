import {afterAll,afterEach,beforeAll,describe,expect,it} from 'vitest';
import {chmodSync,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {basename,join} from 'node:path';
import {commitAll,gitDir,gitRoot,merge,openPr,push,redact,removeCheckout,report,secretFiles,slugify,startJob,useJob,workerCheckout} from '../apps/server/src/agency/git';

const tmp=realpathSync(tmpdir()),roots:string[]=[],saved:Record<string,string|undefined>={};
const g=(dir:string,...a:string[])=>execFileSync('git',['-C',dir,...a],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const put=(dir:string,file:string,text:string)=>writeFileSync(join(dir,file),text);
// Hermetic git: ignore the developer's global/system config so identity and signing never leak into the tests.
beforeAll(()=>{for(const k of ['GIT_CONFIG_GLOBAL','GIT_CONFIG_NOSYSTEM','AGENCY_GH_BIN'])saved[k]=process.env[k];process.env.GIT_CONFIG_GLOBAL='/dev/null';process.env.GIT_CONFIG_NOSYSTEM='1'});
afterAll(()=>{for(const [k,v] of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v});
afterEach(()=>{for(const p of roots.splice(0)){if(!p.startsWith(join(tmp,'agency-git-')))throw Error('Unexpected fixture directory');rmSync(p,{recursive:true,force:true})}});
function fx(identity=true){
 const root=realpathSync(mkdtempSync(join(tmp,'agency-git-')));roots.push(root);
 const r=join(root,'repo');mkdirSync(r);g(r,'init','-q','-b','main');
 if(identity){g(r,'config','user.email','u@example.com');g(r,'config','user.name','U')}
 put(r,'README.md','hi\n');put(r,'same.txt','base\n');g(r,'add','-A');g(r,...(identity?[]:['-c','user.name=T','-c','user.email=t@example.com']),'commit','-q','-m','init');
 return {root,r};
}
/** job + two worker checkouts */
function crew(){
 const f=fx(),job=join(f.root,'job'),j=startJob(f.r,job,'Build the thing'),maya=join(f.root,'maya'),theo=join(f.root,'theo');
 workerCheckout(f.r,j.branch,maya,'Maya');workerCheckout(f.r,j.branch,theo,'Theo');
 return {...f,job,j,maya,theo};
}

describe('slugify',()=>{
 it('makes branch-safe slugs',()=>{
  expect(slugify('Add a --version flag to dash.py')).toBe('add-a-version-flag-to-dash-py');
  expect(slugify('  --Hello,   World!--  ')).toBe('hello-world');
  expect(slugify('')).toBe('job');expect(slugify('!!! ???')).toBe('job');
 });
 it('cuts at 40 chars on a dash boundary when possible',()=>{
  const s=slugify('implement the authentication middleware for the api gateway');
  expect(s).toBe('implement-the-authentication-middleware');expect(s.length).toBeLessThanOrEqual(40);
  expect(slugify('a'.repeat(60))).toBe('a'.repeat(40));
 });
});

describe('startJob / useJob',()=>{
 it('creates donna/<slug> in a worktree and leaves the user checkout alone',()=>{
  const {root,r}=fx(),before=g(r,'status','--porcelain'),dir=join(root,'job'),j=startJob(r,dir,'Add a --version flag to dash.py');
  expect(j).toEqual({repo:r,branch:'donna/add-a-version-flag-to-dash-py',base:'main',baseSha:g(r,'rev-parse','HEAD')});
  expect(g(r,'show-ref','--verify',`refs/heads/${j.branch}`)).toContain(j.baseSha);
  expect(g(dir,'rev-parse','--abbrev-ref','HEAD')).toBe(j.branch);
  expect(g(r,'rev-parse','--abbrev-ref','HEAD')).toBe('main');
  expect(g(r,'status','--porcelain')).toBe(before);expect(before).toBe('');
  expect(gitRoot(dir)).toBe(dir);expect(gitDir(dir)).toBe(gitDir(r));
  expect(gitRoot(root)).toBeUndefined();
 });
 it('suffixes -2 for the same goal and can reuse a worktree dir',()=>{
  const {root,r}=fx(),a=startJob(r,join(root,'a'),'Same goal'),b=startJob(r,join(root,'b'),'Same goal');
  expect(a.branch).toBe('donna/same-goal');expect(b.branch).toBe('donna/same-goal-2');
  const c=startJob(r,join(root,'a'),'Same goal');
  expect(c.branch).toBe('donna/same-goal-3');expect(g(join(root,'a'),'rev-parse','--abbrev-ref','HEAD')).toBe('donna/same-goal-3');
  expect(()=>startJob(r,r,'x')).toThrow(/itself/);
 });
 it('throws a plain error when the repo has no commits',()=>{
  const {root}=fx(),empty=join(root,'empty');mkdirSync(empty);g(empty,'init','-q','-b','main');
  expect(()=>startJob(empty,join(root,'j'),'x')).toThrow(/no commits/);
 });
 it('useJob continues an existing branch or reports it gone',()=>{
  const {root,r}=fx(),dir=join(root,'job'),j=startJob(r,dir,'Resume me');
  removeCheckout(r,dir);expect(existsSync(dir)).toBe(false);
  expect(useJob(r,dir,j.branch)).toBe(true);expect(g(dir,'rev-parse','--abbrev-ref','HEAD')).toBe(j.branch);
  g(dir,'checkout','-q','-b','other');expect(useJob(r,dir,j.branch)).toBe(true);expect(g(dir,'rev-parse','--abbrev-ref','HEAD')).toBe(j.branch);
  expect(useJob(r,dir,'donna/gone')).toBe(false);
 });
});

describe('workers, commits and merges',()=>{
 it('commits each worker and merges both into the job branch',()=>{
  const {r,job,j,maya,theo}=crew();
  expect(g(maya,'rev-parse','--abbrev-ref','HEAD')).toBe(`${j.branch}-maya`);expect(g(theo,'rev-parse','--abbrev-ref','HEAD')).toBe(`${j.branch}-theo`);
  put(maya,'a.txt','a\n');put(theo,'b.txt','b\n');
  const ca=commitAll(maya,'maya: a'),cb=commitAll(theo,'theo: b');
  expect(ca?.files).toEqual(['a.txt']);expect(cb?.files).toEqual(['b.txt']);expect(ca?.sha).toMatch(/^[0-9a-f]{7,}$/);
  expect(commitAll(maya,'nothing')).toBeUndefined();
  expect(merge(job,`${j.branch}-maya`)).toEqual({ok:true});expect(merge(job,`${j.branch}-theo`)).toEqual({ok:true});
  expect(merge(job,`${j.branch}-theo`)).toEqual({ok:true});// already up to date
  const rep=report(job,j.baseSha);
  expect(rep.files.sort()).toEqual(['a.txt','b.txt']);expect(rep.diffStat).toContain('a.txt');expect(rep.diffStat).toContain('b.txt');
  expect(rep.commits.join('\n')).toContain('maya: a');expect(rep.commits.join('\n')).toContain('theo: b');
  expect(report(g(r,'rev-parse','--show-toplevel'),g(r,'rev-parse','HEAD'))).toEqual({diffStat:'',commits:[],files:[]});
 });
 it('commits with a Donna identity when the user has none',()=>{
  const {root,r}=fx(false),j=startJob(r,join(root,'job'),'No identity'),dir=join(root,'job');
  put(dir,'x.txt','x\n');commitAll(dir,'add x');
  expect(g(dir,'log','-1','--format=%ae')).toBe('donna@chamber.local');
  expect(j.branch).toBe('donna/no-identity');
 });
 it('uses the user identity when configured',()=>{
  const {maya}=crew();put(maya,'x.txt','x\n');
  commitAll(maya,'mine');expect(g(maya,'log','-1','--format=%ae')).toBe('u@example.com');
 });
 it('aborts conflicting merges cleanly and can prefer the incoming side',()=>{
  const {job,j,maya,theo}=crew();
  put(maya,'same.txt','maya\n');put(theo,'same.txt','theo\n');commitAll(maya,'maya');commitAll(theo,'theo');
  expect(merge(job,`${j.branch}-maya`)).toEqual({ok:true});
  expect(merge(job,`${j.branch}-theo`)).toEqual({ok:false,files:['same.txt']});
  expect(()=>g(job,'rev-parse','-q','--verify','MERGE_HEAD')).toThrow();
  expect(g(job,'status','--porcelain')).toBe('');expect(readFileSync(join(job,'same.txt'),'utf8')).toBe('maya\n');
  expect(merge(job,`${j.branch}-theo`,'theirs')).toEqual({ok:true});
  expect(readFileSync(join(job,'same.txt'),'utf8')).toBe('theo\n');
 });
 it('throws on a merge that fails for a non-conflict reason',()=>{
  const {job}=crew();expect(()=>merge(job,'no-such-branch')).toThrow();expect(g(job,'status','--porcelain')).toBe('');
 });
 it('fast-forwards an existing worker checkout to the job branch',()=>{
  const {r,job,j,maya,theo}=crew();
  put(maya,'a.txt','a\n');commitAll(maya,'maya: a');merge(job,`${j.branch}-maya`);
  expect(existsSync(join(theo,'a.txt'))).toBe(false);
  expect(workerCheckout(r,j.branch,theo,'Theo')).toBe(`${j.branch}-theo`);
  expect(existsSync(join(theo,'a.txt'))).toBe(true);
 });
 it('removeCheckout removes the dir and its worktree entry',()=>{
  const {r,maya}=crew();
  removeCheckout(r,maya);expect(existsSync(maya)).toBe(false);expect(g(r,'worktree','list')).not.toContain('maya');
  expect(()=>removeCheckout(r,maya)).not.toThrow();
 });
});

describe('node_modules link',()=>{
 it('links an ignored node_modules into job and worker checkouts, never commits it, and removal spares the original',()=>{
  const {root,r}=fx();put(r,'.gitignore','node_modules/\n');g(r,'add','-A');g(r,'commit','-q','-m','ignore');
  mkdirSync(join(r,'node_modules'));put(join(r,'node_modules'),'pkg.js','1\n');
  const job=join(root,'job'),j=startJob(r,job,'Link'),w=join(root,'w');
  workerCheckout(r,j.branch,w,'Maya');
  for(const d of [job,w]){expect(lstatSync(join(d,'node_modules')).isSymbolicLink()).toBe(true);expect(realpathSync(join(d,'node_modules'))).toBe(join(r,'node_modules'))}
  put(w,'x.txt','x\n');expect(commitAll(w,'x')?.files).toEqual(['x.txt']);
  removeCheckout(r,w);expect(existsSync(join(r,'node_modules','pkg.js'))).toBe(true);
 });
 it('does not link when node_modules is not ignored',()=>{
  const {root,r}=fx();mkdirSync(join(r,'node_modules'));
  const job=join(root,'job');startJob(r,job,'No link');expect(existsSync(join(job,'node_modules'))).toBe(false);
 });
});

describe('push and openPr',()=>{
 it('pushes the branch to origin, and says so when there is none',()=>{
  const {root,r}=fx(),j=startJob(r,join(root,'job'),'Push me');
  expect(()=>push(r,j.branch)).toThrow('This repository has no origin remote.');
  const bare=join(root,'origin.git');execFileSync('git',['clone','--bare','-q',r,bare]);g(r,'remote','add','origin',bare);
  push(r,j.branch);expect(g(bare,'branch','--list',j.branch)).toContain(j.branch);
 });
 it('openPr returns the gh URL and passes the right arguments',()=>{
  const {root,r}=fx(),log=join(root,'gh.log'),gh=join(root,'gh');
  writeFileSync(gh,`#!/bin/sh\nprintf '%s\\n' "$@" >> '${log}'\necho 'Creating pull request'\necho https://github.com/o/r/pull/7\n`);chmodSync(gh,0o755);
  process.env.AGENCY_GH_BIN=gh;
  expect(openPr(r,{branch:'donna/x',base:'main',title:'A title',body:'Some body'})).toBe('https://github.com/o/r/pull/7');
  const args=readFileSync(log,'utf8').split('\n');
  expect(args).toEqual(['pr','create','--head','donna/x','--base','main','--title','A title','--body','Some body','']);
 });
 it('openPr throws a short reason when gh fails or prints no URL',()=>{
  const {root,r}=fx(),bad=join(root,'bad'),mute=join(root,'mute');
  writeFileSync(bad,"#!/bin/sh\necho 'boom: not authenticated' >&2\necho second >&2\nexit 1\n");writeFileSync(mute,'#!/bin/sh\necho hello\n');chmodSync(bad,0o755);chmodSync(mute,0o755);
  const pr={branch:'b',base:'main',title:'t',body:'b'};
  process.env.AGENCY_GH_BIN=bad;expect(()=>openPr(r,pr)).toThrow('boom: not authenticated');
  process.env.AGENCY_GH_BIN=mute;expect(()=>openPr(r,pr)).toThrow(/no pull request URL/);
 });
});

describe('secretFiles and redact',()=>{
 it('finds top-level secret files, deduped, skipping missing dirs',()=>{
  const {root}=fx(),d=join(root,'repo');
  for(const n of ['.env','.env.local','server.pem','app.key','id_rsa','.npmrc','environment','keyboard.txt','id_rsa.pub'])put(d,n,'x');
  const found=secretFiles([d,d,join(root,'missing')]);
  expect(found.map(p=>basename(p)).sort()).toEqual(['.env','.env.local','.npmrc','app.key','id_rsa','server.pem']);
  expect(found.every(p=>p.startsWith(root))).toBe(true);
 });
 // fixtures are assembled at runtime so no secret scanner flags this source file
 const pem=['-----BEGIN ','RSA PRIVATE KEY-----'].join(''),end=['-----END ','RSA PRIVATE KEY-----'].join('');
 it.each([
  ['openai',['sk','-',...'proj1'.repeat(6)].join('')],
  ['anthropic',['sk','-ant-api03-','Ab1_'.repeat(8)].join('')],
  ['github ghp',['gh','p_','a1'.repeat(18)].join('')],
  ['github gho',['gh','o_','a1'.repeat(18)].join('')],
  ['github fine-grained',['github','_pat_','a1_'.repeat(10)].join('')],
  ['slack',['xox','b-','1234567890-abcdefghij'].join('')],
  ['aws',['AK','IA','ABCDEFGHIJKLMNOP'].join('')],
  ['google',['AI','za','a1'.repeat(17)].join('')],
 ])('masks %s tokens',(_n,tok)=>{expect(redact(`use ${tok} now`)).toBe('use [redacted] now')});
 it('masks NAME=value, NAME: value and PEM blocks',()=>{
  expect(redact('API_KEY=supersecretvalue')).toBe('API_KEY=[redacted]');
  expect(redact('db_password: hunter2hunter2')).toBe('db_password: [redacted]');
  expect(redact('{"api_key": "abcdefgh12"}')).toBe('{"api_key": "[redacted]"}');
  expect(redact('AUTH_TOKEN=short')).toBe('AUTH_TOKEN=short');
  expect(redact(`before\n${pem}\nMIIabc\ndef\n${end}\nafter`)).toBe('before\n[redacted]\nafter');
 });
 it('leaves ordinary text alone',()=>{
  const t='Fixed the keyboard: shortcuts now work. See task-force-planning-notes, sk-learn-pipeline-steps and AKIA is a prefix. Primary key: id.';
  expect(redact(t)).toBe(t);
 });
});
