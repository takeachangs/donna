class AgencyMic extends AudioWorkletProcessor {
 constructor(){super();this.pcm=new Int16Array(960);this.offset=0;}
 process(inputs){const mono=inputs[0]?.[0];if(mono)for(const v of mono){const s=Math.max(-1,Math.min(1,v));this.pcm[this.offset++]=Math.round(s*(s<0?32768:32767));if(this.offset===this.pcm.length){const b=this.pcm.slice().buffer;this.port.postMessage(b,[b]);this.offset=0;}}return true;}
}
registerProcessor('agency-mic',AgencyMic);
