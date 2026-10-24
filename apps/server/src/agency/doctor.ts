import 'dotenv/config';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AgencyExecutors} from './executors.js';
import type {Provider} from './workspace.js';

export const dataDir=()=>resolve(process.env.AGENCY_DATA_DIR||'artifacts/agency');
export const version=(()=>{const v=JSON.parse(readFileSync(new URL('../../../../package.json',import.meta.url),'utf8')).version;try{return `${v}+${execFileSync('git',['rev-parse','--short','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()}`;}catch{return v;}})();
export type Problem={fatal:boolean;message:string};
type Engine={ready:boolean;error?:string};
const engine=(ready:boolean,error?:string):Engine=>error&&!ready?{ready,error}:{ready};

/** Boot checks, shared by `npm start` and `npm run doctor`. Only fatal problems stop the server. */
export async function doctor(executors:AgencyExecutors,dir=dataDir()){
 const problems:Problem[]=[],s=await executors.status(),codex=engine(s.codex.available&&s.codex.authenticated!==false&&s.codex.modelAvailable!==false,s.codex.error),claude=engine(s.claude.authenticated,s.claude.error),brain=engine(s.brain.authenticated,s.brain.error);
 const [major,minor]=process.versions.node.split('.').map(Number);
 if(major<22||(major===22&&minor<12))problems.push({fatal:true,message:`Node ${process.versions.node} is too old; Chamber needs Node 22.12 or newer.`});
 try{mkdirSync(dir,{recursive:true});const probe=join(dir,'.doctor-probe');writeFileSync(probe,'ok');rmSync(probe);}catch(err){problems.push({fatal:true,message:`Cannot write to the data folder ${dir}: ${(err as Error).message}`});}
 if(!process.env.BOSON_API_KEY?.trim())problems.push({fatal:false,message:"BOSON_API_KEY is not set, so Donna's voice is off; add it to .env to talk to her. The board still works."});
 const def:Provider=s.defaultProvider,e={codex,claude}[def];
 if(!e.ready)problems.push({fatal:false,message:`The default worker engine (${def}) is not ready${e.error?`: ${e.error}`:'; sign in to it'}.`});
 if(!brain.ready)problems.push({fatal:false,message:`Donna's brain (Claude Code) is not ready${brain.error?`: ${brain.error}`:'; sign in to Claude Code'}.`});
 return {problems,engines:{default:def,codex,claude,brain}};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const executors=new AgencyExecutors(),dir=dataDir(),{problems,engines}=await doctor(executors,dir),fatal=problems.some(p=>p.fatal);
 for(const p of problems)console.log(`${p.fatal?'FATAL':'warn'}: ${p.message}`);
 const r=(n:string,e:Engine)=>`${n} ${e.ready?'ready':'not ready'}`;
 console.log(`Chamber doctor ${version}: node v${process.versions.node}, default engine ${engines.default}, ${r('codex',engines.codex)}, ${r('claude',engines.claude)}, ${r('brain',engines.brain)}, data dir ${dir} — ${problems.length} problem(s)`);
 executors.close();process.exit(fatal?1:0);
}
