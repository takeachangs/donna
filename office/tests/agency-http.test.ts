import {afterAll,beforeAll,expect,it} from 'vitest';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';

let child:ChildProcess,base:string,dir:string,exit:Promise<void>;
beforeAll(async()=>{
 dir=mkdtempSync(join(tmpdir(),'chamber-http-'));
 child=spawn(process.execPath,['--import','tsx','apps/server/src/agency/server.ts'],{
  cwd:resolve('.'),windowsHide:true,stdio:['ignore','pipe','pipe'],
  env:{...process.env,AGENCY_DATA_DIR:dir,AGENCY_PORT:'0',BOSON_API_KEY:''},
 });
 exit=new Promise(r=>child.once('exit',()=>r()));
 base=await new Promise<string>((resolve,reject)=>{
  let output='';const timeout=setTimeout(()=>reject(Error('API startup timed out: '+output)),8000);
  child.once('error',err=>{clearTimeout(timeout);reject(err)});
  child.once('exit',()=>{clearTimeout(timeout);reject(Error('API exited before readiness: '+output))});
  child.stderr?.on('data',data=>{output+=data});
  child.stdout?.on('data',data=>{output+=data;const match=output.match(/Personal Agency API: (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timeout);resolve(match[1])}});
 });
});
afterAll(async()=>{
 if(child){child.kill();await exit}
 if(dir){if(!resolve(dir).startsWith(resolve(tmpdir())+sep+'chamber-http-'))throw Error('Unexpected fixture directory');rmSync(dir,{recursive:true,force:true})}
});
const post=(path:string,body:unknown={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
it('exposes rename, delete and restore through the actual server routes',async()=>{
 const create=await post('/agency-api/projects',{name:'HTTP lifecycle fixture'});expect(create.status).toBe(201);
 const project=await create.json(),path='/agency-api/projects/'+project.id;
 const rename=await post(path+'/rename',{name:'Renamed room'});expect(rename.status).toBe(200);
 expect((await rename.json()).project.name).toBe('Renamed room');
 const remove=await post(path+'/delete');expect(remove.status).toBe(200);expect((await remove.json()).committed).toBe(true);
 expect(await(await fetch(base+'/agency-api/projects')).json()).toEqual([]);
 const workspace=await(await fetch(base+'/agency-api/workspace')).json();expect(workspace.projects[0].deletedAt).toBeTruthy();
 const register=await post('/agency-api/projects/register',{id:project.id,name:'Stale bookmark'});expect(register.status).toBe(400);
 const restore=await post(path+'/restore');expect(restore.status).toBe(200);
 expect(await(await fetch(base+'/agency-api/projects')).json()).toEqual([{id:project.id,name:'Renamed room'}]);
});
it('reports health, with the keyless run flagged as a problem',async()=>{
 const h=await(await fetch(base+'/agency-api/health')).json();
 expect(h.ok).toBe(false);expect(h.version).toMatch(/^\d+\.\d+\.\d+/);
 expect(['codex','claude']).toContain(h.engines.default);
 for(const k of ['codex','claude','brain'])expect(typeof h.engines[k].ready).toBe('boolean');
 expect(h.voice).toEqual({state:'none',sessions:0});
 expect(h.problems.some((m:string)=>m.includes('BOSON_API_KEY'))).toBe(true);
});
it('refuses to start when the data folder cannot be created',async()=>{
 const tmp=mkdtempSync(join(tmpdir(),'chamber-doctor-')),file=join(tmp,'file');writeFileSync(file,'x');
 const bad=spawn(process.execPath,['--import','tsx','apps/server/src/agency/server.ts'],{cwd:resolve('.'),windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,AGENCY_DATA_DIR:join(file,'data'),AGENCY_PORT:'0',BOSON_API_KEY:''}});
 let output='';bad.stdout?.on('data',d=>{output+=d});bad.stderr?.on('data',d=>{output+=d});
 const code=await new Promise<number|null>(r=>bad.once('exit',r));
 rmSync(tmp,{recursive:true,force:true});
 expect(code).toBe(1);expect(output).toContain('FATAL');
},15000);
