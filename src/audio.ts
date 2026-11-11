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
  src.connect(f); f.connect(g); g.connect(out(a));
  src.start(t);
}
function tone(freq,dur,vol,type='triangle'){
  const a=ac(); if(!a) return;
  const t=a.currentTime;
  const o=a.createOscillator(); o.type=type; o.frequency.setValueAtTime(freq,t);
  const g=a.createGain();
  g.gain.setValueAtTime(vol,t);
  g.gain.exponentialRampToValueAtTime(.001,t+dur);
  o.connect(g); g.connect(out(a));
  o.start(t); o.stop(t+dur);
}
export const ding=()=>tone(1318,.14,.15);
export const thudSnd=()=>tone(98,.22,.4,'sine');
export const clack=()=>tone(190,.09,.22,'square'); // ramrod tap on reload
export const pinSnd=()=>tone(2200,.05,.12,'square');  // the pin comes out
export const fuseTick=(urgent:boolean)=>tone(urgent?1560:980,.05,urgent?.16:.09,'square');
/* ---- master bus: everything -> limiter -> trim -> muffle low-pass -> speakers ----
   The limiter only catches what would otherwise clip (several grenades at once); below
   -3 dB it leaves a sound exactly as loud as it was. A DynamicsCompressorNode adds make-up
   gain of its own accord — (1/gain at 0 dB)^0.6 — so the trim after it takes that back out,
   or every tick and ding would come up with it. The muffle filter sits wide open (20 kHz)
   until a close blast slams it shut for a moment.
   A compressor node also swallows the first tenth of a second it ever hears (measured: the
   onset comes through at well under half level until its gain has settled). So none is ever
   made for one sound: the limiter and the blasts' own compressors (GLUE, a small ring of
   them) are built together, once, on the first key or click — before anything has to play. */
let BUS=null, MUF=null, REV=null, WHITE=null, BROWN=null, CRUSH=null, RING=null, GLUE=null, glueN=0;
const LIM_T=-3, LIM_R=20;
function out(a){
  if(BUS && BUS.context===a) return BUS;
  const c=a.createDynamicsCompressor();
  c.threshold.value=LIM_T; c.knee.value=0; c.ratio.value=LIM_R; c.attack.value=.003; c.release.value=.25;
  const trim=a.createGain();
  trim.gain.value=Math.pow(10, (LIM_T-LIM_T/LIM_R)/20*.6);
  MUF=a.createBiquadFilter(); MUF.type='lowpass'; MUF.frequency.value=20000; MUF.Q.value=.5;
  c.connect(trim); trim.connect(MUF); MUF.connect(a.destination);
  GLUE=[0,1,2,3].map(()=>{
    const g=a.createDynamicsCompressor();
    g.threshold.value=-18; g.knee.value=12; g.ratio.value=10; g.attack.value=.003; g.release.value=.25;
    return g;
  });
  return BUS=c;
}
{ const warm=()=>{ const a=ac(); if(a) out(a); removeEventListener('pointerdown',warm); removeEventListener('keydown',warm); };
  addEventListener('pointerdown',warm); addEventListener('keydown',warm); }
