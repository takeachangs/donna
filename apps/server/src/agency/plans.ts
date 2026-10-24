import {z} from 'zod';

const text=z.string().trim().min(1);
export const workPlanSchema=z.object({checkpoint:text.max(1000),rationale:text.max(1500),workers:z.array(z.object({key:text.regex(/^[a-zA-Z0-9_-]{1,50}$/),title:text.max(180).optional(),role:text.max(100),responsibility:text.max(1500),brief:text.max(6000),acceptance:text.max(2000),reasoning_effort:z.enum(['low','medium']).default('low'),depends_on:z.array(text).max(8).default([]),reuse_worker_id:z.string().trim().nullish(),provider:z.enum(['codex','claude']).optional()})).min(1).max(4)});
// Donna's brain (a lead Claude Code session) writes plans; the voice only passes goals.
export const brainPlanSchema=workPlanSchema.extend({title:text.max(120)});
export const brainReviewSchema=z.object({summary:text.max(12000),verification:z.array(z.string().max(3000)).max(20).default([]),needsInput:z.string().max(3000).optional()});
export const goalSchema=text.max(2000);
// A model-created room must explicitly choose work or an empty room.
export const createProjectSchema=z.object({name:z.string().trim().max(80).optional().describe('Short room name. Leave it out unless the user named the room; the office names it from the brief.'),brief:z.string().max(2000).default(''),initial_work:goalSchema.nullable().describe('The work to start now, in the user\'s words with every constraint they gave. Donna\'s brain plans the team. Use null only for an explicitly empty room.')});
// ponytail: heuristic first clause of the brief; the model's own name wins when it gives one. A smarter title would need a model call.
const placeholderName=/^(?:(?:new|untitled|my)\s+)?(?:project|room)(?:\s*#?\s*\d+)?$|^untitled$/i,fillerLead=/^(?:please|hey|ok|okay|so|can you|could you|would you|i want (?:you )?to|i'd like (?:you )?to|i need (?:you )?to|let's|go ahead and|make|build|create|write|design|draft|set up|start|do|me|us|a|an|the|new|project|room|for)\s+/i,stopTail=/\s+(?:with|where|that|which|and|or|to|of|for|in|on|by|using|a|an|the)$/i;
export function roomName(given:string|undefined,brief:string):string{
 const g=(given??'').trim();if(g&&!placeholderName.test(g))return g;
 let s=(brief.split(/[.!?;:,\n]/)[0]??'').trim();
 while(fillerLead.test(s))s=s.replace(fillerLead,'');
 if(s.length>40){s=s.slice(0,41);s=s.includes(' ')?s.slice(0,s.lastIndexOf(' ')):s.slice(0,40);}
 s=s.trim();while(stopTail.test(s))s=s.replace(stopTail,'');
 return s?s[0].toUpperCase()+s.slice(1):'New project';
}
/** Claude sometimes prefixes prose or a ```json fence; take the first parseable object. */
export function lastJson(text:string):unknown{
 const end=text.lastIndexOf('}')+1;
 for(let i=text.indexOf('{');i>=0&&i<end;i=text.indexOf('{',i+1))try{return JSON.parse(text.slice(i,end));}catch{/* try the next brace */}
 throw Error('Donna\'s brain returned no JSON object');
}
export function parsePlan(text:string){const plan=brainPlanSchema.parse(lastJson(text));validateDependencies(plan.workers);return plan;}
export function validateDependencies(workers:z.infer<typeof workPlanSchema>['workers']){
 const keys=new Set(workers.map(w=>w.key));if(keys.size!==workers.length)throw Error('Assignment keys must be unique');
 for(const w of workers)for(const d of w.depends_on)if(!keys.has(d)||d===w.key)throw Error('Dependencies must refer to other keys in this plan');
 const visited=new Set<string>(),active=new Set<string>();
 const visit=(key:string)=>{if(active.has(key))throw Error('Cyclic dependency');if(visited.has(key))return;active.add(key);for(const d of workers.find(w=>w.key===key)!.depends_on)visit(d);active.delete(key);visited.add(key)};
 for(const key of keys)visit(key);
}
