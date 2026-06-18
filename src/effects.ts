/* ============================ transient effects & ray tests ============================ */
// Short-lived visuals (tracers, muzzle flashes, powder smoke) plus the ray-cast
// helpers used by the handgonne to decide what a shot hits.
import * as THREE from 'three';
import { scene } from './core';
import { flameTex, smokeTex } from './textures';

/* --- transient effects: tracers, muzzle flashes, powder smoke --- */
const fx=[];
function fxAdd(obj, ttl, kind){ scene.add(obj); fx.push({obj, ttl, t0:ttl, kind}); }
export function spawnTracer(a,b){
  const line=new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([a,b]),
    new THREE.LineBasicMaterial({color:0xffd9a0, transparent:true, opacity:.85,
      blending:THREE.AdditiveBlending, depthWrite:false}));
  fxAdd(line,.13,'fade');
}
/* Borderlands-style floating damage number: a chunky figure that punches in over
   the struck traveller, arcs up and out, then fades — so onlookers (and the
   shooter) read how hard each ball landed. Headshots read bigger and gold.
   Textures are cached by (amount, head): a firefight reuses a handful of values,
   so we bake each once and share it (never disposed — the fx cleanup leaves the
   shared map alone, like the muzzle-flash sprites). */
const dmgTexCache=new Map();
function dmgTex(amount, head){
  const key=amount+'|'+(head?1:0);
  const hit=dmgTexCache.get(key);
  if(hit) return hit;
  const c=document.createElement('canvas'); c.width=256; c.height=128;
  const g=c.getContext('2d');
  const txt=String(amount);
  g.font='900 '+(head?92:72)+'px Georgia, "Arial Black", sans-serif';
  g.textAlign='center'; g.textBaseline='middle';
  g.lineJoin='round'; g.miterLimit=2;
  g.lineWidth=head?13:11;
  g.strokeStyle='rgba(18,7,2,.95)';            // heavy dark outline so it reads on any backdrop
  g.strokeText(txt,128,66);
  const grad=g.createLinearGradient(0,22,0,108);
  if(head){ grad.addColorStop(0,'#fff3b0'); grad.addColorStop(1,'#ff8a1e'); }  // crit gold→orange
  else    { grad.addColorStop(0,'#ffffff'); grad.addColorStop(1,'#ffcf8c'); }  // warm white
  g.fillStyle=grad;
  g.fillText(txt,128,66);
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace;
  dmgTexCache.set(key, t);
  return t;
}
export function spawnDamageNumber(pos, amount, head=false){
  const s=new THREE.Sprite(new THREE.SpriteMaterial({map:dmgTex(Math.round(amount), head),
    transparent:true, depthWrite:false}));   // depth-tested: walls between us and the struck foe hide it
  s.renderOrder=12;
  s.position.copy(pos);
  const base=head?.95:.72;
  s.scale.set(base*2, base, 1);                                // canvas is 2:1
  // launch each number on its own arc so a burst of hits fans out instead of stacking
  const ang=Math.random()*Math.PI*2;
  scene.add(s);
  fx.push({obj:s, ttl:1.1, t0:1.1, kind:'dmg', base,
    vx:Math.cos(ang)*.55, vz:Math.sin(ang)*.55, vy:1.7});
}
export function spawnFlash(pos, big=1){
  const s=new THREE.Sprite(new THREE.SpriteMaterial({map:flameTex, transparent:true,
    blending:THREE.AdditiveBlending, depthWrite:false}));
  s.position.copy(pos); s.scale.setScalar(.55*big);
  fxAdd(s,.07,'fade');
  const l=new THREE.PointLight(0xffb050, 26, 9, 2);
  l.position.copy(pos);
  fxAdd(l,.07,'light');
  const p=new THREE.Sprite(new THREE.SpriteMaterial({map:smokeTex, transparent:true,
    opacity:.32, depthWrite:false}));
  p.position.copy(pos); p.scale.setScalar(.3);
  fxAdd(p,.7,'puff');
}
export function updateFx(dt){
  for(let i=fx.length-1;i>=0;i--){
    const f=fx[i]; f.ttl-=dt;
    const k=Math.max(f.ttl,0)/f.t0;
    if(f.kind==='light') f.obj.intensity=26*k;
    else if(f.kind==='puff'){
      f.obj.material.opacity=.32*k;
      f.obj.position.y+=dt*.8;
      f.obj.scale.addScalar(dt*1.5);
    }
    else if(f.kind==='dmg'){
      const age=f.t0-f.ttl;
      f.obj.position.x+=f.vx*dt;
      f.obj.position.z+=f.vz*dt;
      f.obj.position.y+=f.vy*dt;
      f.vy-=dt*2.6;                                   // a gentle arc: pops up, settles back
      const punch=1+Math.max(0,.1-age)*4.5;          // brief overshoot in the first 100ms
      const sc=f.base*punch;
      f.obj.scale.set(sc*2, sc, 1);
      f.obj.material.opacity = k<.3 ? k/.3 : 1;       // hold full, fade over the last 30%
    }
    else f.obj.material.opacity=.85*k;
    if(f.ttl<=0){
      scene.remove(f.obj);
      f.obj.material?.dispose?.();
      f.obj.geometry?.dispose?.();
      fx.splice(i,1);
    }
  }
}

/* --- ray tests: slab AABB for the town, vertical capsule for travellers --- */
export function rayAABB(o,d,c){
  let tmin=0, tmax=Infinity;
  const lo=[c.x-c.hx, c.base??0, c.z-c.hz], hi=[c.x+c.hx, c.h??c.top??5, c.z+c.hz];
  const oo=[o.x,o.y,o.z], dd=[d.x,d.y,d.z];
  for(let i=0;i<3;i++){
    if(Math.abs(dd[i])<1e-9){ if(oo[i]<lo[i]||oo[i]>hi[i]) return Infinity; continue; }
    let t1=(lo[i]-oo[i])/dd[i], t2=(hi[i]-oo[i])/dd[i];
    if(t1>t2){ const tmp=t1; t1=t2; t2=tmp; }
    tmin=Math.max(tmin,t1); tmax=Math.min(tmax,t2);
    if(tmin>tmax) return Infinity;
  }
  return tmin;
}
export function rayPlayer(o,d,p){
  const r=.45;
  const a=d.x*d.x+d.z*d.z;
  if(a<1e-9) return Infinity;
  const ox=o.x-p.x, oz=o.z-p.z;
  const b=2*(ox*d.x+oz*d.z), cc=ox*ox+oz*oz-r*r;
  const disc=b*b-4*a*cc;
  if(disc<0) return Infinity;
  const t=(-b-Math.sqrt(disc))/(2*a);
  if(t<0) return Infinity;
  const y=o.y+d.y*t;
  return (y<p.y-.05||y>p.y+1.85) ? Infinity : t;
}
