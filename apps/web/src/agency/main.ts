import {initLocale,setLocale,t} from '../i18n'
import {Engine} from '../render/Engine'
import {AgencyScene} from './Scene'
import {OfficeAudio,chime} from './Audio'
import {projectActions} from './projectActions'
import type {State,Colleague,Doc,Project,Workspace,View,Assignment,Decision,Briefing} from './types'
import './style.css'
import './board.css'
initLocale();setLocale('en')

const root=document.querySelector<HTMLDivElement>('#agency-root')!
root.innerHTML=`<main class="agency-shell">
 <nav class="agency-rail" aria-label="${t('agency.rooms')}">
  <a class="agency-brand" href="agency.html"><svg class="brand-plan" viewBox="0 0 32 36" aria-hidden="true"><path d="M12 3H3v11h9M20 3h9v11h-9M12 19H3v11h9M20 19h9v11h-9M16 7v25" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square"/><circle cx="16" cy="33" r="2.5" fill="currentColor"/></svg><span class="brand-wordmark">${t('agency.title')}</span></a>
  <p class="rail-label">${t('agency.workspace')}</p>
  <button id="command-room" class="nav-item" aria-pressed="true"><span class="nav-icon" aria-hidden="true">⊞</span>${t('agency.command_room')}</button>
  <button id="secretary-room" class="nav-item" aria-pressed="false"><span class="nav-icon" aria-hidden="true">◉</span>${t('agency.secretary_short')}</button>
  <div class="rail-heading"><p class="rail-label">${t('agency.projects')}</p><button id="new-project" class="icon-button" aria-label="${t('agency.new_room')}" title="${t('agency.new_room')}">+</button></div>
  <div id="project-nav"></div><label class="sr-only" for="project-select">${t('agency.project')}</label><select id="project-select" hidden></select>
  <div class="rail-bottom"><button id="deleted-projects" class="nav-item">${t('agency.recently_deleted')}<span id="deleted-count"></span></button><button id="settings" class="nav-item">${t('agency.settings')}</button><span class="local-caption">${t('agency.local_workspace')}</span></div>
 </nav>
 <header class="agency-header"><div><h1 id="page-title">${t('agency.secretary_office')}</h1></div><div class="header-actions"><button id="manage-current-project" hidden>${t('agency.project_settings')}</button><button id="connect" class="primary">${t('agency.connect')}</button></div></header>
 <section class="agency-stage" aria-label="${t('agency.scene')}">
  <div class="scene-toolbar"><span id="scene-label">${t('agency.secretary_office')}</span><div class="scene-navigation"><button id="zoom-out" class="quiet-button zoom-button" aria-label="${t('agency.zoom_out')}" title="${t('agency.zoom_out')}">−</button><button id="zoom-in" class="quiet-button zoom-button" aria-label="${t('agency.zoom_in')}" title="${t('agency.zoom_in')}">+</button><button id="overview" class="quiet-button" aria-label="${t('agency.overview')}" title="${t('agency.scene_controls')}">${t('agency.map')}</button></div></div>
  <div id="agency-scene"><div id="handoff-status" class="handoff-status" role="status" hidden></div></div><div id="roster" class="agency-roster" aria-label="${t('agency.team')}"></div>
  <div class="agency-caption" aria-live="polite"><strong id="speaker"></strong><p id="caption">${t('agency.welcome')}</p></div>
  <footer class="agency-controls"><div class="agency-secretary-line"><strong id="secretary-name"></strong><span id="execution-health"></span></div>
   <div class="agency-actions"><button id="mic" disabled aria-pressed="false">${t('agency.mic_on')}</button><button id="meet" disabled>${t('agency.meet')}</button><button id="interrupt" disabled>${t('agency.interrupt')}</button></div>
   <form id="command-form"><label class="sr-only" for="command">${t('agency.command')}</label><input id="command" maxlength="5000" autocomplete="off" placeholder="${t('agency.placeholder')}" disabled><button id="send" disabled>${t('agency.send')}</button></form>
   <div class="agency-status"><span id="status" role="status">${t('agency.loading')}</span></div>
  </footer>
 </section>
 <aside class="agency-board"><header><div><h2 id="board-title">${t('agency.secretary_office')}</h2></div></header><p id="goal"></p>
  <div class="workspace-counts"><div><strong id="count-decisions">0</strong><span>${t('agency.count_decisions')}</span></div><div><strong id="count-review">0</strong><span>${t('agency.count_review')}</span></div><div><strong id="count-active">0</strong><span>${t('agency.count_active')}</span></div></div>
  <div id="error" role="alert" hidden></div>
  <section id="briefings-section"><div class="queue-heading"><h2>${t('agency.briefing_queue')}</h2><span id="briefing-count"></span></div><ol id="briefings" aria-label="${t('agency.briefing_queue')}"></ol><details class="briefing-history"><summary>${t('agency.presented_briefings')}</summary><div id="briefing-history"></div></details></section>
  <section id="decisions-section"><h2>${t('agency.needs_decision')}</h2><div id="decisions"></div></section>
  <section id="results-section"><h2>${t('agency.ready_review')}</h2><div id="results"></div></section>
  <section id="assignments-section"><h2>${t('agency.in_progress')}</h2><div id="assignments"></div></section>
  <details id="brief-section" hidden><summary>${t('agency.current_brief')}</summary><div id="brief"></div></details>
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
let socket:WebSocket|undefined,audio:OfficeAudio|undefined,scene:AgencyScene|undefined,state:State|undefined,cast:Colleague[]=[],workspace:Workspace|undefined,ready=false,mic=false,currentResponse='',connected=false,firstTurnAt=0,projects:Project[]=[],selectedProject='',view:View='command',switching=false,polling=false
const usage=new Map<string,any>(),heard=new Set<string>(),signatures=new Map<string,string>()
let actionError='',transportError=''
let listenWhenReady:string|undefined,ringing:string|undefined,seenBriefings:Set<string>|undefined
const roomKey='personal-agency-room'
const name=(id:string)=>(id==='mara'?workspace?.secretary.name:undefined)||workspace?.workers.find(w=>w.id===id)?.name||cast.find(a=>a.id===id)?.name||({iris:'Iris',theo:'Theo'} as Record<string,string>)[id]||id
const projectName=(id:string)=>workspace?.projects.find(p=>p.id===id)?.name||id
const send=(e:any)=>{if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(e))}
const status=(text:string)=>{el('status').textContent=text}
const projectManager=projectActions({projects:()=>workspace?.projects||[],request:api,refresh:loadWorkspace,notice:status})
const paintError=()=>{el('error').hidden=!(actionError||transportError);el('error').textContent=actionError||transportError}
const error=(message='')=>{if(!message){actionError='';transportError=''}else if(/^TransportError:|^SyntaxError:.*JSON|Unexpected end of JSON|Failed to fetch|fetch failed|NetworkError/.test(message)){transportError=message.replace(/^TransportError: /,'')}else actionError=message;paintError()}
function clearTransportError(){if(!transportError)return;transportError='';paintError();if(el('status').textContent===t('agency.error'))status(t(connected?'agency.ready':'agency.offline_ready'))}
const controls=(value:boolean)=>{ready=value;document.body.dataset.ready=String(value);for(const id of ['mic','meet','interrupt','command','send'])(el(id) as HTMLButtonElement).disabled=!value;renderBriefings()}
class TransportError extends Error{constructor(){super(t('agency.reconnecting_workspace'));this.name='TransportError'}}
async function api<T=any>(url:string,body?:unknown):Promise<T>{let r:Response;try{r=await fetch(url,body===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})}catch{throw new TransportError()}if(r.status>=500)throw new TransportError();let value:any;try{value=await r.json()}catch{throw new TransportError()}if(r.status===404&&body!==undefined&&/^\/agency-api\/projects\/[^/]+\/(rename|delete|restore)$/.test(url))throw Error(t('agency.project_controls_unavailable'));if(!r.ok)throw Error(value.error||t('agency.request_failed'));return value}
function section(id:string,value:unknown,render:()=>HTMLElement[]){const signature=JSON.stringify(value);if(signatures.get(id)===signature)return;signatures.set(id,signature);const host=el(id),open=new Set([...host.querySelectorAll<HTMLDetailsElement>('details[open]')].map(d=>d.dataset.key));host.replaceChildren(...render());for(const d of host.querySelectorAll<HTMLDetailsElement>('details'))if(open.has(d.dataset.key))d.open=true}
function empty(text:string){return make('p','empty',text)}
// Text readers may already have read the full caption while speech is playing.
// The text request cancels generation server-side; do not truncate its visible
// conversation history to the audio playhead when they type a follow-up.
function command(text:string){if(!ready||!text.trim())return;audio?.stop(false);firstTurnAt=performance.now();currentResponse='';el('caption').textContent='';send({type:'text',text,agentId:'mara'});status(t('agency.thinking'))}
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
function appendArtifacts(host:HTMLElement,a:Pick<Assignment,'artifacts'>,fullPath=false){
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
function presentBriefing(id?:string){if(!ready)return;setView('secretary');audio?.stop(false);firstTurnAt=performance.now();currentResponse='';el('caption').textContent='';send({type:'present_briefing',briefingId:id});status(t('agency.thinking'))}
function openBriefing(b:Briefing){
 const body=el('work-body');body.replaceChildren();el('work-title').textContent=b.title;el('work-meta').textContent=`${projectName(b.projectId)} · ${t('agency.with_donna')}`
 body.append(make('h3','',t('agency.result_summary')),make('p','work-prose',b.summary));appendArtifacts(body,b,true)
 if(b.verification.length){body.append(make('h3','',t('agency.verification')));const list=make('ul','verification');for(const v of b.verification)list.append(make('li','',v));body.append(list)}
 if(b.contributors.length>1){body.append(make('h3','',t('agency.contributors')));for(const c of b.contributors)body.append(make('p','item-meta',`${c.name} · ${c.title}`))}
 body.append(make('p','agency-note',t('agency.presentation_not_acceptance')))
 if(b.status==='queued'){const done=make('button','',t('agency.mark_presented'));done.onclick=()=>void(async()=>{done.disabled=true;try{await api(`/agency-api/briefings/${b.id}/presented`,{});await loadWorkspace();el<HTMLDialogElement>('work-dialog').close()}catch(err){error(String(err));done.disabled=false}})();body.append(done)}
 const replay=make('button','quiet-button',t('agency.show_handoff'));replay.onclick=()=>{el<HTMLDialogElement>('work-dialog').close();setView('command');el('agency-scene').scrollIntoView({block:'center',behavior:'instant'});scene?.replayHandoff(b.id)};body.append(replay)
 const dialog=el<HTMLDialogElement>('work-dialog');dialog.showModal();dialog.scrollTop=0
}
function ring(id:string|undefined){
 if(ringing===id)return
 ringing=id;const c=el('connect')
 if(id&&!socket){chime();scene?.ring(true);c.classList.add('is-ringing');c.textContent=t('agency.answer_call');status(t('agency.ring_status',{name:workspace?.secretary.name||'',title:workspace?.briefings.find(b=>b.id===id)?.title||''}))}
 else if(c.classList.contains('is-ringing')){scene?.ring(false);c.classList.remove('is-ringing');c.textContent=t(ready?'agency.disconnect':'agency.connect')}
 renderBriefings()
}
function watchRing(){
 if(!workspace)return
 const queued=workspace.briefings.filter(b=>b.status==='queued'&&workspace!.projects.some(p=>p.id===b.projectId&&!p.deletedAt)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)),ids=queued.map(b=>b.id)
 if(!seenBriefings){seenBriefings=new Set(ids);return}
 const fresh=queued.find(b=>!seenBriefings!.has(b.id));ids.forEach(id=>seenBriefings!.add(id))
 if(ringing&&!ids.includes(ringing))ring(undefined)
 if(fresh&&!socket&&!ringing)ring(fresh.id)
}
function renderBriefings(){
 if(!workspace)return
 const visible=(b:Briefing)=>workspace!.projects.some(p=>p.id===b.projectId&&!p.deletedAt),pending=workspace.briefings.filter(b=>b.status==='queued'&&visible(b)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)),history=workspace.briefings.filter(b=>b.status==='presented'&&visible(b)).sort((a,b)=>(b.presentedAt||'').localeCompare(a.presentedAt||'')).slice(0,12)
 el('briefings-section').hidden=view==='project';el('briefing-count').textContent=t('agency.queue_waiting',{count:String(pending.length)})
 section('briefings',[pending,workspace.workers.map(w=>[w.id,w.name]),workspace.projects,ready,!!socket,ringing],()=>pending.length?pending.map((b,i)=>{
  const slot=make('li',`briefing-slot${i===0?' is-next':''}${b.id===ringing?' is-ringing':''}`),number=make('span','queue-position',String(i+1).padStart(2,'0')),card=make('article','briefing-card')
  number.setAttribute('aria-hidden','true');slot.append(number,card)
  const stage=make('p','queue-stage',t(i===0?'agency.queue_next':'agency.queue_after'));if(b.id===ringing)stage.append(make('span','ring-badge',t('agency.ring_badge')));card.append(stage)
  if(i>0){const open=make('button','queue-waiting-open');open.append(make('strong','',b.title),make('span','',`${name(b.workerId)} · ${projectName(b.projectId)}`));open.setAttribute('aria-label',t('agency.view_assignment',{title:b.title}));open.onclick=()=>openBriefing(b);card.append(open);return slot}
  const owner=make('div','briefing-owner'),avatar=make('span','briefing-avatar',name(b.workerId).slice(0,1)),identity=make('div');avatar.setAttribute('aria-hidden','true');identity.append(make('strong','',name(b.workerId)),make('span','',projectName(b.projectId)));owner.append(avatar,identity);card.append(owner,make('h3','briefing-title',b.title))
  const actions=make('div','briefing-actions'),read=make('button','briefing-read',t('agency.read_briefing'));read.onclick=()=>openBriefing(b)
  if(i===0){
   card.append(make('p','summary-preview',b.summary),make('p','briefing-meta',t('agency.queue_evidence',{files:String(b.artifacts.length),checks:String(b.verification.length)})))
   const hear=make('button','briefing-listen',t(ready?'agency.hear_briefing':socket?'agency.connecting':'agency.connect_listen'));hear.id='present-next';hear.disabled=!!socket&&!ready
   hear.onclick=()=>{if(ready)presentBriefing(b.id);else{listenWhenReady=b.id;if(!socket)void start().catch(err=>{listenWhenReady=undefined;error(String(err))})}};actions.append(hear)
  }
  actions.append(read);card.append(actions);return slot
 }):[make('li','queue-empty',t('agency.queue_empty'))])
 section('briefing-history',[history,workspace.projects],()=>history.length?history.map(b=>{const button=make('button','project-summary',`${projectName(b.projectId)} · ${b.title}`);button.onclick=()=>openBriefing(b);return button}):[empty(t('agency.no_presented'))])
}
function render(){
 if(!workspace)return
 watchRing()
 document.body.dataset.view=view;document.body.dataset.ready=String(ready)
 projects=workspace.projects.filter(p=>!p.deletedAt)
 if(selectedProject&&!projects.some(p=>p.id===selectedProject)){if(socket)void start();selectedProject=projects[0]?.id||'';state=undefined;usage.clear();meter();view='command';rememberRoom();scene?.overview();document.body.dataset.view=view}
 if(!selectedProject&&projects.length){selectedProject=projects[0].id;rememberRoom();if(connected){switching=true;controls(false);send({type:'switch_project',roomId:selectedProject})}}
 renderProjects();scene?.workspace(workspace);projectManager.renderTrash();el('deleted-count').textContent=workspace.projects.some(p=>p.deletedAt)?String(workspace.projects.filter(p=>p.deletedAt).length):'';el('manage-current-project').hidden=view!=='project'
 const project=workspace.projects.find(p=>p.id===selectedProject&&!p.deletedAt),all=view!=='project',visible=(id:string)=>projects.some(p=>p.id===id)&&(all||id===selectedProject),assignments=workspace.assignments.filter(a=>visible(a.projectId)),decisions=workspace.decisions.filter(d=>d.status==='open'&&visible(d.projectId)),workers=workspace.workers.filter(w=>!w.lead&&visible(w.projectId))
 const title=view==='project'?project?.name||t('agency.project'):t(view==='command'?'agency.command_room':'agency.secretary_office')
 el('page-title').textContent=title;el('scene-label').textContent=title;el('board-title').textContent=t(view==='command'?'agency.decisions_results':view==='project'?'agency.project_overview':'agency.attention')
 el('goal').textContent=view==='project'?project?.memory?.checkpoint||project?.goal||t('agency.empty_goal'):'';el('brief-section').hidden=view!=='project'
 section('brief',project?.memory,()=>{const memory=project?.memory;return memory?[['agency.outcome',memory.outcome],['agency.checkpoint',memory.checkpoint],['agency.latest',memory.latest],['agency.next_step',memory.nextStep]].filter(([,v])=>v).map(([key,value])=>{const p=make('div','brief-row');p.append(make('span','',t(key)),make('p','',value));return p}):[]})
 section('decisions',[view,decisions],()=>decisions.length?decisions.map(decisionCard):[empty(t('agency.no_decisions'))])
 const results=assignments.filter(a=>a.status==='review'),active=assignments.filter(a=>['queued','working','waiting','paused','failed'].includes(a.status)),completed=assignments.filter(a=>a.status==='done')
 el('count-decisions').textContent=String(decisions.length);el('count-review').textContent=String(results.length);el('count-active').textContent=String(active.length)
 el('decisions-section').hidden=!decisions.length;el('results-section').hidden=view!=='project'||!results.length;el('assignments-section').hidden=!active.length&&!(view==='project'&&!assignments.length);el('assignments-section').querySelector('h2')!.textContent=t(active.length?'agency.in_progress':'agency.execution_details')
 const roster=view==='secretary'?[workspace.secretary]:view==='command'?[workspace.secretary,...workers]:workers
 section('roster',[view,roster],()=>roster.length?roster.map(person=>{const b=make('button','person-chip');b.append(make('span','person-initial',person.name?.slice(0,1)||'·'));const text=make('span','person-caption');text.append(make('strong','',person.name||t('agency.naming')),make('small','',person.id==='mara'?t('agency.secretary_role'):t(`agency.status_${'status' in person?person.status:'queued'}`)));b.append(text);b.onclick=()=>{if(person.id==='mara'){setView('secretary');scene?.focus(person.id)}else{const w=workspace?.workers.find(w=>w.id===person.id);if(w)void switchProject(w.projectId).then(()=>scene?.focus(person.id)).catch(err=>error(String(err)))}};return b}):[make('p','roster-empty',t('agency.no_workers'))])
 const workerMeta=workers.map(w=>[w.id,w.name,w.role,w.currentAction]);section('results',[view,results,workerMeta],()=>results.length?results.map(assignmentCard):[empty(t('agency.no_results'))]);section('assignments',[view,active,workerMeta],()=>active.length?active.map(assignmentCard):[empty(t('agency.no_work'))]);section('completed',[view,completed,workerMeta],()=>completed.length?completed.map(assignmentCard):[empty(t('agency.no_completed'))])
 section('team',workers,()=>workers.length?workers.map(w=>{const r=make('article','team-member');r.dataset.workerId=w.id;r.append(make('strong','',w.name||t('agency.naming')),make('span','item-meta',`${w.role} · ${t(`agency.status_${w.status}`)}`),make('p','',w.responsibility));return r}):[empty(t('agency.no_workers'))])
 section('history',workspace.activity,()=>workspace!.activity.slice(-20).reverse().map(a=>make('p','',`${a.projectId?projectName(a.projectId)+' · ':''}${a.message}`)))
 el('team-details').hidden=!workers.length;el('completed-details').hidden=!completed.length;renderLegacy()
 for(const [id,context] of [['secretary-room','secretary'],['command-room','command']])el(id).setAttribute('aria-pressed',String(view===context));el('secretary-name').textContent=`${workspace.secretary.name} · ${t('agency.secretary_role')}`;el('speaker').textContent=workspace.secretary.name;renderBriefings()
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
 if(e.type==='ring')ring(e.briefingId)
 if(e.type==='colleague_ready')status(t('agency.connecting'))
 if(e.type==='ready'){connected=true;controls(true);status(t('agency.ready'));el('connect').textContent=t('agency.disconnect');error();if(listenWhenReady){const id=listenWhenReady;listenWhenReady=undefined;presentBriefing(id)}}
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
function rememberRoom(){localStorage.setItem(roomKey,selectedProject);const u=new URL(location.href);if(selectedProject)u.searchParams.set('room',selectedProject);else u.searchParams.delete('room');history.replaceState({},'',u)}
async function start(){
 if(socket){ring(undefined);socket.close();socket=undefined;listenWhenReady=undefined;audio?.stop(false);mic=false;connected=false;controls(false);await audio?.mic(false);el('mic').textContent=t('agency.mic_on');el('connect').textContent=t('agency.connect');status(t('agency.disconnected'));return}
 if(ringing){listenWhenReady??=ringing;ring(undefined)}
 error();audio??=new OfficeAudio(send,(e,delay)=>{if(heard.has(e.jobId))return;heard.add(e.jobId);void fetch('/agency-api/measurement',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomId:selectedProject,kind:'first-audible',jobId:e.jobId,agentId:e.agentId,commandToAudibleMs:firstTurnAt?performance.now()-firstTurnAt+delay:undefined})});firstTurnAt=0})
 await audio.resume();status(t('agency.connecting'));el<HTMLButtonElement>('connect').disabled=true
 const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/agency-ws`);socket=ws;renderBriefings()
 ws.onopen=()=>{send({type:'start',roomId:selectedProject,view});el<HTMLButtonElement>('connect').disabled=false}
 ws.onmessage=e=>{try{onEvent(JSON.parse(e.data))}catch(err){error(String(err))}}
 ws.onclose=()=>{if(socket!==ws)return;socket=undefined;listenWhenReady=undefined;ring(undefined);connected=false;controls(false);void audio?.mic(false);mic=false;audio?.stop(false);el('mic').textContent=t('agency.mic_on');el('mic').setAttribute('aria-pressed','false');el('connect').textContent=t('agency.connect');el<HTMLButtonElement>('connect').disabled=false;status(t('agency.disconnected'))}
 ws.onerror=()=>error(t('agency.connection_lost'))
}
function renderProjects(){section('project-select',[projects,selectedProject,view],()=>{const prompt=make('option','',t('agency.project_rooms'));prompt.value='';prompt.disabled=true;const options=projects.map(p=>{const o=make('option','',p.name);o.value=p.id;return o});return[prompt,...options]});el<HTMLSelectElement>('project-select').value=view==='project'?selectedProject:'';
 section('project-nav',[projects.map(p=>[p.id,p.name]),selectedProject,view],()=>projects.map(p=>{const row=make('div','project-nav-row'),b=make('button','nav-item project-nav-item'),manage=make('button','project-options','···');b.append(make('span','project-dot',''),make('span','',p.name));b.setAttribute('aria-pressed',String(view==='project'&&p.id===selectedProject));b.title=p.name;b.onclick=()=>void switchProject(p.id).catch(err=>error(String(err)));manage.setAttribute('aria-label',t('agency.manage_named',{name:p.name}));manage.setAttribute('aria-haspopup','dialog');manage.title=t('agency.project_settings');manage.onclick=()=>projectManager.open(p.id);row.append(b,manage);return row}));scene?.projects(workspace?.projects||projects)}
