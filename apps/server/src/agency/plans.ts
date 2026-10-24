import {z} from 'zod';

const text=z.string().trim().min(1);
export const workPlanSchema=z.object({goal:text.max(2000).optional(),checkpoint:text.max(1000),rationale:text.max(1500),workers:z.array(z.object({key:text.regex(/^[a-zA-Z0-9_-]{1,50}$/),title:text.max(180).optional(),role:text.max(100),responsibility:text.max(1500),brief:text.max(6000),acceptance:text.max(2000),reasoning_effort:z.enum(['low','medium']).default('low'),depends_on:z.array(text).max(8).default([]),reuse_worker_id:z.string().trim().nullish().describe('Existing worker ID to resume, or null for a new worker.')})).min(1).max(4)});
// A model-created room must explicitly choose execution or an empty room.
export const createProjectSchema=z.object({name:text.max(80),brief:z.string().max(2000),initial_work:workPlanSchema.nullable().describe('Include the full initial staffing plan when the user asks to build or execute work. Use null only when the user requests an empty room or planning without execution.')});
export function validateDependencies(workers:z.infer<typeof workPlanSchema>['workers']){
 const keys=new Set(workers.map(w=>w.key));if(keys.size!==workers.length)throw Error('Assignment keys must be unique');
 for(const w of workers)for(const d of w.depends_on)if(!keys.has(d)||d===w.key)throw Error('Dependencies must refer to other keys in this plan');
 const visited=new Set<string>(),active=new Set<string>();
 const visit=(key:string)=>{if(active.has(key))throw Error('Cyclic dependency');if(visited.has(key))return;active.add(key);for(const d of workers.find(w=>w.key===key)!.depends_on)visit(d);active.delete(key);visited.add(key)};
 for(const key of keys)visit(key);
}
