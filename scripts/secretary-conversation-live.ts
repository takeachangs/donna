import 'dotenv/config';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {HiggsColleague} from '../apps/server/src/agency/higgs.js';
import {secretaryInstructions,secretaryTools} from '../apps/server/src/agency/secretary.js';

// Paid Higgs regression, read-only against a captured workspace. No native worker
// or mutation is simulated as successful. Speech and every response are retained.
const label=process.argv[2]||'regression';
if(!/^[a-z0-9-]+$/.test(label))throw Error('Use a simple run label');
const root=resolve('artifacts/agency/donna-debug',`${label}-${new Date().toISOString().replace(/[:.]/g,'-')}`);
mkdirSync(root,{recursive:true});
const workspace=JSON.parse(readFileSync(resolve('artifacts/agency/workspace.json'),'utf8'));
const project=workspace.projects.find((p:any)=>/90.second.*pitch/i.test(p.goal));
if(!project)throw Error('Expected the existing pitch project');
const context={selected_project_id:project.id,view:'secretary',workspace};
const cases=[
 {name:'direct-answer',text:'What is the 20th digit after the decimal point in pi?'},
 {name:'answer-followup',text:'Just give me the digit, please.'},
 {name:'contextual-draft',text:'Now write a short opening for the pitch in this project. Put it here in the conversation.'},
 {name:'clarified-followup',text:'For our personal agency, not hardware. Make the opening more direct; write it here.'},
];
const events:any[]=[],turns:any[]=[];
let done=false;
const voice=new HiggsColleague('mara',()=>project.id,root,e=>{
 events.push({...e,audio:e.audio?'[retained WAV]':undefined});
 if(e.type==='turn_done')done=true;
},(name,args)=>{
 if(name==='read_workspace')return {committed:false,...context,project:workspace.projects.find((p:any)=>p.id===(args.project_id||project.id))};
 throw Error('This read-only diagnostic cannot change projects or execute work. Answer in the conversation.');
},()=>{},()=>{},{instructions:()=>secretaryInstructions,context:()=>context,tools:secretaryTools,voice:'eleanor'});
try{
 await voice.connect();
 for(const test of cases){
  done=false;const from=events.length,started=performance.now();
  await voice.ask(test.text);
  while(!done){
   if(performance.now()-started>60000)throw Error('Turn timed out');
   const error=events.slice(from).find(e=>e.type==='error');if(error)throw Error(error.message);
   await new Promise(r=>setTimeout(r,50));
  }
  const rows=events.slice(from).filter(e=>e.type==='usage').map(e=>e.row);
  const turn={...test,elapsedMs:performance.now()-started,rows};turns.push(turn);
  console.log(JSON.stringify({name:test.name,transcripts:rows.map(r=>r.transcript),tools:rows.flatMap(r=>r.tools||[]).map(t=>t.name),firstAudioMs:rows.find(r=>r.firstAudioMs)?.firstAudioMs}));
 }
}finally{
 voice.close();const rows=events.filter(e=>e.type==='usage').map(e=>e.row);
 const report={label,at:new Date().toISOString(),scope:'Real Higgs; read-only captured project context; no Codex execution. These are regression prompts, not a replay of unlogged user input.',turns,events,usage:{responses:rows.length,estimatedUSD:rows.reduce((s,r)=>s+(r.estimatedUSD||0),0),missing:rows.filter(r=>r.usageMissing).length,actualCreditDebit:'UNVERIFIED'}};
 writeFileSync(resolve(root,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({root,usage:report.usage}));
}
