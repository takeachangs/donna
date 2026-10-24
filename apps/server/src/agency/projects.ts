import {existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {resolve} from 'node:path';
import {z} from 'zod';
import {newOffice,OfficeStore} from './state.js';
export type Project={id:string;name:string};
export class Projects {
 constructor(private store:OfficeStore){}
 list():Project[]{const p=resolve(this.store.root,'projects.json');return existsSync(p)?JSON.parse(readFileSync(p,'utf8')):[];}
 register(value:unknown){const a=z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(80)}).parse(value);const existing=this.list().find(p=>p.id===a.id);if(existing)return existing;const state=this.store.load(a.id);state.projectName=a.name;this.store.save(state);const project={id:a.id,name:a.name},p=resolve(this.store.root,'projects.json');writeFileSync(p+'.tmp',JSON.stringify([...this.list(),project],null,2));renameSync(p+'.tmp',p);return project;}
 create(value:unknown){const a=z.object({name:z.string().trim().min(1).max(80),brief:z.string().max(2000).default('')}).parse(value);const state=newOffice();state.projectName=a.name;state.goal=a.brief;this.store.save(state);const project={id:state.id,name:a.name},list=[...this.list(),project],p=resolve(this.store.root,'projects.json');writeFileSync(p+'.tmp',JSON.stringify(list,null,2));renameSync(p+'.tmp',p);return project;}
}
