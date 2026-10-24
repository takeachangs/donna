import {expect,it} from 'vitest';
import {frames,joinPauses,phoneProblems,table,trim,wavPcm} from '../scripts/lib/e2e-audio.mjs';
const chunk=(id,body)=>{const h=Buffer.alloc(8);h.write(id,0,'latin1');h.writeUInt32LE(body.length,4);return Buffer.concat([h,body,Buffer.alloc(body.length&1)])};
const fmt=(ch=1,hz=24000)=>{const b=Buffer.alloc(16);b.writeUInt16LE(1,0);b.writeUInt16LE(ch,2);b.writeUInt32LE(hz,4);b.writeUInt32LE(hz*ch*2,8);b.writeUInt16LE(ch*2,12);b.writeUInt16LE(16,14);return b};
const wav=(f,pcm)=>{const body=Buffer.concat([Buffer.from('WAVE'),chunk('fmt ',f),chunk('FLLR',Buffer.alloc(4044)),chunk('data',pcm)]);const h=Buffer.alloc(8);h.write('RIFF',0,'latin1');h.writeUInt32LE(body.length,4);return Buffer.concat([h,body])};
const pcm16=v=>{const b=Buffer.alloc(v.length*2);v.forEach((x,i)=>b.writeInt16LE(x,i*2));return b};
it('wavPcm skips FLLR and rejects other formats',()=>{
 const s=pcm16([1,-2,3,-4,5]);
 expect(wavPcm(wav(fmt(),s)).equals(s)).toBe(true);
 expect(()=>wavPcm(wav(fmt(1,44100),s))).toThrow();
 expect(()=>wavPcm(wav(fmt(2,24000),s))).toThrow();
});
it('trim strips quiet ends',()=>{
 expect(trim(pcm16([0,10,-500,2000,-900,20,0])).equals(pcm16([-500,2000,-900]))).toBe(true);
 expect(trim(pcm16([0,10,-399,5])).length).toBe(0);
});
it('frames pads the tail to 960 bytes',()=>{
 const f=frames(Buffer.alloc(2500,1));
 expect(f.map(x=>x.length)).toEqual([960,960,960]);
 expect(f[2].subarray(580).every(b=>b===0)).toBe(true);
 expect(f[2][579]).toBe(1);
 expect(f[0].toString('base64').length).toBe(1280);
 expect(frames(Buffer.alloc(0))).toEqual([]);
});
it('joinPauses puts 700 ms of zeros between parts only',()=>{
 const a=Buffer.alloc(100,1),b=Buffer.alloc(60,2),j=joinPauses([a,b]);
 expect(j.length).toBe(160+33600);
 expect(j.subarray(100,100+33600).every(x=>x===0)).toBe(true);
 expect(joinPauses([a]).length).toBe(100);
});
it('phoneProblems flags ids, paths, markdown',()=>{
 expect(phoneProblems('Ellis built the page.')).toEqual([]);
 expect(phoneProblems('task 3f2a9c1d-4b7e is done')).toEqual(['id']);
 expect(phoneProblems('open index.html')).toEqual(['path']);
 expect(phoneProblems('**done**')).toEqual(['markdown']);
});
it('table renders rows',()=>{
 expect(table([{step:'a|b',ok:true,latency:1234,note:'x|y\nz'},{step:'c',ok:false}])).toBe(
  '| Step | Result | Latency | Note |\n|---|---|---|---|\n| a\\|b | PASS | 1.23 s | x\\|y z |\n| c | FAIL | - |  |\n');
});
