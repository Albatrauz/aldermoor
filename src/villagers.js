/* ============================ fellow travellers ============================ */
// The other players: hooded villagers with a swinging lantern and a handgonne.
// Holds the `remotes` registry and smoothly interpolates each one toward the
// latest network snapshot.
import * as THREE from 'three';
import { scene, mesh, EYE } from './core.js';
import { matIron, matPlank, matDarkWood } from './materials.js';

export const remotes=new Map();

const skinMats=[0xc99a72,0xb98a62,0xa87a55,0xd4a87e]
  .map(c=>new THREE.MeshStandardMaterial({color:c, roughness:.8}));

function makeNameTag(text){
  const c=document.createElement('canvas'); c.width=512; c.height=96;
  const g=c.getContext('2d');
  g.font='italic 42px Georgia, serif';
  g.textAlign='center'; g.textBaseline='middle';
  const w=Math.min(500, g.measureText(text).width+44);
  g.fillStyle='rgba(10,7,4,.55)';
  if(g.roundRect){ g.beginPath(); g.roundRect(256-w/2,16,w,64,14); g.fill(); }
  else g.fillRect(256-w/2,16,w,64);
  g.fillStyle='#e9d8b0';
  g.fillText(text,256,48);
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace;
  const s=new THREE.Sprite(new THREE.SpriteMaterial({map:t, transparent:true, depthWrite:false}));
  s.scale.set(2.2,.41,1);
  s.position.y=2.22;
  return s;
}

function buildVillager(name, color){
  const g=new THREE.Group();
  const cloth=new THREE.MeshStandardMaterial({color, roughness:.95});
  const clothDark=new THREE.MeshStandardMaterial({
    color:new THREE.Color(color).multiplyScalar(.55), roughness:.95});
  const skin=skinMats[name.length%skinMats.length];
  function limb(w,l,px,py,mat){
    const pivot=new THREE.Group();
    pivot.position.set(px,py,0);
    pivot.add(mesh(new THREE.BoxGeometry(w,l,w), mat, 0,-l/2,0));
    g.add(pivot);
    return pivot;
  }
  const legL=limb(.15,.55,-.1,.55,clothDark), legR=limb(.15,.55,.1,.55,clothDark);
  const armL=limb(.11,.52,-.3,1.28,cloth),   armR=limb(.11,.52,.3,1.28,cloth);
  g.add(mesh(new THREE.CylinderGeometry(.24,.33,.8,10), cloth, 0,.95,0));
  g.add(mesh(new THREE.CylinderGeometry(.27,.27,.07,10), matDarkWood, 0,.74,0));
  g.add(mesh(new THREE.SphereGeometry(.17,10,8), skin, 0,1.52,0));
  g.add(mesh(new THREE.ConeGeometry(.21,.34,9), clothDark, 0,1.75,0));   // hood
  g.add(mesh(new THREE.ConeGeometry(.34,.28,9), clothDark, 0,1.32,0));   // mantle
  g.add(makeNameTag(name));
  // hand lantern, swinging with the right arm
  const lant=new THREE.Group();
  lant.position.set(0,-.56,.06);
  lant.add(mesh(new THREE.BoxGeometry(.13,.18,.13), matIron, 0,0,0, {cast:false}));
  lant.add(mesh(new THREE.BoxGeometry(.09,.12,.09),
    new THREE.MeshBasicMaterial({color:0xffc46b}), 0,0,0, {cast:false}));
  // cap how many real lights walk the streets at once
  if([...remotes.values()].filter(r=>r.hasLamp).length < 6){
    const pl=new THREE.PointLight(0xffa84e, 5, 9, 2);
    lant.add(pl);
    var hasLamp=true;
  }
  armR.add(lant);
  // handgonne in the left hand
  const gonne=new THREE.Group();
  gonne.position.set(0,-.52,.1);
  gonne.add(mesh(new THREE.BoxGeometry(.05,.06,.3), matPlank, 0,0,.08, {cast:false}));
  gonne.add(mesh(new THREE.CylinderGeometry(.022,.027,.42,7), matIron, 0,.02,.28, {rx:Math.PI/2, cast:false}));
  const muzzle=new THREE.Object3D();
  muzzle.position.set(0,.02,.5);
  gonne.add(muzzle);
  armL.add(gonne);
  return {group:g, legL, legR, armL, armR, muzzle, hasLamp:!!hasLamp};
}

export function addRemote(d){
  if(remotes.has(d.id)) return;
  const v=buildVillager(d.name, d.color??0x7a3b2e);
  v.cur={x:d.x??0, y:(d.y??EYE)-EYE, z:d.z??38.5, yaw:d.yaw??0};
  v.tgt={...v.cur, m:0, r:0};
  v.phase=0; v.name=d.name; v.shootT=0;
  v.group.position.set(v.cur.x, v.cur.y, v.cur.z);
  v.group.rotation.y=v.cur.yaw+Math.PI;
  scene.add(v.group);
  remotes.set(d.id, v);
}
export function dropRemote(id){
  const v=remotes.get(id);
  if(v){ scene.remove(v.group); remotes.delete(id); }
}

export function updateRemotes(dt){
  const k=1-Math.exp(-10*dt);
  const ease=Math.min(1,dt*12);
  for(const v of remotes.values()){
    v.cur.x+=(v.tgt.x-v.cur.x)*k;
    v.cur.y+=(v.tgt.y-v.cur.y)*k;
    v.cur.z+=(v.tgt.z-v.cur.z)*k;
    let dy=v.tgt.yaw-v.cur.yaw;
    dy=((dy+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;
    v.cur.yaw+=dy*k;
    v.group.position.set(v.cur.x, v.cur.y, v.cur.z);
    v.group.rotation.y=v.cur.yaw+Math.PI;
    if(v.tgt.m) v.phase+=dt*(v.tgt.r?11:7.5);
    const sw=v.tgt.m?Math.sin(v.phase)*.55:0;
    v.legL.rotation.x+=( sw   -v.legL.rotation.x)*ease;
    v.legR.rotation.x+=(-sw   -v.legR.rotation.x)*ease;
    if(v.shootT>0){ // level the handgonne at the shoulder
      v.shootT-=dt;
      v.armL.rotation.x+=(-1.5-v.armL.rotation.x)*Math.min(1,dt*18);
    }else{
      v.armL.rotation.x+=(-sw*.8-v.armL.rotation.x)*ease;
    }
    v.armR.rotation.x+=( sw*.8-v.armR.rotation.x)*ease;
  }
}
