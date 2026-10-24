// Compatibility store for existing project rooms. New work lives in workspace.ts.
import {randomUUID} from 'node:crypto';
import {mkdirSync, readFileSync, existsSync, renameSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

export type AgentId = string;
export type Task = {id:string;owner:AgentId;title:string;brief:string;status:'todo'|'doing'|'blocked'|'done'|'cancelled';revision:number;documentId?:string};
export type Document = {id:string;taskId?:string;title:string;body:string;revision:number;author:AgentId;updatedAt:string};
export type OfficeState = {id:string;revision:number;goal:string;projectName?:string;tasks:Task[];documents:Document[];meeting:{status:'idle'|'active'|'paused';queue:AgentId[]};events:{at:string;actor:string;message:string}[]};
export const newOffice = (id:string=randomUUID()):OfficeState => ({id,revision:0,goal:'',tasks:[],documents:[],meeting:{status:'idle',queue:[]},events:[]});

export class OfficeStore {
  constructor(readonly root=resolve('artifacts/agency')){mkdirSync(resolve(root,'rooms'),{recursive:true});}
  load(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid office id');const p=resolve(this.root,'rooms',id+'.json');return existsSync(p)?JSON.parse(readFileSync(p,'utf8')) as OfficeState:newOffice(id);}
  save(s:OfficeState){const p=resolve(this.root,'rooms',s.id+'.json');writeFileSync(p+'.tmp',JSON.stringify(s,null,2));renameSync(p+'.tmp',p);}
}
