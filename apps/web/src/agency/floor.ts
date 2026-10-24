export type Point={x:number;z:number};
export type Footprint={x:number;z:number;width:number;depth:number;side:'left'|'right'|'secretary'};
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