const noiseBuf=(a,len,brown)=>{
  const buf=a.createBuffer(1, Math.floor(a.sampleRate*len), a.sampleRate), ch=buf.getChannelData(0);
  let last=0;
  for(let i=0;i<ch.length;i++){
    const w=Math.random()*2-1;
    if(brown){ last=(last+w*.04)/1.02; ch[i]=last*8; } else ch[i]=w; // brown: leaky integrator
  }
  return buf;
};
function shaper(a){ // tanh-like soft clip: adds grit so the crack and the sub survive small speakers
  if(!CRUSH){
    const n=1024; CRUSH=new Float32Array(n);
    for(let i=0;i<n;i++){ const x=i/(n-1)*2-1; CRUSH[i]=Math.tanh(x*4)/Math.tanh(4); }
  }
  // a node per use, sharing the one curve: a shared node would stay wired to every blast's gain for ever
  const w=a.createWaveShaper(); w.curve=CRUSH; w.oversample='2x';
  return w;
}
function reverb(a){ // ~2 s of exponentially decaying, progressively darker noise; built once
  if(REV) return REV;
  const len=2.2, n=Math.floor(a.sampleRate*len), buf=a.createBuffer(2,n,a.sampleRate);
  for(let c=0;c<2;c++){
    const ch=buf.getChannelData(c); let lp=0;
    for(let i=0;i<n;i++){
      const k=i/n, coef=.65-.55*k; // one-pole low-pass that closes over time
      lp+=(Math.random()*2-1-lp)*coef;
      ch[i]=lp*Math.exp(-5.5*k);
    }
  }
  REV=a.createConvolver(); REV.buffer=buf; REV.connect(out(a));
  return REV;
}
/* A grenade going off: a layered, heavy blast. Crack + noise body + sub thump + brown
   rumble tail + rubble patter, with a reverb send; delayed by travel time and darkened
   with distance. Inside ~6 m it also deafens: the whole game goes muffled, with a ring. */
