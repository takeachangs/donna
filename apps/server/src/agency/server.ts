import 'dotenv/config';
import {createServer} from 'node:http';
import {WebSocketServer,WebSocket} from 'ws';
import {existsSync,readFileSync,appendFileSync,statSync} from 'node:fs';
import {resolve,basename} from 'node:path';
import {OfficeStore} from './state.js';
import {HiggsColleague} from './higgs.js';
import {Projects} from './projects.js';
import {AgencyExecutors} from './executors.js';
import {AgencyWorkspace} from './workspace.js';
import {secretaryInstructions,secretaryTools} from './secretary.js';
import {serveWeb} from './static.js';

const store=new OfficeStore(),root=store.root,projects=new Projects(store),executors=new AgencyExecutors(),codex=executors.codex;
const clients=new Set<WebSocket>();
const broadcast=(event:unknown)=>{for(const ws of clients)if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(event));};
const workspace=new AgencyWorkspace(store,projects,codex,w=>broadcast({type:'workspace',workspace:w}));
const local=(origin:string|undefined)=>!origin||/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin);
const json=(res:any,data:any,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function body(req:any){let text='';for await(const b of req){text+=b;if(text.length>60000)throw Error('Request too large');}return JSON.parse(text||'{}');}
function calls(){const p=resolve(root,'calls.jsonl');return existsSync(p)?readFileSync(p,'utf8').trim().split('\n').filter(Boolean).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}}):[];}
const server=createServer(async(req,res)=>{
 if(!local(req.headers.origin))return json(res,{error:'Local origins only'},403);
 const u=new URL(req.url||'/','http://localhost'),parts=u.pathname.split('/').filter(Boolean);
 try{
  if(u.pathname==='/agency-api/workspace')return json(res,workspace.snapshot());
  if(u.pathname==='/agency-api/projects/register'&&req.method==='POST'){const p=projects.register(await body(req));workspace.syncProjects();return json(res,p);}
  if(u.pathname==='/agency-api/projects'){if(req.method==='POST'){const p=projects.create(await body(req));workspace.syncProjects();return json(res,p,201);}return json(res,projects.list());}
  if(u.pathname==='/agency-api/status'){const providers=await executors.status();return json(res,{available:!!process.env.BOSON_API_KEY,assistants:[workspace.snapshot().secretary],model:'higgs-realtime',codex:providers.codex,providers,execution:'local-codex',maxWorkersPerPlan:4});}
  if(parts[0]==='agency-api'&&parts[1]==='assignments'&&parts[2]){
   const id=parts[2];
   if(req.method==='POST'){await body(req);if(parts[3]==='pause')return json(res,workspace.pause(id));if(parts[3]==='resume')return json(res,workspace.resume(id));if(parts[3]==='accept')return json(res,workspace.accept(id));}
   if(req.method==='GET'&&parts[3]==='files'){const path=u.searchParams.get('path')||'',file=workspace.artifact(id,path,u.searchParams.get('version')||undefined);res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Content-Length':statSync(file).size,'Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(basename(file))}`,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Cache-Control':'no-store'});res.end(readFileSync(file));return;}
  }
  if(parts[0]==='agency-api'&&parts[1]==='decisions'&&parts[2]&&req.method==='POST'){const v=await body(req),d=workspace.snapshot().decisions.find(d=>d.id===parts[2]);if(!d)throw Error('Unknown decision');return json(res,workspace.decide({id:d.id,project_id:d.projectId,status:'decided',decision:v.decision,reason:v.reason}));}
  if(parts[0]==='agency-api'&&parts[1]==='rooms'&&parts[2]){
   const s=store.load(parts[2]);
   if(parts[3]==='calls')return json(res,calls().filter(r=>r.roomId===s.id));
   if(parts[3]==='documents'&&parts[4]){const id=parts[4].replace(/\.md$/,''),d=s.documents.find(d=>d.id===id);if(!d)return json(res,{error:'Document not found'},404);res.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8','Cache-Control':'no-store'});res.end(`# ${d.title}\n\n${d.body}`);return;}
   return json(res,s);
  }
  if(parts[0]==='agency-api'&&parts[1]==='audio'&&parts[2]&&/^[a-f0-9-]{36}\.wav$/.test(parts[2])){const p=resolve(root,'audio',parts[2]);if(!existsSync(p))return json(res,{error:'Not found'},404);res.writeHead(200,{'Content-Type':'audio/wav','Cache-Control':'private, max-age=3600'});res.end(readFileSync(p));return;}
  if(u.pathname==='/agency-api/measurement'&&req.method==='POST'){const data=await body(req);appendFileSync(resolve(root,'browser.jsonl'),JSON.stringify({...data,at:new Date().toISOString()})+'\n');return json(res,{ok:true});}
  if(parts[0]!=='agency-api'&&serveWeb(req,res,u.pathname))return;
  return json(res,{error:'Not found'},404);
 }catch(err){return json(res,{error:String(err)},400);}
});
const wss=new WebSocketServer({server,path:'/agency-ws',maxPayload:24000});
wss.on('connection',(client,req)=>{
 if(!local(req.headers.origin)){client.close(1008);return;}
 clients.add(client);let selected=projects.list()[0]?.id||'',view='secretary',started=false,ready=false,voice:HiggsColleague|undefined,closed=false;
 const emit=(event:any)=>{if(!closed&&client.readyState===WebSocket.OPEN)client.send(JSON.stringify(event));};
 const room=()=>store.load(selected||projects.list()[0]?.id);
 const current=()=>({selected_project_id:selected,view,workspace:workspace.snapshot(),legacy:selected?{...room(),documents:room().documents.map(d=>({...d,body:d.body.slice(0,2500)}))}:undefined});
 const read=(id?:string)=>id?{...current(),project:workspace.snapshot().projects.find(p=>p.id===id),legacy:store.load(id)}:current();
 function tool(name:string,args:any):any{
  if(name==='read_workspace')return {committed:false,...read(args.project_id)};
  if(name==='set_secretary_identity')return workspace.setSecretary(args);
  if(name==='create_project'){const p=projects.create(args);workspace.syncProjects();selected=p.id;emit({type:'state',state:room()});return {committed:true,project:p};}
  if(name==='update_project')return workspace.updateProject(args);
  if(name==='delegate_work')return workspace.delegate(args);
  if(name==='revise_assignment')return workspace.revise(args);
  if(name==='control_assignment'){if(args.action==='pause')return workspace.pause(args.assignment_id);if(args.action==='resume')return workspace.resume(args.assignment_id);if(args.action==='accept')return workspace.accept(args.assignment_id);throw Error('Unknown control action');}
  if(name==='record_decision')return workspace.decide(args);
  if(name==='prepare_command_room'){view='command';emit({type:'view',view:'command'});return {committed:true,...read(args.project_id)};}
  throw Error('Unknown secretary tool');
 }
 client.on('message',raw=>{void(async()=>{try{
  const e=JSON.parse(raw.toString());
  if(e.type==='start'){
   if(started)throw Error('Already started');started=true;
   if(e.roomId){if(!projects.list().some(p=>p.id===e.roomId))throw Error('Select a registered project');selected=e.roomId;}
   if(!selected)throw Error('Create a project room first');if(['secretary','command','project'].includes(e.view))view=e.view;
   emit({type:'state',state:room()});emit({type:'workspace',workspace:workspace.snapshot()});emit({type:'focus',agentId:'mara'});
   voice=new HiggsColleague('mara',()=>selected,root,emit,tool,(_id,job,hasAudio)=>{if(!job.cancelled&&hasAudio)emit({type:'await_playback',jobId:job.id});},()=>emit({type:'interrupted'}),{instructions:()=>secretaryInstructions,context:current,tools:secretaryTools,voice:'eleanor'});
   for(let attempt=0;;attempt++){try{await voice.connect();break;}catch(err){voice.close();if(closed||attempt>=2||!String(err).includes('429'))throw err;emit({type:'connection_retry',attempt:attempt+1});await new Promise(r=>setTimeout(r,4000*(attempt+1)));}}
   if(closed){voice.close();return;}ready=true;emit({type:'ready',model:'higgs-realtime'});return;
  }
  if(!started||!voice)throw Error('Connect to the secretary first');
  if(e.type==='switch_project'){if(!projects.list().some(p=>p.id===e.roomId))throw Error('Unknown project');await voice.cancel();voice.clearInput();selected=e.roomId;view='project';emit({type:'interrupted'});emit({type:'state',state:room()});emit({type:'project_ready'});return;}
  if(e.type==='set_view'){if(!['secretary','command','project'].includes(e.view))throw Error('Unknown view');view=e.view;return;}
  if(e.type==='text'){if(!ready)throw Error('Secretary is connecting');if(typeof e.text!=='string'||!e.text.trim()||e.text.length>5000)throw Error('Invalid text');emit({type:'interrupted'});emit({type:'user_transcript',text:e.text});await voice.ask(e.text);return;}
  if(e.type==='audio'){if(typeof e.audio!=='string'||e.audio.length>16000||!/^[A-Za-z0-9+/]+=*$/.test(e.audio))throw Error('Invalid PCM frame');voice.audio(e.audio);return;}
  if(e.type==='interrupt'){if(typeof e.itemId==='string'&&Number.isFinite(e.audioEndMs))voice.truncate(e.itemId,e.audioEndMs);await voice.cancel();emit({type:'interrupted'});return;}
  if(e.type==='focus'){emit({type:'focus',agentId:'mara'});return;}
  if(e.type==='played')return;
  if(e.type==='stop'){voice.close();client.close();return;}
 }catch(err){emit({type:'error',message:String(err)});}})();});
 client.on('close',()=>{closed=true;clients.delete(client);voice?.close();});
});
void workspace.recover();
server.listen(Number(process.env.AGENCY_PORT||3003),'127.0.0.1',()=>console.log('Personal Agency API: http://127.0.0.1:'+String(process.env.AGENCY_PORT||3003)));
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{workspace.close();for(const ws of clients)ws.close();server.close();setTimeout(()=>process.exit(0),500).unref();});
