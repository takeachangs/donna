import {LocalCodex} from './codex.js';
import {LocalClaudeCode} from './claude.js';
import type {Provider} from './workspace.js';

/** Codex or Claude Code runs the workers (whichever is signed in); a sandboxed, skill-driven Claude Code lead session (subagents, project-only writes) is Donna's brain. */
export class AgencyExecutors {
 readonly codex=new LocalCodex();
 readonly claude=new LocalClaudeCode();
 readonly brain=new LocalClaudeCode({model:process.env.AGENCY_BRAIN_MODEL?.trim()||'opus',brain:true});
 private chosen?:Promise<Provider>;
 /** Resolved once per process. */
 defaultProvider():Promise<Provider>{return this.chosen??=(async()=>{
  const pin=process.env.AGENCY_DEFAULT_PROVIDER?.trim(),pick=(p:Provider,why:string)=>{console.log(`[engine] default worker engine: ${p} (${why})`);return p;};
  if(pin==='codex'||pin==='claude')return pick(pin,'AGENCY_DEFAULT_PROVIDER');
  const c=await this.codex.status().then(s=>s.available&&s.authenticated!==false&&s.modelAvailable!==false,()=>false);
  if(c)return pick('codex','AGENCY_DEFAULT_PROVIDER unset; Codex signed in');
  const k=await this.claude.status().then(s=>s.authenticated,()=>false);
  return k?pick('claude','AGENCY_DEFAULT_PROVIDER unset; Codex not signed in or unavailable; Claude Code signed in'):pick('codex','AGENCY_DEFAULT_PROVIDER unset; neither engine signed in');
 })();}
 async status(){const [defaultProvider,codex,claude,brain]=await Promise.all([this.defaultProvider(),this.codex.status(),this.claude.status(),this.brain.status()]);return {defaultProvider,codex,claude,brain};}
 close(){this.codex.close();this.claude.close();this.brain.close();}
}
