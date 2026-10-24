import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
export const RATE=24000,FRAME_BYTES=960;
/** WAV file -> PCM16LE bytes; walks RIFF chunks (afconvert adds FLLR). */
export function wavPcm(buf){
 let fmt,data;
 for(let o=12;o+8<=buf.length;){
  const id=buf.toString('latin1',o,o+4),size=buf.readUInt32LE(o+4),body=o+8;
  if(id==='fmt ')fmt=buf.subarray(body,body+size);
  else if(id==='data'){data=buf.subarray(body,Math.min(body+size,buf.length));break}
  o=body+size+(size&1);
 }
 if(!fmt||!data)throw Error('wav: missing fmt or data chunk');
 const f=fmt.readUInt16LE(0),ch=fmt.readUInt16LE(2),hz=fmt.readUInt32LE(4),bits=fmt.readUInt16LE(14);
 if(f!==1||ch!==1||hz!==RATE||bits!==16)throw Error(`wav: need PCM mono ${RATE} Hz 16-bit, got format ${f}, ${ch} ch, ${hz} Hz, ${bits}-bit`);
 return data;
}
/** Strip quiet samples (|v| < threshold) from both ends. */
export function trim(pcm,threshold=400){
 const n=pcm.length>>1,loud=i=>Math.abs(pcm.readInt16LE(i*2))>=threshold;
 let a=0,b=n;
 while(a<n&&!loud(a))a++;
 while(b>a&&!loud(b-1))b--;
 return pcm.subarray(a*2,b*2);
}
/** Split into 20 ms frames; the last is zero-padded. */
export function frames(pcm){
 const out=[];
 for(let o=0;o<pcm.length;o+=FRAME_BYTES){
  const f=Buffer.alloc(FRAME_BYTES);pcm.copy(f,0,o,Math.min(o+FRAME_BYTES,pcm.length));out.push(f);
 }
 return out;
}
export const silenceMs=ms=>Buffer.alloc(Math.round(ms*RATE/1000)*2);
export function joinPauses(parts,pauseMs=700){
 return Buffer.concat(parts.flatMap((p,i)=>i?[silenceMs(pauseMs),p]:[p]));
}
export const seconds=pcm=>pcm.length/(RATE*2);
/** macOS `say` -> 24 kHz PCM16 mono, cached by voice+text. */
export function tts(text,{voice='Samantha',dir=join(tmpdir(),'chamber-e2e-tts')}={}){
 mkdirSync(dir,{recursive:true});
 const base=join(dir,createHash('sha1').update(voice+'\n'+text).digest('hex')),wav=base+'.wav',aiff=base+'.aiff';
 if(!existsSync(wav)){
  execFileSync('say',['-v',voice,'-o',aiff,text]);
  execFileSync('afconvert',['-f','WAVE','-d','LEI16@24000','-c','1',aiff,wav]);
  rmSync(aiff,{force:true});
 }
 return trim(wavPcm(readFileSync(wav)));
}
export const speech=text=>typeof text==='string'?tts(text):joinPauses(text.map(t=>tts(t)),700);
/** What a spoken caption must not contain. */
export function phoneProblems(text){
 const p=[];
 if(/[0-9a-f]{8}-[0-9a-f]{4}/i.test(text))p.push('id');
 if(/\b[\w-]+\.(?:html|css|js|ts|md|json)\b/i.test(text)||/(?:^|\s)(?:\.{0,2}\/|~\/)[\w.-]/.test(text))p.push('path');
 if(/[*#`]|^\s*[-•]\s/m.test(text))p.push('markdown');
 return p;
}
/** Result rows -> markdown table. */
export function table(rows){
 const esc=s=>String(s??'').replace(/\|/g,'\\|').replace(/\r?\n/g,' ');
 const lat=l=>l===undefined?'-':typeof l==='number'?`${(l/1000).toFixed(2)} s`:l;
 return '| Step | Result | Latency | Note |\n|---|---|---|---|\n'+rows.map(r=>`| ${esc(r.step)} | ${r.ok?'PASS':'FAIL'} | ${lat(r.latency)} | ${esc(r.note)} |`).join('\n')+'\n';
}