async function loadUsage(){if(!selectedProject)return;const rows=await api<any[]>(`/agency-api/rooms/${selectedProject}/calls`);for(const r of rows)usage.set(r.id,r);meter()}
async function loadWorkspace(){const next=await api<Workspace>('/agency-api/workspace');workspace=next;render();clearTransportError()}
function setView(next:View){view=next;scene?.viewRoom(next==='project'?selectedProject:next);if(connected)send({type:'set_view',view});render();document.querySelector<HTMLElement>('.agency-board')!.scrollTop=0}
async function switchProject(id:string){
 if(id==='command'||id==='secretary'){setView(id);return}if(switching)return;setView('project');scene?.viewRoom(id);if(selectedProject===id){if(state?.id!==id){state=await api<State>(`/agency-api/rooms/${id}`);renderLegacy();await loadUsage()}return}
 audio?.stop();selectedProject=id;rememberRoom();render();status(t('agency.switching'))
 if(connected){switching=true;controls(false);send({type:'switch_project',roomId:id})}else{state=await api<State>(`/agency-api/rooms/${id}`);renderLegacy();usage.clear();await loadUsage();status(t('agency.offline_ready'))}
}
el('secretary-room').onclick=()=>setView('secretary');el('command-room').onclick=()=>setView('command');el('overview').onclick=()=>setView('command')
el('manage-current-project').onclick=()=>projectManager.open(selectedProject);el('deleted-projects').onclick=()=>projectManager.trash()
el('zoom-in').onclick=()=>scene?.zoomBy(1/1.25);el('zoom-out').onclick=()=>scene?.zoomBy(1.25)
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
 const data=await api('/agency-api/status');cast=data.assistants.filter((a:Colleague)=>a.id==='mara');const ok=(s:any)=>s?.available&&s?.authenticated;el('execution-health').textContent=t(ok(data.providers?.[data.providers.defaultProvider]||data.codex)?'agency.engine_ready':'agency.engine_unavailable');el('codex-provider-status').textContent=t(ok(data.codex)?'agency.codex_ready':'agency.codex_unavailable')
 workspace=await api<Workspace>('/agency-api/workspace');projects=workspace.projects.filter(p=>!p.deletedAt)
 const candidate=new URLSearchParams(location.search).get('room')||localStorage.getItem(roomKey)||''
 if(candidate&&/^[a-f0-9-]{36}$/.test(candidate)&&!workspace.projects.some(p=>p.id===candidate)){
  const old=await api<State>(`/agency-api/rooms/${candidate}`)
  if(old.projectName||old.documents.length){await api('/agency-api/projects/register',{id:candidate,name:old.projectName||t('agency.first_project')});workspace=await api<Workspace>('/agency-api/workspace');projects=workspace.projects.filter(p=>!p.deletedAt)}
 }
 if(!workspace.projects.length){const p=await api<Project>('/agency-api/projects',{name:t('agency.first_project')});projects.push(p)}
 selectedProject=projects.some(p=>p.id===candidate)?candidate:projects[0]?.id||''
 if(selectedProject)state=await api<State>(`/agency-api/rooms/${selectedProject}`)
 rememberRoom();await loadWorkspace();await loadUsage()
 const engine=new Engine(el('agency-scene'));await engine.init();scene=new AgencyScene(engine,el('agency-scene'),cast,id=>{scene?.focus(id);if(id==='mara')setView('secretary');else{const worker=workspace?.workers.find(w=>w.id===id);if(worker)void switchProject(worker.projectId).catch(err=>error(String(err)))}},(n,total)=>status(`${t('agency.loading')} ${n}/${total}`),id=>void switchProject(id).catch(err=>error(String(err))),person=>{el('handoff-status').hidden=!person;el('handoff-status').textContent=person?t('agency.handoff_status',{name:person}):''});await engine.loadScene(scene);engine.start();render();scene.viewRoom(view==='project'?selectedProject:view);scene.focus('mara');status(t('agency.offline_ready'));if(!data.available)error(t('agency.missing_key'))
 window.setInterval(()=>{if(polling||document.visibilityState==='hidden')return;polling=true;void loadWorkspace().catch(err=>error(String(err))).finally(()=>{polling=false})},1500)
}
void init().catch(err=>{error(String(err));status(t('agency.error'))})
