import {t} from '../i18n'
import type {Project} from './types'

/** Project lifecycle stays separate from voice, queue presentation and scene navigation. */
export function projectActions(options:{projects:()=>Project[];request:(url:string,body:unknown)=>Promise<unknown>;refresh:()=>Promise<void>;notice:(message:string)=>void}){
 const host=document.createElement('div');host.innerHTML=`
 <dialog id="manage-project-dialog" aria-labelledby="manage-project-title">
  <header><div><p class="board-context">${t('agency.project_room')}</p><h2 id="manage-project-title">${t('agency.project_settings')}</h2></div><button type="button" id="manage-project-close" aria-label="${t('agency.close')}">×</button></header>
  <form id="rename-project-form"><label for="rename-project-name">${t('agency.project_name')}</label><input id="rename-project-name" required maxlength="80"><p class="agency-note">${t('agency.rename_note')}</p><div class="project-dialog-actions"><button type="button" id="rename-project-cancel">${t('agency.cancel')}</button><button type="submit">${t('agency.save_name')}</button></div></form>
  <details id="delete-project-confirm" class="project-delete"><summary>${t('agency.delete_project')}</summary><p id="delete-project-description"></p><p class="agency-note">${t('agency.delete_note')}</p><button type="button" id="delete-project" class="danger-button">${t('agency.move_to_trash')}</button></details>
  <p id="manage-project-error" class="form-error" role="alert" hidden></p>
 </dialog>
 <dialog id="deleted-projects-dialog" aria-labelledby="deleted-projects-title"><header><h2 id="deleted-projects-title">${t('agency.recently_deleted')}</h2><button id="deleted-projects-close" aria-label="${t('agency.close')}">×</button></header><p class="agency-note">${t('agency.restore_note')}</p><div id="deleted-projects-list"></div><p id="deleted-projects-error" class="form-error" role="alert" hidden></p></dialog>`
 document.body.append(host)
 const el=<T extends HTMLElement=HTMLElement>(id:string)=>host.querySelector<T>(`#${id}`)!
 const dialog=el<HTMLDialogElement>('manage-project-dialog'),trash=el<HTMLDialogElement>('deleted-projects-dialog')
 let selected='',busy=false,trashSignature=''
 const error=(id:string,message='')=>{el(id).textContent=message;el(id).hidden=!message}
 const lock=(value:boolean)=>{busy=value;for(const b of host.querySelectorAll<HTMLButtonElement>('button'))b.disabled=value}
 async function change(action:'rename'|'delete',value:unknown){
  if(busy)return;lock(true);error('manage-project-error')
  try{await options.request(`/agency-api/projects/${selected}/${action}`,value);await options.refresh();dialog.close();options.notice(t(action==='rename'?'agency.project_renamed':'agency.project_deleted'))}
  catch(err){error('manage-project-error',String(err))}finally{lock(false)}
 }
 el('manage-project-close').onclick=el('rename-project-cancel').onclick=()=>dialog.close()
 el('deleted-projects-close').onclick=()=>trash.close()
 for(const d of [dialog,trash])d.addEventListener('cancel',e=>{if(busy)e.preventDefault()})
 el('rename-project-form').onsubmit=e=>{e.preventDefault();void change('rename',{name:el<HTMLInputElement>('rename-project-name').value})}
 el('delete-project').onclick=()=>void change('delete',{})
 function renderTrash(){
  const deleted=options.projects().filter(p=>p.deletedAt).sort((a,b)=>b.deletedAt!.localeCompare(a.deletedAt!)),signature=JSON.stringify(deleted)
  if(signature===trashSignature)return;trashSignature=signature
  const list=el('deleted-projects-list');list.replaceChildren()
  if(!deleted.length){const p=document.createElement('p');p.className='empty';p.textContent=t('agency.trash_empty');list.append(p)}
  for(const project of deleted){
   const row=document.createElement('div');row.className='deleted-project-row';const text=document.createElement('div'),name=document.createElement('strong'),date=document.createElement('span'),restore=document.createElement('button')
   name.textContent=project.name;date.textContent=t('agency.deleted_date',{date:new Intl.DateTimeFormat('en',{dateStyle:'medium'}).format(new Date(project.deletedAt!))});text.append(name,date);restore.textContent=t('agency.restore_project');restore.setAttribute('aria-label',t('agency.restore_named',{name:project.name}));row.append(text,restore);list.append(row)
   restore.onclick=()=>void(async()=>{if(busy)return;lock(true);error('deleted-projects-error');try{await options.request(`/agency-api/projects/${project.id}/restore`,{});await options.refresh();renderTrash();options.notice(t('agency.project_restored'))}catch(err){error('deleted-projects-error',String(err))}finally{lock(false);el('deleted-projects-close').focus()}})()
  }
 }
 return {
  open(id:string){const project=options.projects().find(p=>p.id===id&&!p.deletedAt);if(!project)return;selected=id;el<HTMLInputElement>('rename-project-name').value=project.name;el('delete-project-description').textContent=t('agency.delete_question',{name:project.name});el<HTMLDetailsElement>('delete-project-confirm').open=false;error('manage-project-error');dialog.showModal();el<HTMLInputElement>('rename-project-name').select()},
  trash(){error('deleted-projects-error');renderTrash();trash.showModal()},
  renderTrash,
 }
}
