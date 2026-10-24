import 'dotenv/config';
import {createServer} from 'node:http';
import {WebSocketServer,WebSocket} from 'ws';
import {existsSync,readFileSync,appendFileSync,statSync} from 'node:fs';
import {resolve,basename} from 'node:path';
import {OfficeStore} from './state.js';
import {HiggsColleague,type Job} from './higgs.js';
import {Projects} from './projects.js';
import {AgencyExecutors} from './executors.js';
import {AgencyWorkspace,type Workspace} from './workspace.js';
import {secretaryInstructions,secretaryTools,resolveProjectTarget,hangsUp,pickUpNotice} from './secretary.js';
import {serveWeb} from './static.js';
import {completedBriefing,holdReason,openQuestion,resultNotice,hold,type Briefing,type Presentation} from './briefings.js';

const store=new OfficeStore(process.env.AGENCY_DATA_DIR?resolve(process.env.AGENCY_DATA_DIR):undefined),root=store.root,projects=new Projects(store),executors=new AgencyExecutors(),codex=executors.codex;
const defaultProvider=await executors.defaultProvider();
const clients=new Set<WebSocket>();
const broadcast=(event:unknown)=>{for(const ws of clients)if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(event));};
const landed=new Set<(w:Workspace)=>void>();
const workspace=new AgencyWorkspace(store,projects,codex,w=>{broadcast({type:'workspace',workspace:w});for(const f of landed)f(w);},{claude:executors.claude,brain:executors.brain,defaultProvider});
const local=(origin:string|undefined)=>!origin||/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin);
const json=(res:any,data:any,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function body(req:any){let text='';for await(const b of req){text+=b;if(text.length>60000)throw Error('Request too large');}return JSON.parse(text||'{}');}
function calls(){const p=resolve(root,'calls.jsonl');return existsSync(p)?readFileSync(p,'utf8').trim().split('\n').filter(Boolean).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}}):[];}
const server=createServer(async(req,res)=>{
 if(!local(req.headers.origin))return json(res,{error:'Local origins only'},403);
 const u=new URL(req.url||'/','http://localhost'),parts=u.pathname.split('/').filter(Boolean);
 try{
  if(u.pathname==='/agency-api/workspace')return json(res,workspace.snapshot());
  if(parts[0]==='agency-api'&&parts[1]==='briefings'&&parts[2]&&parts[3]==='presented'&&req.method==='POST'){await body(req);return json(res,workspace.presentBriefing(parts[2]));}
  if(u.pathname==='/agency-api/projects/register'&&req.method==='POST'){const p=projects.register(await body(req));workspace.syncProjects();return json(res,p);}
  if(u.pathname==='/agency-api/projects'){if(req.method==='POST'){const p=projects.create(await body(req));workspace.syncProjects();return json(res,p,201);}return json(res,projects.list());}
  if(parts[0]==='agency-api'&&parts[1]==='projects'&&parts[2]&&req.method==='POST'){const value=await body(req);if(parts[3]==='rename')return json(res,workspace.renameProject(parts[2],value));if(parts[3]==='delete')return json(res,workspace.deleteProject(parts[2]));if(parts[3]==='restore')return json(res,workspace.restoreProject(parts[2]));}
  if(u.pathname==='/agency-api/status'){const providers=await executors.status();return json(res,{available:!!process.env.BOSON_API_KEY,assistants:[workspace.snapshot().secretary],model:'higgs-realtime',codex:providers.codex,providers,execution:`local-${providers.defaultProvider}`,maxWorkersPerPlan:4});}
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
 let presentation:Presentation|undefined;
 const floor={userAt:0,voiceAt:0,userSpeaking:false,playing:false,question:false};let said='',saidFor='',pending:{id:string;since:number}[]=[],seen=new Set<string>(),announceJob:Job|undefined,heldWhy='',timer:ReturnType<typeof setInterval>|undefined,bye=false,pickup:string|undefined;
 const watch=(e:any)=>{const t=Date.now();
  if(e.type==='speech_started'){floor.userSpeaking=true;floor.userAt=t;floor.question=false;floor.playing=false;}
  else if(e.type==='thinking'&&floor.userSpeaking){floor.userSpeaking=false;floor.userAt=t;}
  else if(e.type==='speech_text'){if(e.responseId!==saidFor){saidFor=e.responseId;said='';}said+=e.delta;}
  else if(e.type==='turn_done'){floor.voiceAt=t;floor.question=!e.cancelled&&openQuestion(said);}
  else if(e.type==='await_playback')floor.playing=true;
  else if(e.type==='interrupted')floor.playing=false;
  else if(e.type==='user_transcript')bye=hangsUp(String(e.text||''));
 };
 const emit=(event:any)=>{watch(event);if(!closed&&client.readyState===WebSocket.OPEN)client.send(JSON.stringify(event));};
 const room=()=>selected?store.load(selected):undefined;
 // Keep old prose out of every turn. Full preserved drafts remain available on
 // an explicit read; current project memory describes the ongoing work.
 const progress=()=>Object.fromEntries(workspace.snapshot().projects.filter(p=>!p.deletedAt).flatMap(p=>{const t=workspace.progress(p.id);return t?[[p.name,t]]:[];}));
 const current=()=>({selected_project_id:projects.list().some(p=>p.id===selected)?selected:null,...(projects.list().length?{}:{note:'No projects yet; the office is only you. A room is created when the user asks for work.'}),progress:progress(),view,workspace:workspace.snapshot(),legacy:selected?{documents:room()!.documents.map(d=>({id:d.id,title:d.title,revision:d.revision}))}:undefined});
 const read=(id?:string)=>id?{...current(),project:workspace.snapshot().projects.find(p=>p.id===id),legacy:store.load(id)}:current();
 function tool(name:string,args:any,job:Job):any{
  if(name==='read_briefing'&&job===announceJob)throw Error('Only announce the result and ask whether the user wants it now; read it after they say yes.');
  args=resolveProjectTarget(name,args,selected,projects.list().map(p=>p.id));
  if(name==='read_workspace')return {committed:false,...read(args.project_id)};
  if(name==='read_briefing'){const b=workspace.briefing(args.briefing_id);presentation={briefingId:b.id,job,audioComplete:false};view='secretary';emit({type:'view',view});return {committed:false,briefing:{title:b.title,project:workspace.snapshot().projects.find(p=>p.id===b.projectId)?.name,summary:b.summary,files:b.artifacts.map(f=>f.path),verification:b.verification,contributors:b.contributors},note:'Give the short version in two or three spoken sentences: what was made, who made it, and anything the user must do. Never say file paths, ids, check lists or markdown aloud. Playback completion records presentation; it does not accept the work.'};}
  if(name==='set_secretary_identity')return workspace.setSecretary(args);
  if(name==='create_project'||name==='delegate_work'){const result=name==='create_project'?workspace.createProject(args):workspace.delegate(args);if('project' in result){selected=result.project.id;emit({type:'state',state:room()});}return result;}
  if(name==='update_project')return workspace.updateProject(args);
  if(name==='revise_assignment')return workspace.revise(args);
  if(name==='control_assignment'){if(args.action==='pause')return workspace.pause(args.assignment_id);if(args.action==='resume')return workspace.resume(args.assignment_id);if(args.action==='accept')return workspace.accept(args.assignment_id);throw Error('Unknown control action');}
  if(name==='record_decision')return workspace.decide(args);
  if(name==='prepare_command_room'){view='command';emit({type:'view',view:'command'});return {committed:true,...read(args.project_id)};}
  throw Error('Unknown secretary tool');
 }
 const onLanded=(w:Workspace)=>{for(const b of w.briefings)if(b.status==='queued'&&!seen.has(b.id)){seen.add(b.id);pending.push({id:b.id,since:Date.now()});console.log(`[ring] landed ${b.id} for ${w.projects.find(p=>p.id===b.projectId)?.name||'a project'}`);}};
 async function announce(){
  if(!ready||!voice||closed)return;
  const bs:Briefing[]=[];pending=pending.filter(p=>{try{const b=workspace.briefing(p.id);if(b.id===presentation?.briefingId){console.log(`[ring] dropped ${p.id}: presented by user`);return false;}bs.push(b);return true;}catch{console.log(`[ring] dropped ${p.id}: no longer queued`);return false;}});
  if(!bs.length)return;
  const now=Date.now(),names=workspace.snapshot().projects,label=bs.map(b=>`"${b.title}" for ${names.find(p=>p.id===b.projectId)?.name||'a project'} (briefing_id ${b.id})`).join('; '),why=holdReason({now,heldSince:pending[0].since,voiceBusy:voice.busy,...floor});
  if(why){if(why!==heldWhy)console.log(`[ring] holding ${label}: ${why}`);heldWhy=why;return;}
  heldWhy='';const since=pending[0].since;pending=[];console.log(`[ring] announcing ${label} after ${((now-since)/1000).toFixed(1)} s`);
  for(const b of bs)emit({type:'ring',briefingId:b.id});
  const who=pickup;pickup=undefined;
  try{announceJob=await voice.ask(resultNotice(bs.map(b=>({id:b.id,title:b.title,project:names.find(p=>p.id===b.projectId)?.name||'the project',names:b.contributors.map(c=>c.name)})),who));}catch(err){emit({type:'error',message:String(err)});}
 }
 client.on('message',raw=>{void(async()=>{try{
  const e=JSON.parse(raw.toString());
  if(e.type==='start'){
   if(started)throw Error('Already started');started=true;
   seen=new Set(workspace.snapshot().briefings.filter(b=>b.status==='queued').map(b=>b.id));landed.add(onLanded);
   if(e.roomId){if(!projects.list().some(p=>p.id===e.roomId))throw Error('Select a registered project');selected=e.roomId;}
   if(['secretary','command','project'].includes(e.view))view=e.view;
   if(selected)emit({type:'state',state:room()});emit({type:'workspace',workspace:workspace.snapshot()});emit({type:'focus',agentId:'mara'});
   voice=new HiggsColleague('mara',()=>selected,root,emit,tool,(_id,job,hasAudio)=>{if(presentation?.job===job)presentation.audioComplete=!job.cancelled&&hasAudio;if(!job.cancelled&&hasAudio)emit({type:'await_playback',jobId:job.id});},()=>{presentation=undefined;emit({type:'interrupted'});},{instructions:()=>secretaryInstructions,context:current,tools:secretaryTools,voice:'eleanor'});
   for(let attempt=0;;attempt++){try{await voice.connect();break;}catch(err){voice.close();if(closed||attempt>=2||!String(err).includes('429'))throw err;emit({type:'connection_retry',attempt:attempt+1});await new Promise(r=>setTimeout(r,4000*(attempt+1)));}}
   if(closed){voice.close();return;}ready=true;timer=setInterval(()=>{if(bye&&voice&&!voice.busy&&!floor.userSpeaking&&!floor.playing&&floor.voiceAt>floor.userAt){bye=false;console.log('[call] goodbye played; hanging up');voice.close();client.close();return;}void announce();},250);emit({type:'ready',model:'higgs-realtime'});
   const me=workspace.snapshot().secretary.name||'Donna';let answer:string|undefined;try{if(typeof e.answer==='string')answer=workspace.briefing(e.answer).id;}catch{}
   if(answer){pickup=me;pending.push({id:answer,since:Date.now()-hold.maxMs});console.log(`[ring] answered ${answer}`);}else await voice.ask(pickUpNotice(me));
   return;
  }
  if(!started||!voice)throw Error('Connect to the secretary first');
  if(['text','interrupt','switch_project','present_briefing','stop'].includes(e.type))presentation=undefined;
  if(e.type==='text'){floor.userAt=Date.now();floor.question=false;}
  if(e.type==='present_briefing')pending=pending.filter(p=>p.id!==e.briefingId);
  if(e.type==='present_briefing'){if(!ready)throw Error('Secretary is connecting');const b=workspace.briefing(e.briefingId);emit({type:'interrupted'});await voice.ask(`Use read_briefing with briefing_id ${b.id}. Give me the short version in two or three spoken sentences: what was made, who made it, and anything I need to do. Never say file paths, IDs, URLs or check lists aloud. Do not accept the work or start new work.`);return;}
  if(e.type==='switch_project'){if(!projects.list().some(p=>p.id===e.roomId))throw Error('Unknown project');await voice.cancel();voice.clearInput();selected=e.roomId;view='project';emit({type:'interrupted'});emit({type:'state',state:room()});emit({type:'project_ready'});return;}
  if(e.type==='set_view'){if(!['secretary','command','project'].includes(e.view))throw Error('Unknown view');view=e.view;return;}
  if(e.type==='text'){if(!ready)throw Error('Secretary is connecting');if(typeof e.text!=='string'||!e.text.trim()||e.text.length>5000)throw Error('Invalid text');emit({type:'interrupted'});emit({type:'user_transcript',text:e.text});await voice.ask(e.text);return;}
  if(e.type==='audio'){if(typeof e.audio!=='string'||e.audio.length>16000||!/^[A-Za-z0-9+/]+=*$/.test(e.audio))throw Error('Invalid PCM frame');voice.audio(e.audio);return;}
  if(e.type==='interrupt'){if(typeof e.itemId==='string'&&Number.isFinite(e.audioEndMs))voice.truncate(e.itemId,e.audioEndMs);await voice.cancel();emit({type:'interrupted'});return;}
  if(e.type==='focus'){emit({type:'focus',agentId:'mara'});return;}
  if(e.type==='played'){floor.playing=false;floor.voiceAt=Date.now();const id=completedBriefing(presentation,e.jobId);if(id){presentation=undefined;workspace.presentBriefing(id);}return;}
  if(e.type==='stop'){voice.close();client.close();return;}
 }catch(err){emit({type:'error',message:String(err)});}})();});
 client.on('close',()=>{closed=true;clearInterval(timer);landed.delete(onLanded);clients.delete(client);voice?.close();});
});
void workspace.recover();
server.listen(Number(process.env.AGENCY_PORT||3003),'127.0.0.1',()=>{const address=server.address();console.log('Personal Agency API: http://127.0.0.1:'+(typeof address==='object'&&address?address.port:process.env.AGENCY_PORT||3003));});
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{workspace.close();for(const ws of clients)ws.close();server.close();setTimeout(()=>process.exit(0),500).unref();});
