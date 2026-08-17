/* ============================ fellow travellers ============================ */
// The other players: hooded villagers with a swinging lantern and a handgonne.
// Holds the `remotes` registry and smoothly interpolates each one toward the
// latest network snapshot.
import * as THREE from 'three';
import { scene, mesh, EYE } from './core';
import { matIron, matDarkWood } from './materials';
import { glowTex } from './textures';
import { buildHandgonneTP, buildAK47TP } from './weapons';

// A tracked fellow traveller: the visual rig built by buildVillager, plus the
// interpolation/animation state that addRemote attaches and updateRemotes drives.
type Remote = ReturnType<typeof buildVillager> & {
  cur: { x: number; y: number; z: number; yaw: number };
  tgt: { x: number; y: number; z: number; yaw: number; m: number; r: number };
  phase: number;
  name: string;
  shootT: number;
  deadT: number;
  weapon: number;
};

export const remotes = new Map<number, Remote>();

// How long a felled traveller lies dead before rising at a fresh spawn. Kept in
// step with combat.js DEATH_T and the server's RESPAWN_MS so the body is back on
// its feet just as the respawned player's new position starts arriving.
const DEAD_T=4;
const FALL_T=.45;   // the topple itself is quick; the rest is lying still
const TAG_Y=2.22;   // height of the floating nametag above a traveller's feet
const _tagWorld=new THREE.Vector3();   // scratch for re-anchoring a dead body's tag

const skinMats=[0xc99a72,0xb98a62,0xa87a55,0xd4a87e]
  .map(c=>new THREE.MeshStandardMaterial({color:c, roughness:.8}));

/* Cloth was built fresh per joining player — two new MeshStandardMaterials each
   time, which means three compiles a new program the first time that player is
   drawn, i.e. a hitch exactly when someone walks into the fight. The server only
   ever hands out colours from a fixed list, so cache by colour and every player
   wearing the same cloth shares one program. */
const clothCache = new Map<number, { cloth: THREE.MeshStandardMaterial; clothDark: THREE.MeshStandardMaterial }>();
function clothFor(color: number){
  let c = clothCache.get(color);
  if (!c) {
    c = {
      cloth: new THREE.MeshStandardMaterial({ color, roughness:.95 }),
      clothDark: new THREE.MeshStandardMaterial({
        color: new THREE.Color(color).multiplyScalar(.55), roughness:.95 }),
    };
    clothCache.set(color, c);
  }
  return c;
}

/* Whether travellers carry a lit lantern. Both shipped maps are broad daylight,
   where a burning lamp throwing a warm pool onto the sand looks simply wrong —
   and costs a real PointLight per player for the privilege. Driven by the map
   (see MapEnv.lanterns) so a night map can switch them back on. */
let lanternsOn = false;

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

/* The sun's shadow map is baked once and frozen (see world.ts), so a walking
   player casts no real shadow. This is the stand-in: a soft dark disc at the
   feet. It is not a compromise you notice — the sun sits high enough that a real
   shadow only reached about a metre from the boots anyway — and it costs one
   draw per player instead of re-rasterising the whole world every frame.
   glowTex is a white radial falloff; multiplied by a black colour it becomes a
   soft dark blob, so no new texture is needed. */
const blobGeo = new THREE.PlaneGeometry(1, 1);
const blobMat = new THREE.MeshBasicMaterial({
  map: glowTex, color: 0x000000, transparent: true, opacity: .34,
  depthWrite: false, fog: true,
});
function makeBlob(){
  const b = new THREE.Mesh(blobGeo, blobMat);
  b.rotation.x = -Math.PI / 2;
  b.position.y = .03;          // just clear of the floor and of the AO overlay
  b.scale.setScalar(1.15);
  b.castShadow = b.receiveShadow = false;
  b.renderOrder = 2;
  return b;
}

