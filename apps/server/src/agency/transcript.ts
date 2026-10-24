// Pure: one Claude Code stream-json event -> typed facts about the subagents Donna's brain runs. Same rules as dash.py parse_transcript.
export type AgentEvent=
 |{kind:'spawn';toolUseId:string;name?:string;description:string;prompt:string;model?:string;effort?:string}
 |{kind:'ack';toolUseId:string;agentId?:string}
 |{kind:'result';toolUseId:string;report:string}
 |{kind:'task';toolUseId:string;taskId:string}
 |{kind:'done';toolUseId?:string;taskId?:string;ok:boolean;report?:string}
 |{kind:'action';parent:string;tool:string;action:string;file?:string}
 |{kind:'said';parent:string;text:string}
 |{kind:'message';to:string;text:string}
 |{kind:'note';text:string}
 |{kind:'file';file:string};
const ACK='Async agent launched',NOTIF=/<tool-use-id>(\w+)<\/tool-use-id>.*?<status>(\w+)<\/status>/gs,EDITS=['Write','Edit','MultiEdit'];
const flat=(c:any):string=>typeof c==='string'?c:Array.isArray(c)?c.map(b=>typeof b==='string'?b:b?.text??'').join('\n'):'';
const str=(v:unknown)=>typeof v==='string'?v:undefined;
/** The name a subagent works under: the brain's own, else the first two words of its description. */
export const agentName=(description:string,name?:string)=>(name?.trim()||description.trim().split(/\s+/).slice(0,2).join(' ')||'Agent').slice(0,40);
export function agentEvents(e:any):AgentEvent[]{
 const out:AgentEvent[]=[];if(!e||typeof e!=='object')return out;
 const parent=str(e.parent_tool_use_id),msg=e.message?.content,blocks:any[]=Array.isArray(msg)?msg.filter(b=>b&&typeof b==='object'):[];
 if(e.type==='system'){
  if(e.subtype==='task_started'&&str(e.task_id)&&str(e.tool_use_id))out.push({kind:'task',toolUseId:e.tool_use_id,taskId:e.task_id});
  if(e.subtype==='task_notification'&&str(e.task_id))out.push({kind:'done',toolUseId:str(e.tool_use_id),taskId:e.task_id,ok:e.status==='completed',report:str(e.summary)});
  return out;
 }
 if(!parent)for(const s of [str(e.content),str(msg),...blocks.map(b=>b.type==='text'?str(b.text):b.type==='tool_result'?flat(b.content):undefined)])if(s?.includes('<task-notification>'))for(const m of s.matchAll(NOTIF))out.push({kind:'done',toolUseId:m[1],ok:m[2]==='completed'});
 for(const b of blocks){
  if(b.type==='tool_use'){
   const i=b.input||{},file=str(i.file_path)||str(i.path);
   if(parent){
    const action=EDITS.includes(b.name)&&file?`Editing ${file}`:b.name==='Read'&&file?`Reading ${file}`:b.name==='Bash'?`Running ${(str(i.description)||str(i.command)||'a command').slice(0,80)}`:['Glob','Grep'].includes(b.name)?'Searching the project':undefined;
    if(action)out.push({kind:'action',parent,tool:b.name,action,file:EDITS.includes(b.name)||b.name==='Read'?file:undefined});
   }else if(b.name==='Agent'&&str(b.id))out.push({kind:'spawn',toolUseId:b.id,name:str(i.name),description:str(i.description)||'Subagent',prompt:str(i.prompt)||'',model:str(i.model),effort:str(i.effort)});
   else if(b.name==='SendMessage'&&str(i.to))out.push({kind:'message',to:i.to,text:str(i.message)||''});
   else if(EDITS.includes(b.name)&&file)out.push({kind:'file',file});
  }else if(b.type==='text'&&e.type==='assistant'&&str(b.text)?.trim()){
   if(parent)out.push({kind:'said',parent,text:b.text.trim()});else if(!b.text.trim().startsWith('{'))out.push({kind:'note',text:b.text.trim().split('\n')[0].slice(0,200)});
  }else if(b.type==='tool_result'&&!parent&&str(b.tool_use_id)){
   const t=flat(b.content);
   if(t.includes(ACK))out.push({kind:'ack',toolUseId:b.tool_use_id,agentId:/agentId: (\w+)/.exec(t)?.[1]});else out.push({kind:'result',toolUseId:b.tool_use_id,report:t});
  }
 }
 return out;
}
export type TranscriptAgent={id:string;name:string;description:string;model?:string;effort?:string;agentId?:string;done:boolean;ok:boolean};
/** JSONL lines -> the subagents seen and the brain's last words. The launch ack is not completion; a real tool_result or a task notification is. */
export function parseTranscript(lines:string[]){
 const ags=new Map<string,TranscriptAgent>(),tasks=new Map<string,string>();let note='';
 for(const ln of lines){
  let o:unknown;try{o=JSON.parse(ln);}catch{continue;}
  for(const ev of agentEvents(o)){
   if(ev.kind==='spawn')ags.set(ev.toolUseId,{id:ev.toolUseId,name:agentName(ev.description,ev.name),description:ev.description,model:ev.model,effort:ev.effort,done:false,ok:true});
   else if(ev.kind==='ack'){const g=ags.get(ev.toolUseId);if(g&&ev.agentId)g.agentId=ev.agentId;}
   else if(ev.kind==='result'){const g=ags.get(ev.toolUseId);if(g)Object.assign(g,{done:true,ok:true});}
   else if(ev.kind==='task'){if(ags.has(ev.toolUseId))tasks.set(ev.taskId,ev.toolUseId);else{const g=ags.get(tasks.get(ev.taskId)||'');if(g)g.done=false;}}
   else if(ev.kind==='done'){const g=ags.get((ev.taskId&&tasks.get(ev.taskId))||ev.toolUseId||'');if(g)Object.assign(g,{done:true,ok:ev.ok});}
   else if(ev.kind==='note')note=ev.text;
  }
 }
 return {agents:[...ags.values()],note};
}
const dur=(ms:number)=>{const s=Math.max(0,Math.round(ms/1000));return s<60?`${s} s`:`${Math.round(s/60)} min`;};
export type CrewView={name:string;status:string;title:string;action?:string;actionAt?:string;startedAt?:string;completedAt?:string;error?:string};
/** One sentence the voice can read aloud for "how is X doing?". */
export function statusSentence(c:CrewView,now=Date.now()):string{
 const ago=(t?:string)=>t?` ${dur(now-Date.parse(t))} ago`:'';
 if(c.status==='working'){const act=c.action?c.action[0].toLowerCase()+c.action.slice(1):'working';return `${c.name} is ${act}${c.actionAt?` (${dur(now-Date.parse(c.actionAt))} ago)`:''}${c.startedAt?`, on it for ${dur(now-Date.parse(c.startedAt))}`:''}.`;}
 if(['review','done'].includes(c.status))return `${c.name} finished "${c.title}"${ago(c.completedAt)}.`;
 if(c.status==='failed')return `${c.name} failed "${c.title}"${c.error?`: ${c.error.slice(0,200)}`:''}.`;
 if(c.status==='paused')return `${c.name} is paused${c.action?` (${c.action[0].toLowerCase()+c.action.slice(1)})`:''}.`;
 return `${c.name} is ${c.status}.`;
}
