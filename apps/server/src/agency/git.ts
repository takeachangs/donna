import {execFileSync} from 'node:child_process';
import {existsSync,lstatSync,readdirSync,realpathSync,symlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
export type JobGit={repo:string;branch:string;base:string;baseSha:string;diffStat?:string;commits?:string[];files?:string[];prUrl?:string};
// The SERVER does every git write; models never run git. Only worktree add/remove and refs ever touch the user's repo.
const run=(dir:string,timeout:number,...args:string[])=>execFileSync('git',['-C',dir,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout,maxBuffer:1<<26,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}}).trim();
const git=(dir:string,...args:string[])=>run(dir,60000,...args);
const ok=(dir:string,...args:string[])=>{try{git(dir,...args);return true}catch{return false}};
const lines=(s:string)=>s.split('\n').filter(Boolean);
const names=(dir:string,...args:string[])=>git(dir,...args,'-z').split('\0').filter(Boolean);
const why=(e:unknown)=>String((e as {stderr?:unknown}).stderr||(e as Error).message||e).trim().split('\n')[0];
const hasBranch=(repo:string,b:string)=>ok(repo,'show-ref','--verify','-q',`refs/heads/${b}`);
const current=(dir:string)=>{try{return git(dir,'symbolic-ref','--short','-q','HEAD')}catch{return ''}};
/** `-c` identity args when the user has no git email, so commits never fail on a fresh machine. */
const ident=(dir:string)=>{try{if(git(dir,'config','user.email'))return []}catch{/* unset */}return ['-c','user.name=Donna','-c','user.email=donna@chamber.local']};
const addWorktree=(repo:string,...args:string[])=>{ok(repo,'worktree','prune');git(repo,'worktree','add','-q',...args)};
// ponytail: a symlink shares the user's install, but tools that write caches into node_modules hit the sandbox; a per-worktree install is the upgrade.
function linkModules(repo:string,dir:string){
 const src=join(repo,'node_modules'),dst=join(dir,'node_modules');
 if(existsSync(src)&&!existsSync(dst)&&ok(repo,'check-ignore','-q','node_modules'))try{symlinkSync(src,dst)}catch{/* best effort */}
}

