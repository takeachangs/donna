import {describe,it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OfficeStore} from '../apps/server/src/agency/state';
import {Projects} from '../apps/server/src/agency/projects';
import {cost} from '../apps/server/src/agency/higgs';

function withStore(test:(store:OfficeStore)=>void){
 const dir=mkdtempSync(join(tmpdir(),'agency-store-'));
 try{test(new OfficeStore(dir))}finally{
  if(!dir.startsWith(join(tmpdir(),'agency-store-')))throw Error('Unexpected test directory');
  rmSync(dir,{recursive:true,force:true});
 }
}

describe('project persistence and compatibility',()=>{
 it('preserves project records and isolates new projects',()=>withStore(store=>{
  const projects=new Projects(store),a=projects.create({name:'Launch',brief:'English launch plan'}),b=projects.create({name:'Research'});
  const saved=store.load(a.id);saved.documents.push({id:'draft',title:'Existing draft',body:'Keep this original document.',author:'iris',revision:2,updatedAt:'2026-10-23T00:00:00Z'});
  saved.tasks.push({id:'old-task',owner:'iris',title:'Draft',brief:'Legacy task',status:'done',revision:3,documentId:'draft'});
  store.save(saved);
  expect(new OfficeStore(store.root).load(a.id)).toEqual(saved);
  expect(store.load(b.id).documents).toEqual([]);
  expect(new Projects(store).list()).toEqual([a,b]);
  projects.register({id:a.id,name:'Duplicate'});expect(projects.list()).toHaveLength(2);
  expect(store.load(a.id).documents[0].body).toBe('Keep this original document.');
 }));
 it('rejects invalid paths and empty project names',()=>withStore(store=>{
  expect(()=>store.load('../secret')).toThrow('Invalid');
  expect(()=>new Projects(store).create({name:' '})).toThrow();
 }));
 it('keeps missing usage distinct from measured zero',()=>{
  expect(cost(undefined)).toBeUndefined();
  expect(cost({input_tokens:0,output_tokens:0})).toBe(0);
  expect(cost({input_tokens:1000,output_tokens:1000,input_token_details:{cached_tokens:200}})).toBeCloseTo(.00515);
 });
});