function buildVillager(name, color){
  const g=new THREE.Group();
  const blob=makeBlob(); g.add(blob);
  const {cloth, clothDark}=clothFor(color);
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
  // Hood and mantle, both pulled in from where they were. The old cone was tall
  // and sharp over a wide skirt, which at this scale read as a garden gnome
  // rather than someone you should be worried about; lower and tighter gives a
  // hooded-fighter silhouette that still reads instantly at range.
  g.add(mesh(new THREE.ConeGeometry(.19,.25,9), clothDark, 0,1.70,0));   // hood
  g.add(mesh(new THREE.ConeGeometry(.31,.22,9), clothDark, 0,1.30,0));   // mantle
  const tag=makeNameTag(name);
  g.add(tag);
  // Hand lantern, swinging with the right arm. Hidden in daylight — see lanternsOn.
  const lant=new THREE.Group();
  lant.position.set(0,-.56,.06);
  lant.visible=lanternsOn;
  lant.add(mesh(new THREE.BoxGeometry(.13,.18,.13), matIron, 0,0,0, {cast:false}));
  lant.add(mesh(new THREE.BoxGeometry(.09,.12,.09),
    new THREE.MeshBasicMaterial({color:0xffc46b}), 0,0,0, {cast:false}));
  // A real light only when the map actually calls for one, and still capped —
  // every PointLight in the scene is paid for by every lit material's shader.
  let hasLamp=false;
  if(lanternsOn && [...remotes.values()].filter(r=>r.hasLamp).length < 6){
    lant.add(new THREE.PointLight(0xffa84e, 5, 9, 2));
    hasLamp=true;
  }
  armR.add(lant);
  // weapon models in the left hand — handgonne (default) and AK-47 (hidden until switched)
  const {group:gonneGroup, muzzle} = buildHandgonneTP();
  const {group:ak47Group, muzzle:akMuzzle} = buildAK47TP();
  ak47Group.visible=false;
  armL.add(gonneGroup);
  armL.add(ak47Group);
  return {group:g, legL, legR, armL, armR, muzzle, akMuzzle, gonneGroup, ak47Group, tag, blob, lant, hasLamp};
}

/* Turn lanterns on or off for the whole cast. Called on every map change.
   Existing travellers are updated in place; the light itself is only ever
   created when a map asks for it, so a daylight map carries none at all. */
export function setLanterns(on: boolean){
  if (on === lanternsOn) return;
  lanternsOn = on;
  let lit = 0;
  for (const v of remotes.values()) {
    v.lant.visible = on;
    const light = v.lant.children.find((c: any) => c.isPointLight) as THREE.PointLight | undefined;
    if (on) {
      if (!light && lit < 6) { v.lant.add(new THREE.PointLight(0xffa84e, 5, 9, 2)); v.hasLamp = true; lit++; }
      else if (light) lit++;
    } else if (light) {
      v.lant.remove(light); light.dispose(); v.hasLamp = false;
    }
  }
}

export function addRemote(d){
  if(remotes.has(d.id)) return;
  const cur={x:d.x??0, y:(d.y??EYE)-EYE, z:d.z??38.5, yaw:d.yaw??0};
  const v: Remote = {
    ...buildVillager(d.name, d.color??0x7a3b2e),
    cur, tgt:{...cur, m:0, r:0}, phase:0, name:d.name, shootT:0, deadT:0, weapon:0,
  };
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
        v.blob.visible=true;              // upright again: the contact shadow returns
        v.cur.x=v.tgt.x; v.cur.y=v.tgt.y; v.cur.z=v.tgt.z; v.cur.yaw=v.tgt.yaw;
        v.group.rotation.x=0;
        v.group.position.set(v.cur.x, v.cur.y, v.cur.z);
        v.group.rotation.y=v.cur.yaw+Math.PI;
        v.tag.position.set(0, TAG_Y, 0);             // tag rides the head again
      }else{
        // topple onto the ground over FALL_T, then lie still. Stay put where we
        // fell (ignore inbound snapshots) and let the limbs go slack.
        v.blob.visible=false;             // the group tips 90°; a flat disc must not tip with it
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
