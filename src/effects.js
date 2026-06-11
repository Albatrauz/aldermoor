/* ============================ transient effects & ray tests ============================ */
// Short-lived visuals (tracers, muzzle flashes, powder smoke) plus the ray-cast
// helpers used by the handgonne to decide what a shot hits.
import * as THREE from 'three';
import { scene } from './core.js';
import { flameTex, smokeTex } from './textures.js';

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
  const lo=[c.x-c.hx, 0, c.z-c.hz], hi=[c.x+c.hx, c.h??5, c.z+c.hz];
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
