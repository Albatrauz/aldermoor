/* ============================ black-powder sounds, synthesized ============================ */
// A tiny WebAudio kit: a filtered-noise "boom" for the handgonne plus a couple of
// oscillator blips. The AudioContext is created lazily on the first user gesture.
let AC=null;
export function ac(){
  if(!AC){ try{ AC=new (window.AudioContext||window.webkitAudioContext)(); }catch{ return null; } }
  if(AC && AC.state==='suspended') AC.resume();
  return AC;
}
export function boom(vol){
  const a=ac(); if(!a) return;
  const t=a.currentTime, len=.28;
  const buf=a.createBuffer(1, Math.floor(a.sampleRate*len), a.sampleRate);
  const ch=buf.getChannelData(0);
  for(let i=0;i<ch.length;i++) ch[i]=(Math.random()*2-1)*Math.pow(1-i/ch.length,2.4);
  const src=a.createBufferSource(); src.buffer=buf;
  const f=a.createBiquadFilter(); f.type='lowpass';
  f.frequency.setValueAtTime(1000,t);
  f.frequency.exponentialRampToValueAtTime(110,t+len);
  const g=a.createGain();
  g.gain.setValueAtTime(Math.min(1,vol),t);
  g.gain.exponentialRampToValueAtTime(.001,t+len);
  src.connect(f); f.connect(g); g.connect(a.destination);
  src.start(t);
}
function tone(freq,dur,vol,type='triangle'){
  const a=ac(); if(!a) return;
  const t=a.currentTime;
  const o=a.createOscillator(); o.type=type; o.frequency.setValueAtTime(freq,t);
  const g=a.createGain();
  g.gain.setValueAtTime(vol,t);
  g.gain.exponentialRampToValueAtTime(.001,t+dur);
  o.connect(g); g.connect(a.destination);
  o.start(t); o.stop(t+dur);
}
export const ding=()=>tone(1318,.14,.15);
export const thudSnd=()=>tone(98,.22,.4,'sine');
export const clack=()=>tone(190,.09,.22,'square'); // ramrod tap on reload
export function crack(vol){
  const a=ac(); if(!a) return;
  const t=a.currentTime, len=.14;
  const buf=a.createBuffer(1, Math.floor(a.sampleRate*len), a.sampleRate);
  const ch=buf.getChannelData(0);
  for(let i=0;i<ch.length;i++) ch[i]=(Math.random()*2-1)*Math.pow(1-i/ch.length,3.2);
  const src=a.createBufferSource(); src.buffer=buf;
  const f=a.createBiquadFilter(); f.type='lowpass';
  f.frequency.setValueAtTime(2400,t);
  f.frequency.exponentialRampToValueAtTime(220,t+len);
  const g=a.createGain();
  g.gain.setValueAtTime(Math.min(1,vol),t);
  g.gain.exponentialRampToValueAtTime(.001,t+len);
  src.connect(f); f.connect(g); g.connect(a.destination);
  src.start(t);
}
