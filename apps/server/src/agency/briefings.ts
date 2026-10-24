import {randomUUID} from 'node:crypto';
import type {Assignment,Artifact,Worker} from './workspace.js';

export type Briefing={id:string;assignmentId:string;projectId:string;workerId:string;deliveryKey:string;title:string;summary:string;artifacts:Artifact[];verification:string[];createdAt:string;status:'queued'|'presented'|'superseded';presentedAt?:string;contributors:{name:string;title:string;summary:string}[]};
export type Presentation={briefingId:string;job:{id:string;cancelled:boolean;failed?:boolean};audioComplete:boolean};
/** Only the browser's completion for this successful, uncancelled speech counts. */
export function completedBriefing(p:Presentation|undefined,jobId:string){return p&&p.job.id===jobId&&p.audioComplete&&!p.job.cancelled&&!p.job.failed?p.briefingId:undefined;}
const key=(a:Assignment)=>`${a.id}:${a.runId||a.completedAt||'legacy'}:${a.revision}`;

/** Persist terminal deliveries, independent of browser animation or connectivity. */
export function reconcileBriefings(queue:Briefing[],assignments:Assignment[],workers:Worker[]){
 let changed=false;
 const chainFor=(a:Assignment)=>{const chain:Assignment[]=[],seen=new Set<string>();const visit=(a:Assignment)=>{if(seen.has(a.id))return;seen.add(a.id);for(const id of a.dependsOn){const d=assignments.find(d=>d.id===id);if(d)visit(d);}chain.push(a);};visit(a);return chain;};
 const currentKey=(a:Assignment)=>chainFor(a).map(key).join('|');
 const current=(a:Assignment)=>chainFor(a).every(d=>['review','done'].includes(d.status)&&!!d.completedAt&&d.completedAt<=a.completedAt!);
 for(const b of queue){
  const a=assignments.find(a=>a.id===b.assignmentId);
  if(b.status==='queued'&&(!a||currentKey(a)!==b.deliveryKey||!current(a))){b.status='superseded';changed=true;}
 }
 for(const a of assignments){
  if(a.status!=='review'||!a.artifacts.length||!a.completedAt||!current(a)||assignments.some(d=>d.dependsOn.includes(a.id))||queue.some(b=>b.deliveryKey===currentKey(a)))continue;
  const chain=chainFor(a);
  queue.push({id:randomUUID(),assignmentId:a.id,projectId:a.projectId,workerId:a.workerId,deliveryKey:currentKey(a),title:a.title,summary:a.summary||'',artifacts:structuredClone(chain.flatMap(d=>d.artifacts)),verification:[...(a.verification||[])],createdAt:a.completedAt,status:'queued',contributors:chain.map(d=>({name:workers.find(w=>w.id===d.workerId)?.name||'Worker',title:d.title,summary:d.summary||''}))});changed=true;
 }
 return changed;
}

/** Natural timing for an unsolicited announcement (Python Donna herd.md §8, donna#24). */
export const hold={quietMs:2500,recentUserMs:3000,questionMs:6000,maxMs:10000};
export type Floor={now:number;heldSince:number;voiceBusy:boolean;userSpeaking:boolean;playing:boolean;userAt:number;voiceAt:number;question:boolean};
/** Why an announcement must wait, or undefined when Donna may speak now. */
export function holdReason(f:Floor):string|undefined{
 if(f.voiceBusy)return 'Donna is mid-turn';
 if(f.userSpeaking)return 'user is speaking';
 if(f.now-f.heldSince>=hold.maxMs)return undefined;
 if(f.playing)return 'Donna audio still playing';
 if(f.question&&f.now-f.voiceAt<hold.questionMs)return 'Donna asked a question';
 if(f.now-f.userAt<hold.recentUserMs)return 'user spoke recently';
 if(f.now-Math.max(f.userAt,f.voiceAt)<hold.quietMs)return 'waiting for quiet';
}
/** True when the last sentence is a task-bearing question the user still owes an answer to. */
export function openQuestion(said:string){const s=said.trim().split(/(?<=[.!?])\s+/).pop()||'';return s.endsWith('?')&&!/how can i help|anything else|what(?:'s| is) next|what else/i.test(s)&&/\b(which|should|do you want|would you like|prefer|or)\b/i.test(s);}
