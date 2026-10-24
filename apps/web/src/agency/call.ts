export type Mic='live'|'muted'|'blocked'
/** A call is a call: while connected the stage offers Hang up, Hold on and Mute; typing is a collapsed fallback and board actions wait until after the call. Returns i18n keys. */
export function callControls(s:{socket:boolean;ringing:boolean;mic:Mic}){return {connect:s.socket?'agency.hang_up':s.ringing?'agency.answer_call':'agency.connect',mic:s.mic==='live'?'agency.mute':s.mic==='muted'?'agency.unmute':'agency.mic_on',idle:s.mic==='blocked'?'agency.mic_blocked':'agency.ready',onCall:s.socket,typeOpen:s.mic==='blocked'}}
