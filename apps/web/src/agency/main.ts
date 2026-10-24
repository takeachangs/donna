import {initLocale,setLocale,t} from '../i18n'
import {Engine} from '../render/Engine'
import {AgencyScene} from './Scene'
import {OfficeAudio} from './Audio'
import type {State,Colleague,Doc,Project,Workspace,View,Assignment,Decision} from './types'
import './style.css'
import './board.css'
initLocale();setLocale('en')

const root=document.querySelector<HTMLDivElement>('#agency-root')!
root.innerHTML=`<main class="agency-shell">
 <nav class="agency-rail" aria-label="${t('agency.rooms')}">
  <a class="agency-brand" href="agency.html"><span class="brand-mark" aria-hidden="true">c.</span><span>${t('agency.title')}</span></a>
  <p class="rail-label">${t('agency.workspace')}</p>
  <button id="secretary-room" class="nav-item" aria-pressed="true"><span class="nav-icon" aria-hidden="true">◉</span>${t('agency.secretary_short')}</button>
  <button id="command-room" class="nav-item" aria-pressed="false"><span class="nav-icon" aria-hidden="true">⊞</span>${t('agency.command_room')}</button>
  <div class="rail-heading"><p class="rail-label">${t('agency.projects')}</p><button id="new-project" class="icon-button" aria-label="${t('agency.new_room')}" title="${t('agency.new_room')}">+</button></div>
  <div id="project-nav"></div><label class="sr-only" for="project-select">${t('agency.project')}</label><select id="project-select" hidden></select>
  <div class="rail-bottom"><button id="settings" class="nav-item">${t('agency.settings')}</button><span class="local-caption">${t('agency.local_workspace')}</span></div>
 </nav>
 <header class="agency-header"><div><p id="scene-context">${t('agency.subtitle')}</p><h1 id="page-title">${t('agency.secretary_office')}</h1></div><button id="connect" class="primary">${t('agency.connect')}</button></header>
 <section class="agency-stage" aria-label="${t('agency.scene')}">
  <div class="scene-toolbar"><span id="scene-label">${t('agency.secretary_office')}</span><button id="overview" class="quiet-button" aria-label="${t('agency.overview')}">${t('agency.map')}</button></div>
  <div id="agency-scene"></div><div id="roster" class="agency-roster" aria-label="${t('agency.team')}"></div>
  <div class="agency-caption" aria-live="polite"><strong id="speaker"></strong><p id="caption">${t('agency.welcome')}</p></div>
  <footer class="agency-controls"><div class="agency-secretary-line"><strong id="secretary-name"></strong><span id="execution-health"></span></div>
   <div class="agency-actions"><button id="mic" disabled aria-pressed="false">${t('agency.mic_on')}</button><button id="meet" disabled>${t('agency.meet')}</button><button id="interrupt" disabled>${t('agency.interrupt')}</button></div>
   <form id="command-form"><label class="sr-only" for="command">${t('agency.command')}</label><input id="command" maxlength="5000" autocomplete="off" placeholder="${t('agency.placeholder')}" disabled><button id="send" disabled>${t('agency.send')}</button></form>
   <div class="agency-status"><span id="status" role="status">${t('agency.loading')}</span></div>
  </footer>
 </section>
 <aside class="agency-board"><header><div><p class="board-context" id="board-context"></p><h2 id="board-title">${t('agency.secretary_office')}</h2></div><span id="revision"></span></header><p id="goal"></p>
  <div class="workspace-counts"><div><strong id="count-decisions">0</strong><span>${t('agency.count_decisions')}</span></div><div><strong id="count-review">0</strong><span>${t('agency.count_review')}</span></div><div><strong id="count-active">0</strong><span>${t('agency.count_active')}</span></div></div>
  <div id="error" role="alert" hidden></div>
  <section id="decisions-section"><h2>${t('agency.needs_decision')}</h2><div id="decisions"></div></section>
  <section id="results-section"><h2>${t('agency.ready_review')}</h2><div id="results"></div></section>
  <section id="assignments-section"><h2>${t('agency.in_progress')}</h2><div id="assignments"></div></section>
  <details id="brief-section" hidden><summary>${t('agency.current_brief')}</summary><div id="brief"></div></details>
  <section id="projects-section"><h2>${t('agency.projects')}</h2><div id="projects"></div></section>
  <details id="team-details"><summary>${t('agency.team')}</summary><div id="team"></div></details>
  <details id="completed-details"><summary>${t('agency.completed')}</summary><div id="completed"></div></details>
  <details id="legacy-details"><summary>${t('agency.previous_deliverables')}</summary><p class="agency-note">${t('agency.legacy_note')}</p><div id="documents"></div></details>
  <details><summary>${t('agency.history')}</summary><div id="history"></div></details>
  <details><summary>${t('agency.recordings')}</summary><p id="meter" class="agency-note"></p><div id="recordings"></div></details>
 </aside>
 <dialog id="settings-dialog"><header><h2>${t('agency.settings')}</h2><button id="settings-close" aria-label="${t('agency.close')}">×</button></header><p class="agency-note">${t('agency.executors_intro')}</p><div class="provider-row"><div><strong>${t('agency.codex_label')}</strong><p>${t('agency.codex_model')}</p></div><span id="codex-provider-status"></span></div><div class="provider-row"><div><strong>${t('agency.claude_label')}</strong><p>${t('agency.claude_staged')}</p></div><span>${t('agency.unverified')}</span></div><p class="agency-note">${t('agency.scope')}</p></dialog>
 <dialog id="project-dialog"><form id="project-form"><h2>${t('agency.new_room')}</h2><label for="project-name">${t('agency.project_name')}</label><input id="project-name" required maxlength="80" placeholder="${t('agency.project_name_hint')}"><label for="project-brief">${t('agency.project_brief')}</label><textarea id="project-brief" maxlength="2000" rows="3"></textarea><p id="project-error" role="alert" hidden></p><div class="project-dialog-actions"><button type="button" id="project-cancel">${t('agency.cancel')}</button><button type="submit">${t('agency.create_room')}</button></div></form></dialog>
 <dialog id="document-dialog"><header><h2 id="document-title"></h2><button id="document-close" aria-label="${t('agency.close')}">×</button></header><p id="document-meta"></p><pre id="document-body"></pre><a id="document-download" target="_blank" rel="noopener">${t('agency.download')}</a></dialog>
 <dialog id="work-dialog" aria-labelledby="work-title"><header><h2 id="work-title"></h2><button id="work-close" aria-label="${t('agency.close')}">×</button></header><p id="work-meta"></p><div id="work-body"></div></dialog>
</main>`
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id)! as T
const make=<K extends keyof HTMLElementTagNameMap>(tag:K,cls='',text='')=>{const e=document.createElement(tag);e.className=cls;e.textContent=text;return e}
let socket:WebSocket|undefined,audio:OfficeAudio|undefined,scene:AgencyScene|undefined,state:State|undefined,cast:Colleague[]=[],workspace:Workspace|undefined,ready=false,mic=false,currentResponse='',connected=false,firstTurnAt=0,projects:Project[]=[],selectedProject='',view:View='secretary',switching=false,polling=false
const usage=new Map<string,any>(),heard=new Set<string>(),signatures=new Map<string,string>()
let actionError='',transportError=''
const roomKey='personal-agency-room'
const name=(id:string)=>(id==='mara'?workspace?.secretary.name:undefined)||workspace?.workers.find(w=>w.id===id)?.name||cast.find(a=>a.id===id)?.name||({iris:'Iris',theo:'Theo'} as Record<string,string>)[id]||id
const projectName=(id:string)=>projects.find(p=>p.id===id)?.name||id
const send=(e:any)=>{if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(e))}
const status=(text:string)=>{el('status').textContent=text}
const paintError=()=>{el('error').hidden=!(actionError||transportError);el('error').textContent=actionError||transportError}
const error=(message='')=>{if(!message){actionError='';transportError=''}else if(/^TransportError:|^SyntaxError:.*JSON|Unexpected end of JSON|Failed to fetch|fetch failed|NetworkError/.test(message)){transportError=message.replace(/^TransportError: /,'')}else actionError=message;paintError()}
function clearTransportError(){if(!transportError)return;transportError='';paintError();if(el('status').textContent===t('agency.error'))status(t(connected?'agency.ready':'agency.offline_ready'))}
const controls=(value:boolean)=>{ready=value;for(const id of ['mic','meet','interrupt','command','send'])(el(id) as HTMLButtonElement).disabled=!value}
class TransportError extends Error{constructor(){super(t('agency.reconnecting_workspace'));this.name='TransportError'}}
async function api<T=any>(url:string,body?:unknown):Promise<T>{let r:Response;try{r=await fetch(url,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})}catch{throw new TransportError()}if(r.status>=500)throw new TransportError();let value:any;try{value=await r.json()}catch{throw new TransportError()}if(!r.ok)throw Error(value.error||t('agency.request_failed'));return value}
function section(id:string,value:unknown,render:()=>HTMLElement[]){const signature=JSON.stringify(value);if(signatures.get(id)===signature)return;signatures.set(id,signature);const host=el(id),open=new Set([...host.querySelectorAll<HTMLDetailsElement>('details[open]')].map(d=>d.dataset.key));host.replaceChildren(...render());for(const d of host.querySelectorAll<HTMLDetailsElement>('details'))if(open.has(d.dataset.key))d.open=true}
function empty(text:string){return make('p','empty',text)}
function command(text:string){if(!ready||!text.trim())return;audio?.stop();firstTurnAt=performance.now();currentResponse='';el('caption').textContent='';send({type:'text',text,agentId:'mara'});status(t('agency.thinking'))}
function openDoc(doc:Doc){el('document-title').textContent=doc.title;el('document-body').textContent=doc.body;el('document-meta').textContent=`${name(doc.author)} · v${doc.revision} · ${t('agency.draft')}`;el<HTMLAnchorElement>('document-download').href=`/agency-api/rooms/${state!.id}/documents/${doc.id}.md`;el<HTMLDialogElement>('document-dialog').showModal()}
function renderLegacy(){section('documents',[selectedProject,state?.id,state?.documents],()=>state?.id===selectedProject&&state.documents.length?state.documents.map(doc=>{const b=make('button','agency-document');b.append(make('strong','',doc.title),make('span','',`${name(doc.author)} · v${doc.revision}`));b.onclick=()=>openDoc(doc);return b}):[empty(t('agency.empty_documents'))])}
function assignmentCard(a:Assignment){
 const worker=workspace?.workers.find(w=>w.id===a.workerId),row=make('article','work-item');row.dataset.assignmentId=a.id
 if(view!=='project')row.append(make('p','item-project',projectName(a.projectId)))
 row.append(make('h3','item-title',a.title))
 const byline=make('div','item-byline'),owner=make('div','item-owner');owner.append(make('strong','',worker?.name||t('agency.naming')),make('span','',worker?.role||t('agency.codex_worker')));byline.append(owner,make('span','work-status',t(`agency.${a.status==='review'?'badge_review':'status_'+a.status}`)));row.append(byline)
 const progress=a.status==='working'?t('agency.codex_executing'):a.status==='queued'?t('agency.execution_queued'):a.summary
 if(progress||a.error)row.append(make('p',a.error?'item-summary':'item-summary summary-preview',a.error||progress))
 appendArtifacts(row,a)
 const actions=make('div','item-actions')
 const inspect=make('button','inspect-result',t('agency.view_details'));inspect.setAttribute('aria-haspopup','dialog');inspect.setAttribute('aria-label',t('agency.view_assignment',{title:a.title}));inspect.onclick=()=>openWork(a.id);actions.append(inspect)
 function action(label:string,endpoint:string){const b=make('button','',t(label));b.onclick=()=>void(async()=>{b.disabled=true;try{await api(`/agency-api/assignments/${a.id}/${endpoint}`,{});await loadWorkspace()}catch(err){error(String(err));b.disabled=false}})();actions.append(b)}
 if(a.status==='review')action('agency.accept','accept');if(['working','queued','waiting'].includes(a.status))action('agency.pause_work','pause');if(['paused','failed','waiting'].includes(a.status))action('agency.resume_work','resume');if(actions.childElementCount)row.append(actions)
 return row
}
function appendArtifacts(host:HTMLElement,a:Assignment,fullPath=false){
 for(const saved of [true,false]){const files=(a.artifacts||[]).filter(artifact=>!!artifact.snapshotAt===saved);if(!files.length)continue;const group=make('div','artifact-group');group.append(make('p','artifact-heading',t(saved?'agency.saved_deliverables':'agency.current_project_files')));const links=make('div','artifact-links');for(const artifact of files){const link=make('a','artifact-link',fullPath?artifact.path:artifact.path.split(/[\\/]/).pop()||artifact.path);if(artifact.url.startsWith('/')||/^https?:\/\//.test(artifact.url)){link.href=artifact.url;link.target='_blank';link.rel='noopener'}link.title=artifact.path;links.append(link)}group.append(links);if(!saved)group.append(make('p','artifact-note',t('agency.current_files_note')));host.append(group)}
}
function openWork(id:string){
 const a=workspace?.assignments.find(a=>a.id===id);if(!a)return
 const worker=workspace?.workers.find(w=>w.id===a.workerId),body=el('work-body');body.replaceChildren();el('work-title').textContent=a.title
 el('work-meta').textContent=`${worker?.name||t('agency.naming')} · ${worker?.role||t('agency.codex_worker')} · ${projectName(a.projectId)} · ${t(`agency.status_${a.status}`)}`
 if(a.completedAt){const completedAt=new Date(a.completedAt);if(!Number.isNaN(completedAt.valueOf()))body.append(make('p','item-meta',t('agency.completed_at',{time:new Intl.DateTimeFormat('en-CA',{dateStyle:'medium',timeStyle:'short'}).format(completedAt)})))}
 if(a.error)body.append(make('p','work-error',a.error))
 if(a.summary)body.append(make('h3','',t('agency.result_summary')),make('p','work-prose',a.summary))
 appendArtifacts(body,a,true)
 if(a.verification?.length){body.append(make('h3','',t('agency.verification')));const verification=make('ul','verification');for(const v of a.verification)verification.append(make('li','',v));body.append(verification)}
 const details=make('details','execution-details');details.dataset.key=a.id;details.append(make('summary','',t('agency.execution_details')),make('p','',a.brief));if(a.acceptance)details.append(make('p','',`${t('agency.acceptance')}: ${a.acceptance}`));details.append(make('p','',`${t('agency.working_directory')}: ${a.cwd}`))
 if(worker?.currentAction)details.append(make('p','',t('agency.latest_action')),make('pre','token-usage',worker.currentAction))
 if(a.sessionId){const label=make('label','',t('agency.native_session')),input=make('input','session-command') as HTMLInputElement;input.readOnly=true;input.value=`codex resume ${a.sessionId}`;input.setAttribute('aria-label',t('agency.native_session'));input.onclick=()=>input.select();details.append(label,input,make('p','agency-note',t('agency.native_session_hint')))}
 if(a.tokens)details.append(make('p','agency-note',t('agency.native_tokens_note')),make('pre','token-usage',JSON.stringify(a.tokens,null,2)));body.append(details);const dialog=el<HTMLDialogElement>('work-dialog');dialog.showModal();dialog.scrollTop=0
}
function decisionCard(d:Decision){
 const row=make('article','decision-item');row.dataset.decisionId=d.id;row.append(make('strong','',d.title));if(view!=='project')row.append(make('p','item-meta',projectName(d.projectId)));row.append(make('p','item-summary',d.context))
 const form=make('form','decision-form'),label=make('label','',t('agency.your_decision')),input=make('textarea') as HTMLTextAreaElement;input.required=true;input.maxLength=2000;input.rows=2;input.id=`decision-${d.id}`;label.htmlFor=input.id;const submit=make('button','',t('agency.record_decision'));submit.type='submit';form.append(label);if(d.options?.length){const options=make('div','decision-options');for(const option of d.options){const b=make('button','',option);b.type='button';b.onclick=()=>{input.value=option;input.focus()};options.append(b)}form.append(options)}form.append(input,submit);form.onsubmit=e=>{e.preventDefault();submit.disabled=true;void(async()=>{try{await api(`/agency-api/decisions/${d.id}`,{decision:input.value});await loadWorkspace()}catch(err){error(String(err));submit.disabled=false}})()};row.append(form);return row
}
function render(){
 if(!workspace)return
 projects=workspace.projects;renderProjects();scene?.workspace(workspace)
 const project=workspace.projects.find(p=>p.id===selectedProject),all=view!=='project',assignments=workspace.assignments.filter(a=>all||a.projectId===selectedProject),decisions=workspace.decisions.filter(d=>d.status==='open'&&(all||d.projectId===selectedProject)),workers=workspace.workers.filter(w=>all||w.projectId===selectedProject)
 const title=view==='project'?project?.name||t('agency.project'):t(view==='command'?'agency.command_room':'agency.secretary_office')
 el('page-title').textContent=title;el('scene-label').textContent=title;el('board-context').textContent=t(view==='project'?'agency.project_room':'agency.workspace');el('board-title').textContent=t(view==='command'?'agency.decisions_results':view==='project'?'agency.project_overview':'agency.attention');el('scene-context').textContent=t(view==='command'?'agency.command_context':view==='secretary'?'agency.secretary_context':'agency.project_context');el('revision').textContent=`v${workspace.revision}`
 el('goal').textContent=view==='project'?project?.memory?.checkpoint||project?.goal||t('agency.empty_goal'):t(view==='command'?'agency.command_intro':'agency.secretary_intro');el('brief-section').hidden=view!=='project';el('projects-section').hidden=view==='project'
 section('brief',project?.memory,()=>{const memory=project?.memory;return memory?[['agency.outcome',memory.outcome],['agency.checkpoint',memory.checkpoint],['agency.latest',memory.latest],['agency.next_step',memory.nextStep]].filter(([,v])=>v).map(([key,value])=>{const p=make('div','brief-row');p.append(make('span','',t(key)),make('p','',value));return p}):[]})
 section('decisions',[view,decisions],()=>decisions.length?decisions.map(decisionCard):[empty(t('agency.no_decisions'))])
 const results=assignments.filter(a=>a.status==='review'),active=assignments.filter(a=>['queued','working','waiting','paused','failed'].includes(a.status)),completed=assignments.filter(a=>a.status==='done')
 el('count-decisions').textContent=String(decisions.length);el('count-review').textContent=String(results.length);el('count-active').textContent=String(active.length)
 el('decisions-section').hidden=!decisions.length;el('results-section').hidden=!results.length;el('assignments-section').hidden=!active.length&&(decisions.length+results.length>0)
 const roster=view==='secretary'?[workspace.secretary]:workers
 section('roster',[view,roster],()=>roster.length?roster.map(person=>{const b=make('button','person-chip');b.append(make('span','person-initial',person.name?.slice(0,1)||'·'));const text=make('span','person-caption');text.append(make('strong','',person.name||t('agency.naming')),make('small','',person.id==='mara'?t('agency.secretary_role'):t(`agency.status_${'status' in person?person.status:'queued'}`)));b.append(text);b.onclick=()=>{if(person.id==='mara'){setView('secretary');scene?.focus(person.id)}else{const w=workspace?.workers.find(w=>w.id===person.id);if(w)void switchProject(w.projectId).then(()=>scene?.focus(person.id)).catch(err=>error(String(err)))}};return b}):[make('p','roster-empty',t('agency.no_workers'))])
 const workerMeta=workers.map(w=>[w.id,w.name,w.role,w.currentAction]);section('results',[view,results,workerMeta],()=>results.length?results.map(assignmentCard):[empty(t('agency.no_results'))]);section('assignments',[view,active,workerMeta],()=>active.length?active.map(assignmentCard):[empty(t('agency.no_work'))]);section('completed',[view,completed,workerMeta],()=>completed.length?completed.map(assignmentCard):[empty(t('agency.no_completed'))])
 section('projects',workspace.projects,()=>workspace!.projects.map(p=>{const b=make('button','project-summary');b.append(make('strong','',p.name),make('span','',p.memory?.checkpoint||p.goal||t('agency.empty_goal')));if(p.memory?.latest)b.append(make('span','project-latest',p.memory.latest));b.onclick=()=>void switchProject(p.id).catch(err=>error(String(err)));return b}))
 section('team',workers,()=>workers.length?workers.map(w=>{const r=make('article','team-member');r.dataset.workerId=w.id;r.append(make('strong','',w.name||t('agency.naming')),make('span','item-meta',`${w.role} · ${t(`agency.status_${w.status}`)}`),make('p','',w.responsibility));return r}):[empty(t('agency.no_workers'))])
 section('history',workspace.activity,()=>workspace!.activity.slice(-20).reverse().map(a=>make('p','',`${a.projectId?projectName(a.projectId)+' · ':''}${a.message}`)))
 el('team-details').hidden=!workers.length;el('completed-details').hidden=!completed.length;renderLegacy()
 for(const [id,context] of [['secretary-room','secretary'],['command-room','command']])el(id).setAttribute('aria-pressed',String(view===context));el('secretary-name').textContent=`${workspace.secretary.name} · ${t('agency.secretary_role')}`;el('speaker').textContent=workspace.secretary.name
}
function meter(){
 const rows=[...usage.values()],sum=rows.reduce((n,r)=>n+(r.estimatedUSD||0),0),unknown=rows.filter(r=>r.usageMissing).length;el('meter').textContent=`${t('agency.estimate')} $${sum.toFixed(4)}${unknown?' + ?':''}`
 section('recordings',rows,()=>rows.filter(r=>r.file).slice(-16).reverse().map(r=>{const row=make('div','recording');row.append(make('p','',`${name(r.agentId)} · ${r.status} · ${Math.round(r.firstAudioMs||0)} ms`));const a=make('audio');a.controls=true;a.preload='none';a.src='/agency-api/'+r.file;row.append(a);if(r.transcript)row.append(make('p','',r.transcript));return row}))
}
function onEvent(e:any){
 if(e.type==='workspace'){workspace=e.workspace;render();clearTransportError()}
 if(e.type==='view'&&['secretary','command','project'].includes(e.view)){view=e.view;scene?.viewRoom(view==='project'?selectedProject:view);render()}
 if(e.type==='state'){state=e.state;selectedProject=state!.id;rememberRoom();renderLegacy();renderProjects()}
 if(e.type==='project_ready'){switching=false;usage.clear();void loadUsage();controls(true);status(t('agency.ready'));send({type:'set_view',view})}
 if(e.type==='colleague_ready')status(t('agency.connecting'))
 if(e.type==='ready'){controls(true);status(t('agency.ready'));el('connect').textContent=t('agency.disconnect');connected=true;error()}
 if(e.type==='thinking'){scene?.activity('mara','thinking');status(t('agency.thinking'));if(!firstTurnAt)firstTurnAt=performance.now()}
 if(e.type==='audio'){audio?.play(e);scene?.activity('mara','talking')}
 if(e.type==='speech_text'){if(currentResponse!==e.responseId){currentResponse=e.responseId;el('caption').textContent=''}el('caption').textContent+=e.delta}
 if(e.type==='speech_started'){audio?.stop();firstTurnAt=performance.now();status(t('agency.listening'));currentResponse='';el('caption').textContent=''}
 if(e.type==='interrupted'){audio?.stop(false);status(t('agency.interrupted'))}
 if(e.type==='await_playback')audio?.done(e.jobId)
 if(e.type==='turn_done'){if(!e.cancelled)status(t('agency.ready'));scene?.activity('mara','idle');void loadWorkspace().catch(err=>error(String(err)))}
 if(e.type==='usage'){usage.set(e.row.id,e.row);meter()}
 if(e.type==='error'||e.type==='colleague_disconnected'){error(e.message||t('agency.connection_lost'));status(t('agency.error'));if(switching){switching=false;controls(connected)}}
}
function rememberRoom(){localStorage.setItem(roomKey,selectedProject);const u=new URL(location.href);u.searchParams.set('room',selectedProject);history.replaceState({},'',u)}
async function start(){
 if(socket){socket.close();socket=undefined;audio?.stop(false);await audio?.mic(false);mic=false;connected=false;controls(false);el('mic').textContent=t('agency.mic_on');el('connect').textContent=t('agency.connect');status(t('agency.disconnected'));return}
 error();audio??=new OfficeAudio(send,(e,delay)=>{if(heard.has(e.jobId))return;heard.add(e.jobId);void fetch('/agency-api/measurement',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomId:selectedProject,kind:'first-audible',jobId:e.jobId,agentId:e.agentId,commandToAudibleMs:firstTurnAt?performance.now()-firstTurnAt+delay:undefined})});firstTurnAt=0})
 await audio.resume();status(t('agency.connecting'));el<HTMLButtonElement>('connect').disabled=true
 const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/agency-ws`);socket=ws
 ws.onopen=()=>{send({type:'start',roomId:selectedProject,view});el<HTMLButtonElement>('connect').disabled=false}
 ws.onmessage=e=>{try{onEvent(JSON.parse(e.data))}catch(err){error(String(err))}}
 ws.onclose=()=>{if(socket!==ws)return;socket=undefined;connected=false;controls(false);void audio?.mic(false);mic=false;audio?.stop(false);el('mic').textContent=t('agency.mic_on');el('mic').setAttribute('aria-pressed','false');el('connect').textContent=t('agency.connect');el<HTMLButtonElement>('connect').disabled=false;status(t('agency.disconnected'))}
 ws.onerror=()=>error(t('agency.connection_lost'))
}
function renderProjects(){section('project-select',[projects,selectedProject,view],()=>{const prompt=make('option','',t('agency.project_rooms'));prompt.value='';prompt.disabled=true;const options=projects.map(p=>{const o=make('option','',p.name);o.value=p.id;return o});return[prompt,...options]});el<HTMLSelectElement>('project-select').value=view==='project'?selectedProject:'';
 section('project-nav',[projects.map(p=>[p.id,p.name]),selectedProject,view],()=>projects.map(p=>{const b=make('button','nav-item project-nav-item');b.append(make('span','project-dot',''),make('span','',p.name));b.setAttribute('aria-pressed',String(view==='project'&&p.id===selectedProject));b.title=p.name;b.onclick=()=>void switchProject(p.id).catch(err=>error(String(err)));return b}));scene?.projects(projects)}
async function loadUsage(){if(!selectedProject)return;const rows=await api<any[]>(`/agency-api/rooms/${selectedProject}/calls`);for(const r of rows)usage.set(r.id,r);meter()}
async function loadWorkspace(){const next=await api<Workspace>('/agency-api/workspace');workspace=next;render();clearTransportError()}
function setView(next:View){view=next;scene?.viewRoom(next==='project'?selectedProject:next);if(connected)send({type:'set_view',view});render();document.querySelector<HTMLElement>('.agency-board')!.scrollTop=0}
async function switchProject(id:string){
 if(id==='command'||id==='secretary'){setView(id);return}if(switching)return;setView('project');scene?.viewRoom(id);if(selectedProject===id)return
 audio?.stop();selectedProject=id;rememberRoom();render();status(t('agency.switching'))
 if(connected){switching=true;controls(false);send({type:'switch_project',roomId:id})}else{state=await api<State>(`/agency-api/rooms/${id}`);renderLegacy();usage.clear();await loadUsage();status(t('agency.offline_ready'))}
}
el('secretary-room').onclick=()=>setView('secretary');el('command-room').onclick=()=>setView('command');el('overview').onclick=()=>scene?.overview()
el<HTMLSelectElement>('project-select').onchange=e=>void switchProject((e.target as HTMLSelectElement).value).catch(err=>error(String(err)))
el('new-project').onclick=()=>el<HTMLDialogElement>('project-dialog').showModal();el('project-cancel').onclick=()=>el<HTMLDialogElement>('project-dialog').close()
el('project-form').onsubmit=e=>{e.preventDefault();void(async()=>{const submit=el('project-form').querySelector<HTMLButtonElement>('[type=submit]')!;submit.disabled=true;el('project-error').hidden=true;try{const p=await api<Project>('/agency-api/projects',{name:el<HTMLInputElement>('project-name').value,brief:el<HTMLTextAreaElement>('project-brief').value});await loadWorkspace();el<HTMLDialogElement>('project-dialog').close();el<HTMLFormElement>('project-form').reset();await switchProject(p.id)}catch(err){el('project-error').hidden=false;el('project-error').textContent=String(err)}finally{submit.disabled=false}})()}
el('connect').onclick=()=>void start().catch(err=>error(String(err)))
el('mic').onclick=()=>void(async()=>{try{await audio!.resume();await audio!.mic(!mic);mic=!mic;el('mic').textContent=t(mic?'agency.mic_off':'agency.mic_on');el('mic').setAttribute('aria-pressed',String(mic));status(t(mic?'agency.listening':'agency.ready'))}catch(err){error(String(err))}})()
el('meet').onclick=()=>{setView('command');command(t('agency.meeting_request'))}
el('interrupt').onclick=()=>{audio?.stop();send({type:'interrupt'});status(t('agency.interrupted'))}
el('command-form').onsubmit=e=>{e.preventDefault();const input=el<HTMLInputElement>('command');command(input.value);input.value=''}
el('document-close').onclick=()=>el<HTMLDialogElement>('document-dialog').close()
el('work-close').onclick=()=>el<HTMLDialogElement>('work-dialog').close()
el('settings').onclick=()=>el<HTMLDialogElement>('settings-dialog').showModal();el('settings-close').onclick=()=>el<HTMLDialogElement>('settings-dialog').close()
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.querySelector('dialog[open]')){audio?.stop();send({type:'interrupt'})}})
window.addEventListener('pagehide',()=>{socket?.close();void audio?.close()})
async function init(){
 const data=await api('/agency-api/status');cast=data.assistants.filter((a:Colleague)=>a.id==='mara');el('execution-health').textContent=t(data.codex?.available&&data.codex?.authenticated?'agency.codex_ready':'agency.codex_unavailable');el('codex-provider-status').textContent=el('execution-health').textContent
 projects=await api<Project[]>('/agency-api/projects');const candidateRoom=new URLSearchParams(location.search).get('room');selectedProject=candidateRoom&&/^[a-f0-9-]{36}$/.test(candidateRoom)?candidateRoom:localStorage.getItem(roomKey)||projects[0]?.id||''
 if(!selectedProject){const p=await api<Project>('/agency-api/projects',{name:t('agency.first_project')});selectedProject=p.id;projects.push(p)}
 state=await api<State>(`/agency-api/rooms/${selectedProject}`);if(!projects.some(p=>p.id===selectedProject))await api('/agency-api/projects/register',{id:selectedProject,name:state.projectName||t('agency.first_project')});rememberRoom();await loadWorkspace();await loadUsage()
 const engine=new Engine(el('agency-scene'));await engine.init();scene=new AgencyScene(engine,el('agency-scene'),cast,id=>{scene?.focus(id);if(id==='mara')setView('secretary');else{const worker=workspace?.workers.find(w=>w.id===id);if(worker)void switchProject(worker.projectId).catch(err=>error(String(err)))}},(n,total)=>status(`${t('agency.loading')} ${n}/${total}`),id=>void switchProject(id).catch(err=>error(String(err))));await engine.loadScene(scene);engine.start();render();scene.viewRoom('secretary');scene.focus('mara');status(t('agency.offline_ready'));if(!data.available)error(t('agency.missing_key'))
 window.setInterval(()=>{if(polling||document.visibilityState==='hidden')return;polling=true;void loadWorkspace().catch(err=>error(String(err))).finally(()=>{polling=false})},1500)
}
void init().catch(err=>{error(String(err));status(t('agency.error'))})
