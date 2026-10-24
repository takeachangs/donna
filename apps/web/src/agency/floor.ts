export type Point={x:number;z:number};
export type Footprint={x:number;z:number;width:number;depth:number;side:'left'|'right'|'secretary'|'lounge'};
export const secretaryRoom:Footprint={x:-4,z:12,width:8,depth:9,side:'secretary'};
export const secretaryPosition:Point={x:-1.6,z:17.65};
export function projectRoom(index:number,workers=0):Footprint{
 const row=Math.floor(index/2),left=index%2===0;
 // Expand outwards for more desks; the shared corridor and existing doors stay put.
 const width=Math.max(10,Math.ceil(workers/2)*2.8+2);
 return {x:left?-4-width:4,z:-row*12,width,depth:10,side:left?'left':'right'};
}
export function deliveryRoute(room:Footprint,home:Point):Point[]{
 const edge=room.side==='left'?room.x+room.width-1:room.x+1;
 return [{x:edge,z:home.z},{x:edge,z:room.z+5},{x:0,z:room.z+5},{x:0,z:11},{x:0,z:13},{x:1.5,z:13},{x:1.5,z:17.5}];
}
/** East of Donna's suite, same z band; its door (north wall, x 4.1–6.5) faces the end of the hall. Constant, so project rooms never move. */
export const lounge:Footprint={x:4,z:12,width:8,depth:9,side:'lounge'};
export type LoungeSpot=Point&{face:Point;pose:'sit'|'sip'|'idle'};
// Fill order: couch, coffee machine, couch, water cooler, couch, standing by the TV. World coordinates.
export const loungeSpots:LoungeSpot[]=[
 {x:8.45,z:16.15,face:{x:8.45,z:12},pose:'sit'},
 {x:10.75,z:18.4,face:{x:11.6,z:18.3},pose:'sip'},
 {x:10.15,z:16.15,face:{x:10.15,z:12},pose:'sit'},
 {x:10.7,z:20.2,face:{x:11.45,z:20.2},pose:'sip'},
 {x:9.3,z:16.15,face:{x:9.3,z:12},pose:'sit'},
 {x:11.2,z:14.2,face:{x:9.3,z:12.2},pose:'idle'},
];
/** Hall end → lounge door → just in front of the spot → the spot. */
export function loungeLeg(s:Point):Point[]{return [{x:5.3,z:11},{x:5.3,z:13},{x:s.x,z:s.z-1},s];}
/** Desk to a lounge spot; the walk back is this reversed minus the spot, plus home. */
export function loungeRoute(room:Footprint,home:Point,s:Point):Point[]{return [...deliveryRoute(room,home).slice(0,4),...loungeLeg(s)];}
/** From where a delivering worker stands at Donna's desk (last point of deliveryRoute, {x:1.5,z:17.5}) to a lounge spot. */
export function afterReport(s:Point):Point[]{return [{x:1.5,z:13},{x:0,z:13},{x:0,z:11},...loungeLeg(s)];}
type Who={id:string;projectId:string;status:string;lead?:boolean};type Work={projectId:string;status:string};
/** On a break: not a lead, own work delivered (status 'review' or 'done'), and no assignment in the same project is still open ('queued'|'working'|'waiting'). Project-wide on purpose: the team rests once the lead's review is done, so the reporter walks desk → Donna → lounge. */
export function resting(w:Who,assignments:Work[]):boolean{return !w.lead&&(w.status==='review'||w.status==='done')&&!assignments.some(a=>a.projectId===w.projectId&&(a.status==='queued'||a.status==='working'||a.status==='waiting'));}
/** Next lounge seating (worker id → index into loungeSpots). Entries for ids NOT in `workers` are kept untouched (they are walking or about to report). Listed workers that are no longer resting lose their entry. Listed resting workers without an entry take the lowest free index; if all 6 are taken they get none (they stay at their desk). Returns a new Map; never mutates `current`. */
export function seat(workers:Who[],assignments:Work[],current:Map<string,number>):Map<string,number>{
 const out=new Map(current);
 for(const w of workers){
  if(!resting(w,assignments)){out.delete(w.id);continue;}
  if(out.has(w.id))continue;
  // ponytail: a 7th resting worker gets no seat and stays at the desk; add standing spots if teams get bigger.
  const taken=new Set(out.values()),i=loungeSpots.findIndex((_,k)=>!taken.has(k));
  if(i>=0)out.set(w.id,i);
 }
 return out;
}
