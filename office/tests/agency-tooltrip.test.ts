import {describe,expect,it} from 'vitest';
import {errand,nextCall,pace,projectRoom,secretaryPosition,turnBack,type Desk,type Point,type ToolCall} from '../apps/web/src/agency/floor';

const rooms=[{id:'p0',...projectRoom(0)},{id:'p1',...projectRoom(1)}];
const len=(p:Point[])=>p.reduce((s,q,i)=>i?s+Math.hypot(q.x-p[i-1].x,q.z-p[i-1].z):0,0);
const dk=(id:string,projectId:string,x:number,z:number,free=true):Desk=>({id,projectId,home:{x,z},free});
const call=(name:string,o:Partial<ToolCall>={}):ToolCall=>({callId:'c',name,...o});
// p0: x -14..-4, z 0..10, door z 5, edge -5. p1: x 4..14, edge 5.
const desks=[dk('far',  'p0',-12,1),dk('near','p0',-6,4),dk('busy','p0',-5.5,5,false),dk('r1','p1',12,2),dk('r2','p1',6,6)];

describe('errand doorway',()=>{
  it('ends outside the wall of a left and a right room; meeter ends inside',()=>{
    const l=errand(call('read_workspace',{projectId:'p0'}),rooms,desks,false)!,r=errand(call('read_workspace',{projectId:'p1'}),rooms,desks,false)!;
    expect(l.points.at(-1)).toEqual({x:-3,z:5});expect(l.face).toEqual({x:-5,z:5});expect(l.meet!.points.at(-1)).toEqual({x:-5,z:5});
    expect(r.points.at(-1)).toEqual({x:3,z:5});expect(r.face).toEqual({x:5,z:5});expect(r.meet!.points.at(-1)).toEqual({x:5,z:5});
    expect(l.points[0]).toEqual({x:-.3,z:17.65});expect(l.meet!.face).toEqual({x:-3,z:5});
    expect(l.meet!.points[0].x).toBe(-5);expect(l.meet!.points[0].z).toBe(l.meet!.id==='near'?4:1);
  });
  it('picks the named free worker over a nearer one',()=>{
    expect(errand(call('read_workspace',{projectId:'p0',workerId:'far'}),rooms,desks,false)!.meet!.id).toBe('far');
  });
  it('else the nearest free one, skipping non-free ones',()=>{
    expect(errand(call('read_workspace',{projectId:'p0'}),rooms,desks,false)!.meet!.id).toBe('near');
    expect(errand(call('read_workspace',{projectId:'p0',workerId:'busy'}),rooms,desks,false)!.meet!.id).toBe('near');
    expect(errand(call('read_workspace',{projectId:'p1'}),rooms,desks,false)!.meet!.id).toBe('r2');
  });
  it('no free worker, no meet',()=>{
    const e=errand(call('read_workspace',{projectId:'p0'}),rooms,[dk('busy','p0',-6,5,false)],false)!;
    expect(e.meet).toBeUndefined();expect(e.points.at(-1)).toEqual({x:-3,z:5});
  });
  it('both arrive together',()=>{
    for(const projectId of ['p0','p1']){
      const e=errand(call('read_workspace',{projectId}),rooms,desks,false)!,m=e.meet!,h=desks.find(d=>d.id===m.id)!.home;
      expect(len([secretaryPosition,...e.points])/pace).toBeCloseTo(m.wait+len([h,...m.points])/pace,6);
    }
  });
  it('resolves the room from the worker',()=>{
    expect(errand(call('read_workspace',{workerId:'r1'}),rooms,desks,false)!.room).toBe('p1');
  });
  it('unknown room is undefined',()=>{
    expect(errand(call('read_workspace',{projectId:'nope'}),rooms,desks,false)).toBeUndefined();
    expect(errand(call('read_workspace'),rooms,desks,false)).toBeUndefined();
    expect(errand(call('read_workspace',{workerId:'ghost'}),rooms,desks,false)).toBeUndefined();
  });
  it('reduce glows without walking',()=>{
    expect(errand(call('read_workspace',{projectId:'p0'}),rooms,desks,true)).toEqual({room:'p0',points:[],glow:true});
  });
  it('read_workspace has no note key',()=>{
    expect('note' in errand(call('read_workspace',{projectId:'p0'}),rooms,desks,false)!).toBe(false);
  });
});

describe('errand message_worker',()=>{
  it('ends in front of the desk; the free worker just stands up',()=>{
    const e=errand(call('message_worker',{workerId:'near'}),rooms,desks,false)!;
    expect(e.points.at(-1)).toEqual({x:-6,z:4.9});expect(e.face).toEqual({x:-6,z:4});
    expect(e.meet).toEqual({id:'near',points:[],wait:len([secretaryPosition,...e.points])/pace,face:{x:-6,z:4.9}});
    expect(e.points.at(-3)).toEqual({x:-5,z:5});
  });
  it('a non-free worker still gets the walk, no meet',()=>{
    const e=errand(call('message_worker',{workerId:'busy'}),rooms,desks,false)!;
    expect(e.points.at(-1)).toEqual({x:-5.5,z:5.9});expect(e.meet).toBeUndefined();
  });
});

describe('errand notes',()=>{
  it('delegate_work into an empty room goes to the empty desk',()=>{
    const e=errand(call('delegate_work',{projectId:'p0'}),rooms,[],false)!,room=rooms[0];
    expect(e.points.at(-1)).toEqual({x:room.x+room.width/2,z:room.z+3+1.65+.9});expect(e.face).toEqual({x:room.x+room.width/2,z:room.z+4.65});
    expect(e.meet).toBeUndefined();expect(e.note).toBe(true);
  });
  it('create_project into an empty room too',()=>{
    expect(errand(call('create_project',{projectId:'p1'}),rooms,desks.slice(0,3),false)!.note).toBe(true);
  });
  it('into a staffed room: doorway, meet, note',()=>{
    const e=errand(call('delegate_work',{projectId:'p0'}),rooms,desks,false)!;
    expect(e.points.at(-1)).toEqual({x:-3,z:5});expect(e.meet!.id).toBe('near');expect(e.note).toBe(true);
  });
  it('reduce wins over note',()=>{
    expect(errand(call('delegate_work',{projectId:'p0'}),rooms,[],true)).toEqual({room:'p0',points:[],glow:true});
  });
});

describe('turnBack',()=>{
  const pts=[{x:1,z:1},{x:2,z:2},{x:3,z:3}],home={x:0,z:0};
  it('retraces from mid-route',()=>{expect(turnBack(pts,2,home)).toEqual([pts[1],pts[0],home]);});
  it('index 0 is just home',()=>{expect(turnBack(pts,0,home)).toEqual([home]);});
  it('index points.length retraces everything',()=>{expect(turnBack(pts,3,home)).toEqual([pts[2],pts[1],pts[0],home]);});
  it('does not mutate',()=>{const c=[...pts];turnBack(pts,2,home);expect(pts).toEqual(c);});
});

describe('nextCall',()=>{
  const q=['a','b','c','d'].map(callId=>({callId,name:'x'}));
  it('drops finished head and middle',()=>{
    const [n,rest]=nextCall(q,new Set(['a','c']));
    expect(n!.callId).toBe('b');expect(rest.map(c=>c.callId)).toEqual(['d']);
  });
  it('empty queue',()=>{expect(nextCall([],new Set())).toEqual([undefined,[]]);expect(nextCall(q,new Set(['a','b','c','d']))).toEqual([undefined,[]]);});
  it('does not mutate',()=>{nextCall(q,new Set(['a']));expect(q).toHaveLength(4);});
});
