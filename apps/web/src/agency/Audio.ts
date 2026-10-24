export class OfficeAudio {
 context=new AudioContext({sampleRate:24000})
 private sources=new Set<AudioBufferSourceNode>()
 private next=0
 private playing?:string
 private stream?:MediaStream
 private input?:AudioWorkletNode
 private inputSource?:MediaStreamAudioSourceNode
 private mute?:GainNode
 private micLoaded=false
 private finishedJobs=new Set<string>()
 private jobEnds=new Map<string,number>()
 private cancelled=new Set<string>()
 private timer=0
 constructor(private send:(e:any)=>void,private audible:(e:any,delay:number)=>void){this.timer=window.setInterval(()=>this.flush(),60)}
 async resume(){await this.context.resume()}
 play(e:any){
  if(this.cancelled.has(e.jobId))return
  const raw=atob(e.audio);if(raw.length<2||raw.length%2)return;const view=new DataView(new ArrayBuffer(raw.length));for(let i=0;i<raw.length;i++)view.setUint8(i,raw.charCodeAt(i))
  const b=this.context.createBuffer(1,raw.length/2,24000),f=b.getChannelData(0);for(let i=0;i<f.length;i++)f[i]=view.getInt16(i*2,true)/32768
  const s=this.context.createBufferSource();s.buffer=b;s.connect(this.context.destination)
  const at=Math.max(this.context.currentTime+.06,this.next);this.next=at+b.duration
  if(this.playing!==e.itemId){this.playing=e.itemId;this.audible(e,(at-this.context.currentTime)*1000)}
  s.start(at);this.sources.add(s);this.jobEnds.set(e.jobId,this.next);s.onended=()=>{this.sources.delete(s);this.flush()}
 }
 done(jobId:string){this.finishedJobs.add(jobId);this.flush()}
 private flush(){for(const id of this.finishedJobs){if(this.context.currentTime<(this.jobEnds.get(id)||0)+.03)continue;this.finishedJobs.delete(id);this.jobEnds.delete(id);this.send({type:'played',jobId:id})}}
 /** Flush local playback only; the server's VAD cancels the response itself (a client response.cancel/truncate wedges Higgs sessions). */
 stop(){
  for(const id of this.jobEnds.keys())this.cancelled.add(id)
  for(const s of this.sources)try{s.stop()}catch{}
  this.sources.clear();this.finishedJobs.clear();this.jobEnds.clear();this.playing=undefined;this.next=this.context.currentTime
 }
 async mic(on:boolean){
  if(!on){this.stream?.getTracks().forEach(t=>t.stop());this.input?.disconnect();this.inputSource?.disconnect();this.mute?.disconnect();this.stream=undefined;return}
  this.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false})
  if(!this.micLoaded){await this.context.audioWorklet.addModule('/agency-mic.js');this.micLoaded=true}
  this.inputSource=this.context.createMediaStreamSource(this.stream);this.input=new AudioWorkletNode(this.context,'agency-mic');this.mute=this.context.createGain();this.mute.gain.value=0
  this.inputSource.connect(this.input).connect(this.mute).connect(this.context.destination)
  this.input.port.onmessage=e=>{if(e.data instanceof ArrayBuffer){const b=new Uint8Array(e.data);let raw='';for(const value of b)raw+=String.fromCharCode(value);this.send({type:'audio',audio:btoa(raw)})}}
 }
 async close(){clearInterval(this.timer);this.stop();await this.mic(false);await this.context.close()}
}

export function chime(){try{if(navigator.userActivation&&!navigator.userActivation.hasBeenActive)return;const c=new AudioContext(),t0=c.currentTime;for(const [f,at] of [[880,0],[1175,.18]]){const o=c.createOscillator(),g=c.createGain();o.frequency.value=f;g.gain.setValueAtTime(0,t0+at);g.gain.linearRampToValueAtTime(.12,t0+at+.02);g.gain.exponentialRampToValueAtTime(.001,t0+at+.3);o.connect(g).connect(c.destination);o.start(t0+at);o.stop(t0+at+.3)}setTimeout(()=>void c.close().catch(()=>{}),700)}catch{}}
