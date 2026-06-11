/* ============================ canvas textures ============================ */
// Every surface in town is painted procedurally onto a 2D canvas and uploaded
// as a CanvasTexture. `mr` (texture-only randomness) keeps each bake lively.
import * as THREE from 'three';
import { mr } from './core.js';

function makeTex(size, fn){
  const c = document.createElement('canvas'); c.width = c.height = size;
  fn(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function speckle(g, s, n, alpha){
  for(let i=0;i<n;i++){
    g.globalAlpha = Math.random()*alpha;
    g.fillStyle = Math.random()<.5 ? '#000' : '#fff';
    g.fillRect(Math.random()*s, Math.random()*s, 2, 2);
  }
  g.globalAlpha = 1;
}

export const cobbleTex = makeTex(512,(g,s)=>{
  g.fillStyle='#4c4640'; g.fillRect(0,0,s,s);
  const cols=21, rows=27;
  for(let y=0;y<rows;y++)for(let x=0;x<=cols;x++){
    const px=(x+(y%2?0.5:0))*s/cols, py=(y+0.5)*s/rows;
    const v=mr(82,104);
    g.fillStyle=`rgb(${v+8|0},${v|0},${v-6|0})`;
    g.beginPath();
    g.ellipse(px,py, s/cols*mr(.46,.55), s/rows*mr(.44,.54), mr(-.3,.3), 0, 7);
    g.fill();
  }
  speckle(g,s,3200,.09);
});

export const grassTex = makeTex(512,(g,s)=>{
  g.fillStyle='#2e3823'; g.fillRect(0,0,s,s);
  for(let i=0;i<2400;i++){
    const v=mr(0,1);
    g.fillStyle=`rgba(${40+v*30|0},${55+v*34|0},${28+v*20|0},${mr(.15,.5)})`;
    g.fillRect(mr(0,s),mr(0,s),mr(2,5),mr(2,5));
  }
  for(let i=0;i<26;i++){ // mossy patches
    g.fillStyle=`rgba(${mr(28,44)|0},${mr(40,58)|0},${mr(20,32)|0},.30)`;
    g.beginPath(); g.ellipse(mr(0,s),mr(0,s),mr(24,70),mr(18,50),mr(0,3),0,7); g.fill();
  }
});

export const dirtTex = makeTex(256,(g,s)=>{
  g.fillStyle='#564330'; g.fillRect(0,0,s,s);
  speckle(g,s,1600,.14);
  g.strokeStyle='rgba(30,22,14,.35)'; g.lineWidth=7; // wheel ruts
  g.beginPath(); g.moveTo(s*.30,0); g.lineTo(s*.32,s); g.stroke();
  g.beginPath(); g.moveTo(s*.68,0); g.lineTo(s*.66,s); g.stroke();
});

function stoneMaker(base, courseH){
  return makeTex(256,(g,s)=>{
    g.fillStyle='#26211c'; g.fillRect(0,0,s,s);
    const rows = Math.round(s/courseH);
    for(let y=0;y<rows;y++){
      let x = (y%2)*-18;
      while(x < s){
        const w = mr(34,64);
        const v = base + mr(-14,14);
        g.fillStyle = `rgb(${v+6|0},${v|0},${v-6|0})`;
        g.fillRect(x+2, y*courseH+2, Math.min(w, s-x)-3, courseH-4);
        x += w;
      }
    }
    speckle(g,s,1800,.12);
  });
}
export const stoneTex  = stoneMaker(112, 26);
export const stoneTex2 = stoneMaker(96, 34);

export const plankTex = makeTex(256,(g,s)=>{
  g.fillStyle='#4a3424'; g.fillRect(0,0,s,s);
  for(let i=0;i<6;i++){
    const x=i*s/6, v=mr(-12,12);
    g.fillStyle=`rgb(${74+v|0},${52+v|0},${36+v|0})`;
    g.fillRect(x+1,0,s/6-2,s);
    g.strokeStyle='rgba(20,12,6,.6)'; g.lineWidth=2;
    g.beginPath(); g.moveTo(x,0); g.lineTo(x,s); g.stroke();
  }
  for(let i=0;i<70;i++){ // grain
    g.strokeStyle=`rgba(${mr(20,40)|0},${mr(14,28)|0},${mr(8,18)|0},.45)`;
    g.lineWidth=1;
    const x=mr(0,s), y=mr(0,s);
    g.beginPath(); g.moveTo(x,y); g.lineTo(x+mr(-3,3), y+mr(10,46)); g.stroke();
  }
});

function timberTex(plaster, beam, variant){
  return makeTex(256,(g,s)=>{
    g.fillStyle=plaster; g.fillRect(0,0,s,s);
    speckle(g,s,1000,.07);
    g.strokeStyle=beam; g.lineWidth=13; g.lineCap='butt';
    g.strokeRect(6,6,s-12,s-12);                       // sill / eave / corner beams
    const v1=s/3, v2=2*s/3;
    g.beginPath(); g.moveTo(v1,6); g.lineTo(v1,s-6); g.stroke();
    g.beginPath(); g.moveTo(v2,6); g.lineTo(v2,s-6); g.stroke();
    g.lineWidth=10;
    if(variant===0){                                   // X braces in outer cells
      g.beginPath(); g.moveTo(8,8); g.lineTo(v1,s-8); g.stroke();
      g.beginPath(); g.moveTo(v1,8); g.lineTo(8,s-8); g.stroke();
      g.beginPath(); g.moveTo(v2,8); g.lineTo(s-8,s-8); g.stroke();
      g.beginPath(); g.moveTo(s-8,8); g.lineTo(v2,s-8); g.stroke();
    }else if(variant===1){                             // mid rail + diagonals
      g.beginPath(); g.moveTo(6,s/2); g.lineTo(s-6,s/2); g.stroke();
      g.beginPath(); g.moveTo(v1,s/2); g.lineTo(v2,8); g.stroke();
      g.beginPath(); g.moveTo(v1,s/2); g.lineTo(v2,s-8); g.stroke();
    }else{                                             // herringbone-ish
      g.beginPath(); g.moveTo(8,s-8); g.lineTo(v1,s/2); g.stroke();
      g.beginPath(); g.moveTo(v1,s/2); g.lineTo(8,8); g.stroke();
      g.beginPath(); g.moveTo(s-8,s-8); g.lineTo(v2,s/2); g.stroke();
      g.beginPath(); g.moveTo(v2,s/2); g.lineTo(s-8,8); g.stroke();
      g.beginPath(); g.moveTo(6,s/2); g.lineTo(s-6,s/2); g.stroke();
    }
  });
}
export const wallStyles = [
  timberTex('#cfbf9b','#3d2c1d',0),
  timberTex('#d6c4a4','#46321f',1),
  timberTex('#c2ab85','#332417',2),
  timberTex('#cdb592','#3d2c1d',1),
  timberTex('#bba887','#2e2013',0),
];

function tileTex(rgb){
  return makeTex(256,(g,s)=>{
    g.fillStyle=`rgb(${rgb[0]*.55|0},${rgb[1]*.55|0},${rgb[2]*.55|0})`; g.fillRect(0,0,s,s);
    const rows=8, cols=8;
    for(let y=0;y<rows;y++)for(let x=0;x<=cols;x++){
      const px=(x+(y%2?.5:0))*s/cols, py=y*s/rows;
      const f=mr(.78,1.06);
      g.fillStyle=`rgb(${rgb[0]*f|0},${rgb[1]*f|0},${rgb[2]*f|0})`;
      g.beginPath(); g.arc(px,py+s/rows, s/cols*.52, Math.PI, 2*Math.PI); g.fill();
    }
    speckle(g,s,900,.08);
  });
}
export const thatchTex = makeTex(256,(g,s)=>{
  g.fillStyle='#6a5631'; g.fillRect(0,0,s,s);
  for(let i=0;i<1700;i++){
    const v=mr(0,1);
    g.strokeStyle=`rgba(${88+v*52|0},${70+v*42|0},${36+v*24|0},${mr(.2,.6)})`;
    g.lineWidth=1.4;
    const x=mr(0,s), y=mr(0,s);
    g.beginPath(); g.moveTo(x,y); g.lineTo(x+mr(-2,2), y+mr(8,22)); g.stroke();
  }
  g.strokeStyle='rgba(40,30,12,.4)'; g.lineWidth=3;
  for(let y=0;y<s;y+=32){ g.beginPath(); g.moveTo(0,y); g.lineTo(s,y); g.stroke(); }
});
export const roofTexes = [tileTex([158,74,52]), tileTex([96,100,116]), thatchTex, tileTex([140,86,60])];

export function stripeTex(c){
  return makeTex(128,(g,s)=>{
    g.fillStyle='#e3d6ba'; g.fillRect(0,0,s,s);
    g.fillStyle=c;
    for(let x=0;x<s;x+=32) g.fillRect(x,0,16,s);
    speckle(g,s,400,.09);
  });
}
export const glowTex = makeTex(128,(g,s)=>{
  const r=g.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);
  r.addColorStop(0,'rgba(255,255,255,1)');
  r.addColorStop(.35,'rgba(255,255,255,.5)');
  r.addColorStop(1,'rgba(255,255,255,0)');
  g.fillStyle=r; g.fillRect(0,0,s,s);
});
export const flameTex = makeTex(128,(g,s)=>{
  const r=g.createRadialGradient(s/2,s*.62,0,s/2,s*.62,s*.5);
  r.addColorStop(0,'rgba(255,244,200,1)');
  r.addColorStop(.3,'rgba(255,180,70,.9)');
  r.addColorStop(.65,'rgba(255,100,20,.4)');
  r.addColorStop(1,'rgba(255,60,0,0)');
  g.fillStyle=r; g.fillRect(0,0,s,s);
});
export const smokeTex = makeTex(128,(g,s)=>{
  const r=g.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);
  r.addColorStop(0,'rgba(190,185,180,.85)');
  r.addColorStop(.6,'rgba(170,165,160,.30)');
  r.addColorStop(1,'rgba(160,155,150,0)');
  g.fillStyle=r; g.fillRect(0,0,s,s);
});
export const moonTex = makeTex(128,(g,s)=>{
  const r=g.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);
  r.addColorStop(0,'#f2ecd9'); r.addColorStop(.82,'#ece4cc');
  r.addColorStop(.9,'rgba(236,228,204,.4)'); r.addColorStop(1,'rgba(236,228,204,0)');
  g.fillStyle=r; g.fillRect(0,0,s,s);
  g.fillStyle='rgba(170,160,140,.35)';
  g.beginPath(); g.arc(s*.38,s*.42,9,0,7); g.fill();
  g.beginPath(); g.arc(s*.58,s*.6,6,0,7); g.fill();
  g.beginPath(); g.arc(s*.5,s*.3,5,0,7); g.fill();
});
export const archWinTex = makeTex(128,(g,s)=>{
  g.clearRect(0,0,s,s);
  const grd=g.createLinearGradient(0,0,0,s);
  grd.addColorStop(0,'#ffd98c'); grd.addColorStop(1,'#c75e1e');
  g.fillStyle=grd;
  g.beginPath();                                  // pointed gothic arch
  g.moveTo(s*.18,s); g.lineTo(s*.18,s*.42);
  g.quadraticCurveTo(s*.18,s*.12, s*.5,s*.06);
  g.quadraticCurveTo(s*.82,s*.12, s*.82,s*.42);
  g.lineTo(s*.82,s); g.closePath(); g.fill();
  g.strokeStyle='rgba(40,20,8,.85)'; g.lineWidth=5;
  g.beginPath(); g.moveTo(s*.5,s*.06); g.lineTo(s*.5,s); g.stroke();
  g.beginPath(); g.moveTo(s*.18,s*.55); g.lineTo(s*.82,s*.55); g.stroke();
});
export const roseTex = makeTex(128,(g,s)=>{
  g.clearRect(0,0,s,s);
  const r=g.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2*.96);
  r.addColorStop(0,'#ffd98c'); r.addColorStop(.65,'#d97e2c'); r.addColorStop(1,'#8e4014');
  g.fillStyle=r; g.beginPath(); g.arc(s/2,s/2,s/2*.96,0,7); g.fill();
  g.strokeStyle='rgba(38,18,8,.9)'; g.lineWidth=5;
  for(let i=0;i<6;i++){
    g.beginPath(); g.moveTo(s/2,s/2);
    g.lineTo(s/2+Math.cos(i*Math.PI/3)*s/2, s/2+Math.sin(i*Math.PI/3)*s/2);
    g.stroke();
  }
  g.beginPath(); g.arc(s/2,s/2,s*.17,0,7); g.stroke();
  g.beginPath(); g.arc(s/2,s/2,s/2*.9,0,7); g.stroke();
});
export const parchTex = makeTex(128,(g,s)=>{
  g.fillStyle='#d9c89a'; g.fillRect(0,0,s,s);
  speckle(g,s,500,.08);
  g.strokeStyle='rgba(60,40,20,.7)'; g.lineWidth=3;
  for(let y=28;y<s-12;y+=16){ g.beginPath(); g.moveTo(16,y); g.lineTo(s-mr(14,46),y); g.stroke(); }
});
export function signTex(text){
  return makeTex(256,(g,s)=>{
    g.fillStyle='#3a2818'; g.fillRect(0,0,s,s);
    for(let i=0;i<5;i++){ g.strokeStyle='rgba(20,12,6,.5)'; g.lineWidth=2;
      g.beginPath(); g.moveTo(0,i*s/5+10); g.lineTo(s,i*s/5+10); g.stroke(); }
    g.strokeStyle='#caa64e'; g.lineWidth=5; g.strokeRect(10,10,s-20,s-20);
    g.fillStyle='#caa64e'; g.textAlign='center';
    g.font='italic 600 36px Georgia, serif';
    const words=text.split(' ');
    g.fillText(words[0], s/2, s*.42);
    g.fillText(words.slice(1).join(' '), s/2, s*.66);
    g.font='34px Georgia, serif';
    g.fillText('🍺', s/2, s*.9);
  });
}

/* clone a texture with its own repeat — used by materials and the town builder */
export function clonedTex(t, rx, ry){ const c=t.clone(); c.needsUpdate=true; c.repeat.set(rx,ry); return c; }
