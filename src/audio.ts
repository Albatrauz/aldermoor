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
export const pinSnd=()=>tone(2200,.05,.12,'square');  // the pin comes out
export const fuseTick=(urgent:boolean)=>tone(urgent?1560:980,.05,urgent?.16:.09,'square');
/* A grenade going off: a long noise burst swept down hard, under a low thump —
   heavier and longer than any gun, so it reads as the biggest thing in the fight. */
export function blast(vol){
  const a=ac(); if(!a || vol<.01) return;
  const t=a.currentTime, len=1.1;
  const buf=a.createBuffer(1, Math.floor(a.sampleRate*len), a.sampleRate);
  const ch=buf.getChannelData(0);
  for(let i=0;i<ch.length;i++) ch[i]=(Math.random()*2-1)*Math.pow(1-i/ch.length,3);
  const src=a.createBufferSource(); src.buffer=buf;
  const f=a.createBiquadFilter(); f.type='lowpass';
  f.frequency.setValueAtTime(2600,t);
  f.frequency.exponentialRampToValueAtTime(70,t+len);
  const g=a.createGain();
  g.gain.setValueAtTime(Math.min(1,vol),t);
  g.gain.exponentialRampToValueAtTime(.001,t+len);
  src.connect(f); f.connect(g); g.connect(a.destination);
  src.start(t);
  const o=a.createOscillator(); o.type='sine';
  o.frequency.setValueAtTime(90,t);
  o.frequency.exponentialRampToValueAtTime(32,t+.5);
  const og=a.createGain();
  og.gain.setValueAtTime(Math.min(1,vol*1.2),t);
  og.gain.exponentialRampToValueAtTime(.001,t+.55);
  o.connect(og); og.connect(a.destination);
  o.start(t); o.stop(t+.6);
}
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
/* Masonry coming down: a longer, darker noise burst than the guns, with a slow
   filter sweep so it reads as weight settling rather than as another shot. */
export function rumble(vol, len=.6){
  const a=ac(); if(!a || vol<.01) return;
  const t=a.currentTime;
  const buf=a.createBuffer(1, Math.floor(a.sampleRate*len), a.sampleRate);
  const ch=buf.getChannelData(0);
  let last=0;
  for(let i=0;i<ch.length;i++){
    // brown-ish noise: integrate white noise, with a lumpy envelope for the clatter
    last=(last+(Math.random()*2-1)*.22)*.96;
    const k=i/ch.length;
    ch[i]=last*3*Math.pow(1-k,1.6)*(.65+.35*Math.sin(k*46+Math.sin(k*13)*3));
  }
  const src=a.createBufferSource(); src.buffer=buf;
  const f=a.createBiquadFilter(); f.type='lowpass';
  f.frequency.setValueAtTime(900,t);
  f.frequency.exponentialRampToValueAtTime(90,t+len);
  const g=a.createGain();
  g.gain.setValueAtTime(Math.min(1,vol),t);
  g.gain.exponentialRampToValueAtTime(.001,t+len);
  src.connect(f); f.connect(g); g.connect(a.destination);
  src.start(t);
}