/** Realpath of the git toplevel containing dir, or undefined when dir is not inside a git work tree. */
export function gitRoot(dir:string):string|undefined{try{return realpathSync(git(dir,'rev-parse','--show-toplevel'))}catch{return undefined}}
/** Realpath of the repo's common .git directory (`rev-parse --git-common-dir`, resolved against repo). */
export function gitDir(repo:string):string{return realpathSync(resolve(repo,git(repo,'rev-parse','--git-common-dir')))}
/** 'Add a --version flag to dash.py' -> 'add-a-version-flag-to-dash-py': lowercase [a-z0-9-], no leading/trailing/double '-', at most 40 chars cut at a '-' boundary when possible, 'job' when empty. */
export function slugify(text:string):string{
 let s=text.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
 if(s.length>40){const c=s.slice(0,41);s=c[40]==='-'?c.slice(0,40):c.includes('-')?c.slice(0,c.lastIndexOf('-')):c.slice(0,40)}
 return s||'job';
}
/** New job branch donna/<slug> from the repo's HEAD, checked out in dir (a new worktree, or `checkout -b` when dir already is one). */
export function startJob(repo:string,dir:string,goal:string):JobGit{
 let sha:string;
 try{sha=git(repo,'rev-parse','--verify','-q','HEAD^{commit}')}catch{throw Error('This repository has no commits yet. Make a first commit, then try again.')}
 const slug=slugify(goal);let branch=`donna/${slug}`;
 for(let n=2;hasBranch(repo,branch);n++)branch=`donna/${slug}-${n}`;
 const root=gitRoot(dir);
 if(root&&root===repo)throw Error('The job checkout must not be the repository itself.');
 if(root&&gitDir(root)===gitDir(repo))git(dir,'checkout','-q','-b',branch,sha);
 else addWorktree(repo,'-b',branch,dir,sha);
 linkModules(repo,dir);
 return {repo,branch,base:current(repo)||'main',baseSha:sha};
}
/** Continue an existing job branch in dir; false when the branch no longer exists. */
export function useJob(repo:string,dir:string,branch:string):boolean{
 if(!hasBranch(repo,branch))return false;
 if(!existsSync(dir))addWorktree(repo,dir,branch);
 else if(current(dir)!==branch)git(dir,'checkout','-q',branch);
 return true;
}
/** Worker checkout at dir on `<jobBranch>-<name>`, created from (or fast-forwarded to) the job branch. */
export function workerCheckout(repo:string,jobBranch:string,dir:string,name:string):string{
 const branch=`${jobBranch}-${slugify(name)}`;
 if(!existsSync(dir))addWorktree(repo,'-B',branch,dir,jobBranch);
 else ok(dir,'merge','-q','--ff-only',jobBranch);
 linkModules(repo,dir);
 return branch;
}
/** Stage everything and commit; undefined when there is nothing to commit. */
export function commitAll(dir:string,message:string):{sha:string;files:string[]}|undefined{
 const nm=join(dir,'node_modules'),link=existsSync(nm)&&lstatSync(nm).isSymbolicLink();
 // ponytail: the shared node_modules symlink is untracked-but-not-ignored (a "node_modules/" pattern skips only directories), so it is excluded by hand
 git(dir,'add','-A',...(link?['--','.',':!node_modules']:[]));
 const files=names(dir,'diff','--cached','--name-only');
 if(!files.length)return undefined;
 git(dir,...ident(dir),'commit','-q','-m',message);
 return {sha:git(dir,'rev-parse','--short','HEAD'),files};
}
/** Merge branch into the job checkout. A conflict is aborted so the checkout is never left mid-merge. */
export function merge(jobDir:string,branch:string,strategy?:'theirs'):{ok:true}|{ok:false;files:string[]}{
 try{git(jobDir,...ident(jobDir),'merge','--no-ff','--no-edit',...(strategy?['-X',strategy]:[]),branch);return {ok:true}}
 catch(e){
  const files=names(jobDir,'diff','--name-only','--diff-filter=U');
  ok(jobDir,'merge','--abort');
  if(!files.length)throw e;
  return {ok:false,files};
 }
}
/** What the job changed since baseSha. */
export function report(jobDir:string,baseSha:string):{diffStat:string;commits:string[];files:string[]}{
 const range=`${baseSha}..HEAD`;
 return {diffStat:git(jobDir,'diff','--stat',range),commits:lines(git(jobDir,'log','--reverse','--format=%h %s',range)),files:names(jobDir,'diff','--name-only',range)};
}
/** Remove a job or worker checkout; never throws. */
export function removeCheckout(repo:string,dir:string):void{ok(repo,'worktree','remove','--force',dir);ok(repo,'worktree','prune')}
/** Push the branch to origin (no -u, no --force). */
export function push(repo:string,branch:string):void{
 if(!ok(repo,'remote','get-url','origin'))throw Error('This repository has no origin remote.');
 try{run(repo,120000,'push','origin',`refs/heads/${branch}:refs/heads/${branch}`)}catch(e){throw Error(`git push failed: ${why(e)}`)}
}
/** Open a PR with gh and return its URL. */
export function openPr(repo:string,pr:{branch:string;base:string;title:string;body:string}):string{
 let out:string;
 try{out=execFileSync(process.env.AGENCY_GH_BIN||'gh',['pr','create','--head',pr.branch,'--base',pr.base,'--title',pr.title,'--body',pr.body],{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000,env:{...process.env,GH_PROMPT_DISABLED:'1'}})}
 catch(e){throw Error(`gh pr create failed: ${why(e)}`)}
 const url=lines(out).reverse().map(l=>l.trim()).find(l=>l.startsWith('http'));
 if(!url)throw Error('gh printed no pull request URL.');
 return url;
}
const SECRET_NAME=/^\.env($|\.)|\.(pem|key|p12|pfx)$|^id_(rsa|dsa|ecdsa|ed25519)$|^\.(npmrc|pypirc|netrc)$/;
/** Realpaths of top-level secret-looking entries of each existing dir. */
export function secretFiles(dirs:string[]):string[]{
 const out=new Set<string>();
 for(const d of dirs){let entries:string[];try{entries=readdirSync(d)}catch{continue}
  for(const n of entries)if(SECRET_NAME.test(n))try{out.add(realpathSync(join(d,n)))}catch{/* broken link */}}
 return [...out];
}
const PEM=/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const TOKEN=/\bsk-(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{16,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bxox[bpar]-[A-Za-z0-9-]{10,}|\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{30,}/g;
const NAMED=/\b((?:[A-Za-z0-9]+[_-])*(?:KEY|TOKEN|SECRET|PASSWORD)(?:[_-][A-Za-z0-9]+)*["']?\s*[=:]\s*["']?)[^\s"']{8,}/gi;
// ponytail: regexes catch common shapes and NAME=value pairs only; camelCase names (apiKey=...) and bare high-entropy strings pass through
/** Mask secrets in text before it reaches a model, log or PR. */
export function redact(text:string):string{return text.replace(PEM,'[redacted]').replace(TOKEN,'[redacted]').replace(NAMED,'$1[redacted]')}
