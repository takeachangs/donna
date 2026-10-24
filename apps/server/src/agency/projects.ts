import {existsSync,readFileSync,writeFileSync,renameSync,realpathSync,statSync} from 'node:fs';
import {homedir} from 'node:os';
import {isAbsolute,resolve,sep} from 'node:path';
import {z} from 'zod';
import {newOffice,OfficeStore} from './state.js';
import {gitRoot} from './git.js';
export type Project={id:string;name:string;deletedAt?:string;path?:string;git?:boolean};
export class Projects {
 constructor(private store:OfficeStore){}
 list(includeDeleted=false):Project[]{const p=resolve(this.store.root,'projects.json'),all:Project[]=existsSync(p)?JSON.parse(readFileSync(p,'utf8')):[];return includeDeleted?all:all.filter(p=>!p.deletedAt);}
 private write(list:Project[]){const p=resolve(this.store.root,'projects.json');writeFileSync(p+'.tmp',JSON.stringify(list,null,2));renameSync(p+'.tmp',p);}
 rename(id:string,value:unknown){const {name}=z.object({name:z.string().trim().min(1).max(80)}).parse(value),list=this.list(true),project=list.find(p=>p.id===id&&!p.deletedAt);if(!project)throw Error('Unknown active project');project.name=name;const state=this.store.load(id);state.projectName=name;this.store.save(state);this.write(list);return project;}
 setDeleted(id:string,deleted:boolean){const list=this.list(true),project=list.find(p=>p.id===id);if(!project)throw Error('Unknown project');if(deleted)project.deletedAt??=new Date().toISOString();else delete project.deletedAt;this.write(list);return project;}
 register(value:unknown){const a=z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(80)}).parse(value);const existing=this.list(true).find(p=>p.id===a.id);if(existing){if(existing.deletedAt)throw Error('Project is in Recently deleted. Restore it explicitly.');return existing;}const state=this.store.load(a.id);state.projectName=a.name;this.store.save(state);const project={id:a.id,name:a.name};this.write([...this.list(true),project]);return project;}
 /** A room may be an attached folder: validated here, resolved to its git toplevel, and one room per folder ("memory per repo"). */
 private attach(given:string,allowNonGit?:boolean){
  const p=given.replace(/^~(?=$|\/)/,homedir());
  if(!isAbsolute(p))throw Error('Give the full folder path, like /Users/you/projects/app.');
  if(!existsSync(p))throw Error(`No folder at ${p}.`);
  if(!statSync(p).isDirectory())throw Error(`${p} is a file, not a folder.`);
  const real=realpathSync(p),data=realpathSync(this.store.root);
  if(real===data||real.startsWith(data+sep))throw Error(`${p} is inside Chamber's own data folder; pick a project folder.`);
  const root=gitRoot(real);
  if(!root&&!allowNonGit)throw Error(`${p} is not a git repository. Ask the user whether Donna may work directly in it without branches; if they agree, call again with allow_non_git true.`);
  return {path:root??real,git:!!root};
 }
 create(value:unknown){
  const a=z.object({name:z.string().trim().min(1).max(80),brief:z.string().max(2000).default(''),path:z.string().trim().max(1000).optional(),allow_non_git:z.boolean().optional()}).parse(value);
  const dir=a.path?this.attach(a.path,a.allow_non_git):undefined;
  const same=dir&&this.list(true).find(p=>p.path===dir.path);
  if(same){if(same.deletedAt)throw Error('Project is in Recently deleted. Restore it explicitly.');return {...same,existing:true as const};}
  const taken=new Set(this.list().map(p=>p.name.toLowerCase()));let name=a.name;for(let n=2;taken.has(name.toLowerCase());n++)name=`${a.name.slice(0,76)} ${n}`;const state=newOffice();state.projectName=name;state.goal=a.brief;this.store.save(state);const project:Project={id:state.id,name,...dir};this.write([...this.list(true),project]);return project;
 }
}
