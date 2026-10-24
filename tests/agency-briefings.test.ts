import {expect,it} from 'vitest';
import {reconcileBriefings,completedBriefing,type Briefing} from '../apps/server/src/agency/briefings';
import type {Assignment,Worker} from '../apps/server/src/agency/workspace';
import {projectRoom,secretaryRoom,deliveryRoute} from '../apps/web/src/agency/floor';
const delivery=(id:string,dependsOn:string[]=[]):Assignment=>({id,projectId:'project',workerId:id,title:id,brief:'Do work',acceptance:'Real file',status:'review',revision:1,runId:`run-${id}`,cwd:'fixture',dependsOn,summary:`Delivered ${id}`,completedAt:'2026-10-24T03:00:00Z',artifacts:[{path:`${id}.txt`,url:`/${id}`,size:10,snapshotAt:'2026-10-24T03:00:00Z'}],verification:['Verified real file']});
const workers:Worker[]=[];
it('keeps interrupted, incomplete, failed and unrelated speech in the presentation queue',()=>{
 const p={briefingId:'report',job:{id:'speech',cancelled:false,failed:false},audioComplete:false};
 expect(completedBriefing(p,'speech')).toBeUndefined();
 p.audioComplete=true;expect(completedBriefing(p,'old-speech')).toBeUndefined();
 p.job.cancelled=true;expect(completedBriefing(p,'speech')).toBeUndefined();
 p.job.cancelled=false;p.job.failed=true;expect(completedBriefing(p,'speech')).toBeUndefined();
 p.job.failed=false;expect(completedBriefing(p,'speech')).toBe('report');
 expect(completedBriefing(undefined,'speech')).toBeUndefined();
});
it('queues only final workflow results and carries earlier deliverables into the handoff',()=>{
 const queue:Briefing[]=[],first=delivery('build'),last=delivery('review',['build']);last.status='queued';
 expect(reconcileBriefings(queue,[first,last],workers)).toBe(false);expect(queue).toHaveLength(0);
 last.status='review';expect(reconcileBriefings(queue,[first,last],workers)).toBe(true);
 expect(queue).toHaveLength(1);expect(queue[0].assignmentId).toBe('review');expect(queue[0].artifacts.map(f=>f.path)).toEqual(['build.txt','review.txt']);
 expect(reconcileBriefings(queue,[first,last],workers)).toBe(false);
 last.summary='Later change';expect(queue[0].summary).toBe('Delivered review');
});
it('preserves presentation state across reload, supersedes outdated deliveries and queues new versions',()=>{
 let queue:Briefing[]=[];const a=delivery('one');reconcileBriefings(queue,[a],workers);
 queue[0].status='presented';queue=JSON.parse(JSON.stringify(queue));expect(reconcileBriefings(queue,[a],workers)).toBe(false);
 a.runId='second';a.revision++;reconcileBriefings(queue,[a],workers);expect(queue.map(b=>b.status)).toEqual(['presented','queued']);
 a.status='queued';a.revision++;reconcileBriefings(queue,[a],workers);expect(queue[1].status).toBe('superseded');
});
it('does not turn failures or blocked partial outputs into finished briefings',()=>{
 const queue:Briefing[]=[];for(const status of ['failed','waiting','working','paused'] as const){const a=delivery(status);a.status=status;reconcileBriefings(queue,[a],workers)}expect(queue).toEqual([]);
});
it('withdraws a stale final report when upstream work changes until the final step is rerun',()=>{
 const queue:Briefing[]=[],a=delivery('build'),b=delivery('review',['build']);reconcileBriefings(queue,[a,b],workers);
 a.revision++;a.status='queued';reconcileBriefings(queue,[a,b],workers);expect(queue[0].status).toBe('superseded');
 a.status='review';a.completedAt='2026-10-24T03:01:00Z';reconcileBriefings(queue,[a,b],workers);expect(queue).toHaveLength(1);
 b.revision++;b.completedAt='2026-10-24T03:02:00Z';reconcileBriefings(queue,[a,b],workers);expect(queue).toHaveLength(2);expect(queue[1].status).toBe('queued');
});
it('grows project rooms outward without overlaps or moving existing doorways',()=>{
 const rooms=Array.from({length:20},(_,i)=>projectRoom(i,i%3===0?12:2));
 for(let i=0;i<rooms.length;i++)for(const b of [...rooms.slice(i+1),secretaryRoom]){const a=rooms[i];expect(a.x+a.width<=b.x||b.x+b.width<=a.x||a.z+a.depth<=b.z||b.z+b.depth<=a.z).toBe(true)}
 expect(projectRoom(0,12).x+projectRoom(0,12).width).toBe(-4);expect(projectRoom(1,12).x).toBe(4);
});
it('routes both wings through their door and common corridor into Donna’s room',()=>{
 for(const index of [0,1,2,7]){const room=projectRoom(index),home={x:room.x+4,z:room.z+3.75},route=deliveryRoute(room,home);expect(route[1].z).toBe(room.z+5);expect(route[2]).toEqual({x:0,z:room.z+5});expect(route.at(-1)).toEqual({x:1.5,z:17.5});}
});
