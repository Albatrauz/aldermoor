/* ============================ fellow travellers ============================ */
// The other players: hooded villagers with a swinging lantern and a handgonne.
// Holds the `remotes` registry and smoothly interpolates each one toward the
// latest network snapshot.
import * as THREE from 'three';
import { scene, mesh, EYE } from './core.js';
import { matIron, matDarkWood } from './materials.js';
import { buildHandgonneTP, buildAK47TP } from './weapons.js';

export const remotes=new Map();

// How long a felled traveller lies dead before rising at a fresh spawn. Kept in
// step with combat.js DEATH_T and the server's RESPAWN_MS so the body is back on
// its feet just as the respawned player's new position starts arriving.
const DEAD_T=4;
const FALL_T=.45;   // the topple itself is quick; the rest is lying still
const TAG_Y=2.22;   // height of the floating nametag above a traveller's feet
const _tagWorld=new THREE.Vector3();   // scratch for re-anchoring a dead body's tag

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
  s.position.y=TAG_Y;
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
  const tag=makeNameTag(name);
  g.add(tag);
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
  // weapon models in the left hand — handgonne (default) and AK-47 (hidden until switched)
  const {group:gonneGroup, muzzle} = buildHandgonneTP();
  const {group:ak47Group, muzzle:akMuzzle} = buildAK47TP();
  ak47Group.visible=false;
  armL.add(gonneGroup);
  armL.add(ak47Group);
  return {group:g, legL, legR, armL, armR, muzzle, akMuzzle, gonneGroup, ak47Group, tag, hasLamp:!!hasLamp};
}

export function addRemote(d){
  if(remotes.has(d.id)) return;
  const v=buildVillager(d.name, d.color??0x7a3b2e);
  v.cur={x:d.x??0, y:(d.y??EYE)-EYE, z:d.z??38.5, yaw:d.yaw??0};
  v.tgt={...v.cur, m:0, r:0};
  v.phase=0; v.name=d.name; v.shootT=0; v.deadT=0; v.weapon=0;
  v.group.position.set(v.cur.x, v.cur.y, v.cur.z);
  v.group.rotation.y=v.cur.yaw+Math.PI;
  scene.add(v.group);
  remotes.set(d.id, v);
}
export function setRemoteWeapon(v, idx){
  const w=idx===1 ? 1 : 0;
  if(v.weapon===w) return;
  v.weapon=w;
  v.gonneGroup.visible=w===0;
  v.ak47Group.visible=w===1;
}
export function dropRemote(id){
  const v=remotes.get(id);
  if(v){ scene.remove(v.group); remotes.delete(id); }
}
/* fell a traveller: topple them to the ground so onlookers see the kill. They
   lie there for DEAD_T, then rise at whatever spawn the snapshots have moved
   them to. Re-felling a body just refreshes the count (the server won't hand
   out a phantom kill, but a stray late `fell` shouldn't reset a near-done one). */
export function killRemote(id){
  const v=remotes.get(id);
  if(!v) return;
  v.deadT=DEAD_T;
  v.shootT=0;                 // drop any half-raised handgonne pose
}
/* swap the floating nametag when a traveller takes a new name */
export function renameRemote(id, name){
  const v=remotes.get(id);
  if(!v || v.name===name) return;
  v.name=name;
  v.group.remove(v.tag);
  v.tag.material.map.dispose();
  v.tag.material.dispose();
  v.tag=makeNameTag(name);
  v.group.add(v.tag);
}

export function updateRemotes(dt){
  const k=1-Math.exp(-10*dt);
  const ease=Math.min(1,dt*12);
  for(const v of remotes.values()){
    if(v.deadT>0){
      v.deadT-=dt;
      if(v.deadT<=0){
        // back on their feet — cut straight to wherever the snapshots have moved
        // them (their fresh spawn), so they don't slide across town as they rise
        v.deadT=0; v.phase=0;
        v.cur.x=v.tgt.x; v.cur.y=v.tgt.y; v.cur.z=v.tgt.z; v.cur.yaw=v.tgt.yaw;
        v.group.rotation.x=0;
        v.group.position.set(v.cur.x, v.cur.y, v.cur.z);
        v.group.rotation.y=v.cur.yaw+Math.PI;
        v.tag.position.set(0, TAG_Y, 0);             // tag rides the head again
      }else{
        // topple onto the ground over FALL_T, then lie still. Stay put where we
        // fell (ignore inbound snapshots) and let the limbs go slack.
        const f=Math.min(1,(DEAD_T-v.deadT)/FALL_T);
        const e=f*f*(3-2*f);                          // smoothstep the fall
        v.group.rotation.x=e*(Math.PI/2);
        v.group.rotation.y=v.cur.yaw+Math.PI;
        v.group.position.set(v.cur.x, v.cur.y+e*.35, v.cur.z); // rest on its side
        // keep the nametag hovering upright over the spot they fell, not toppled
        // to the ground with the body — counter the group's tilt/lift via its matrix
        v.group.updateMatrixWorld();
        _tagWorld.set(v.cur.x, v.cur.y+TAG_Y, v.cur.z);
        v.tag.position.copy(v.group.worldToLocal(_tagWorld));
        const slack=Math.min(1,dt*10);
        v.legL.rotation.x+=(0 -v.legL.rotation.x)*slack;
        v.legR.rotation.x+=(0 -v.legR.rotation.x)*slack;
        v.armL.rotation.x+=(.2-v.armL.rotation.x)*slack;
        v.armR.rotation.x+=(.2-v.armR.rotation.x)*slack;
      }
      continue;
    }
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
