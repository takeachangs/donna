import {describe,expect,it} from 'vitest';
import {afterReport,deliveryRoute,lounge,loungeRoute,loungeSpots,projectRoom,resting,seat,secretaryRoom,type Footprint} from '../apps/web/src/agency/floor';

const w=(id:string,status='review',projectId='p1',lead=false)=>({id,projectId,status,lead});
const a=(status:string,projectId='p1')=>({projectId,status});
const hit=(p:Footprint,q:Footprint)=>p.x<q.x+q.width&&q.x<p.x+p.width&&p.z<q.z+q.depth&&q.z<p.z+p.depth;

describe('resting',()=>{
  it('review/done worker with no open work rests',()=>{
    expect(resting(w('a','review'),[a('done')])).toBe(true);
    expect(resting(w('a','done'),[])).toBe(true);
  });
  it('any open assignment in the same project blocks it, other projects do not',()=>{
    for(const s of ['queued','working','waiting'])expect(resting(w('a'),[a(s)])).toBe(false);
    expect(resting(w('a'),[a('working','p2')])).toBe(true);
  });
  it('leads and unfinished workers never rest',()=>{
    expect(resting(w('a','review','p1',true),[])).toBe(false);
    for(const s of ['failed','paused','queued','working'])expect(resting(w('a',s),[])).toBe(false);
  });
});

describe('seat',()=>{
  it('gives 0 and 1 to new resters, keeps them across calls',()=>{
    const ws=[w('a'),w('b')],m=seat(ws,[],new Map());
    expect([m.get('a'),m.get('b')]).toEqual([0,1]);
    expect(seat([...ws,w('c')],[],m).get('a')).toBe(0);
    expect(seat(ws,[],m).get('b')).toBe(1);
  });
  it('drops the seat when new work arrives and reuses the freed lowest index',()=>{
    const m=seat([w('a'),w('b'),w('c','review','p2')],[],new Map());
    const m2=seat([w('a'),w('b'),w('c','review','p2')],[a('queued')],m);
    expect(m2.has('a')||m2.has('b')).toBe(false);
    expect(m2.get('c')).toBe(2);
    const m3=seat([w('a'),w('d','review','p3')],[a('queued','p2')],new Map([['a',0],['b',1]]));
    expect(m3.get('d')).toBe(2);
    const m4=seat([w('a','working'),w('d')],[],new Map([['a',0],['b',1]]));
    expect(m4.has('a')).toBe(false);expect(m4.get('d')).toBe(0);
  });
  it('keeps entries for ids not listed',()=>{
    expect(seat([w('a')],[],new Map([['x',0]])).get('x')).toBe(0);
    expect(seat([w('a')],[],new Map([['x',0]])).get('a')).toBe(1);
  });
  it('seats at most 6; the 7th stays at the desk',()=>{
    const m=seat(['a','b','c','d','e','f','g'].map(i=>w(i)),[],new Map());
    expect(m.size).toBe(6);expect(m.has('g')).toBe(false);
  });
  it('does not mutate the input',()=>{
    const cur=new Map([['x',3]]);seat([w('a')],[],cur);
    expect([...cur]).toEqual([['x',3]]);
  });
});

describe('lounge geometry',()=>{
  it('has 4-6 spots strictly inside the footprint',()=>{
    expect(loungeSpots.length).toBeGreaterThanOrEqual(4);expect(loungeSpots.length).toBeLessThanOrEqual(6);
    for(const s of loungeSpots){
      expect(s.x).toBeGreaterThan(lounge.x);expect(s.x).toBeLessThan(lounge.x+lounge.width);
      expect(s.z).toBeGreaterThan(lounge.z);expect(s.z).toBeLessThan(lounge.z+lounge.depth);
    }
  });
  it('does not overlap Donna or any project room',()=>{
    expect(hit(lounge,secretaryRoom)).toBe(false);
    for(let n=0;n<=8;n++)for(let i=0;i<10;i++)expect(hit(lounge,projectRoom(i,n))).toBe(false);
  });
  it('routes end at the spot',()=>{
    const room=projectRoom(1,4),home={x:room.x+2,z:room.z+3},s=loungeSpots[0];
    const r=loungeRoute(room,home,s);
    expect(r[0]).toEqual(deliveryRoute(room,home)[0]);expect(r.at(-1)).toEqual(s);
    expect(afterReport(s).at(-1)).toEqual(s);
  });
});