export function blast(vol:number, dist=0){
  const a=ac(); if(!a || vol<.01) return;
  const v=Math.min(1,vol), d=Math.max(0,dist||0);
  const t=a.currentTime+Math.min(.35,d/343);
  if(!WHITE){ WHITE=noiseBuf(a,2,false); BROWN=noiseBuf(a,4,true); }
  const master=out(a);
  // The heavy layers feed `bus` at full level and are squeezed together by a compressor of
  // their own — that, and the make-up gain it adds, is what makes the thump dense rather than
  // merely loud. Loudness for distance (`v`) comes AFTER it: squeezing an already-quiet far
  // blast would only bring it back up. Then darkened by distance, dry to master + wet to reverb.
  const bus=a.createGain(); bus.gain.value=.9;
  const glue=GLUE[glueN++%GLUE.length];   // one each for the last four blasts; a fifth inside 7 s shares
  const lvl=a.createGain(); lvl.gain.value=v*1.5;
  const far=a.createBiquadFilter(); far.type='lowpass';
  far.frequency.value=Math.max(1500,12000*Math.pow(1500/12000,Math.min(1,d/60)));
  bus.connect(glue); glue.connect(lvl); lvl.connect(far); far.connect(master);
  const send=a.createGain(); send.gain.value=.25; far.connect(send); send.connect(reverb(a));
  const srcs=[];
  const noise=(buf)=>{ const s=a.createBufferSource(); s.buffer=buf; srcs.push(s); return [s]; };
  const env=(g,t0,peak,att,dec)=>{
    g.gain.setValueAtTime(0,t0); g.gain.linearRampToValueAtTime(peak,t0+att);
    g.gain.exponentialRampToValueAtTime(.001,t0+att+dec);
  };
  // crack: a very short high-passed, clipped click; gone by ~28 m
  const ck=Math.max(0,1-d/28);
  if(ck>.02){
    const [s]=noise(WHITE); const h=a.createBiquadFilter(); h.type='highpass'; h.frequency.value=1500;
    const g=a.createGain(); env(g,t,ck*.9,.001,.016);
    const w=shaper(a);
    s.connect(h); h.connect(w); w.connect(g); g.connect(bus); s.start(t,Math.random(),.03);
  }
  // body: white noise, low-pass swept 4 kHz -> 150 Hz
  { const [s]=noise(WHITE); const f=a.createBiquadFilter(); f.type='lowpass';
    f.frequency.setValueAtTime(4000,t); f.frequency.exponentialRampToValueAtTime(150,t+.7);
    const g=a.createGain(); env(g,t,1,.002,.85);
    s.connect(f); f.connect(g); g.connect(bus); s.start(t,Math.random(),1); }
  // sub thump: sine 120 -> 35 Hz, plus a clipped triangle for the harmonics laptop speakers can play
  { const o=a.createOscillator(); o.type='sine';
    o.frequency.setValueAtTime(120,t); o.frequency.exponentialRampToValueAtTime(35,t+.25);
    const g=a.createGain(); env(g,t,1,.002,.75);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t+.85);
    const o2=a.createOscillator(); o2.type='triangle';
    o2.frequency.setValueAtTime(120,t); o2.frequency.exponentialRampToValueAtTime(40,t+.25);
    const g2=a.createGain(); env(g2,t,.5,.002,.5);
    const w=shaper(a);
    o2.connect(w); w.connect(g2); g2.connect(bus); o2.start(t); o2.stop(t+.6); }
  // rumble tail: brown noise, low-passed, 3 s slow fade
  { const [s]=noise(BROWN); const f=a.createBiquadFilter(); f.type='lowpass';
    f.frequency.setValueAtTime(200,t); f.frequency.exponentialRampToValueAtTime(80,t+3.2);
    const g=a.createGain(); env(g,t,.55,.04,3.2);
    s.connect(f); f.connect(g); g.connect(bus); s.start(t,Math.random()*.5,3.5); }
  // debris patter: tiny band-passed ticks of rubble landing, only when reasonably close.
  // Past the compressor: by then it has let go, and its make-up gain would turn grit into hail.
  if(d<45){
    const n=Math.floor(15+25*v), t1=t+.4+Math.random()*.4;
    for(let i=0;i<n;i++){
      const ti=t1+Math.pow(Math.random(),1.4)*1.5;
      const [s]=noise(WHITE); const f=a.createBiquadFilter(); f.type='bandpass';
      f.frequency.value=800+Math.random()*2200; f.Q.value=2;
      const g=a.createGain(), dur=.005+Math.random()*.01;
      env(g,ti,.16*(1-.7*(ti-t1)/1.5)*(.5+Math.random()*.5),.001,dur);
      s.connect(f); f.connect(g); g.connect(lvl); s.start(ti,Math.random()*1.5,dur+.01);
    }
  }
  // release the graph once the longest tail (rumble) and the reverb have rung out
  setTimeout(()=>{ for(const s of srcs){ try{s.disconnect();}catch{} }
    try{glue.disconnect(lvl);}catch{}
    for(const n of [bus,lvl,far,send]) n.disconnect(); },(t-a.currentTime+7)*1000);
  // concussion: close blasts muffle all game sound for a few seconds, with a faint ring
  if(d<6){
    const s=1-d/6;
    // from wherever the filter stands now — a second blast mid-recovery only ever shuts it further
    const cur=MUF.frequency.value, lo=Math.min(cur, 500+(1-s)*1500);
    MUF.frequency.cancelScheduledValues(a.currentTime);
    MUF.frequency.setValueAtTime(cur,a.currentTime);
    MUF.frequency.setValueAtTime(cur,t); MUF.frequency.exponentialRampToValueAtTime(lo,t+.03);
    MUF.frequency.setValueAtTime(lo,t+.5);
    MUF.frequency.exponentialRampToValueAtTime(20000,t+2.5+s*.8);
    if(RING){ try{RING.stop();}catch{} }
    const o=a.createOscillator(); o.type='sine'; o.frequency.value=3400+Math.random()*1200;
    const g=a.createGain(); const pk=.03+.03*s, dur=3+2*s;
    g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(pk,t+.15);
    g.gain.exponentialRampToValueAtTime(.001,t+dur);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t+dur+.1);
    o.onended=()=>{ g.disconnect(); if(RING===o) RING=null; };
    RING=o;
  }
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
  src.connect(f); f.connect(g); g.connect(out(a));
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
  src.connect(f); f.connect(g); g.connect(out(a));
  src.start(t);
}
