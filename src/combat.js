/* ============================ handgonnes & the tally ============================ */
// The first-person handgonne: its viewmodel, firing (ray test → tracer, flash,
// boom, and a network shot/hit), and reactions to incoming shots and kills.
import * as THREE from 'three';
import { scene, camera, EYE, mesh } from './core.js';
import { matPlank, matIron, matGoldTrim } from './materials.js';
import { colliders } from './world.js';
import { remotes } from './villagers.js';
import { myId, sendNet } from './net.js';
import { spawnFlash, spawnTracer, rayAABB, rayPlayer } from './effects.js';
import { boom, ding, thudSnd } from './audio.js';
import { scoresMap, setHp, renderScores, hurtFlash, hitmark } from './hud.js';
import { announce } from './zones.js';
import { introVisible, locked, dragLook, player, vel, walkPhase } from './controls.js';

scene.add(camera); // the viewmodel rides on the camera
const gun=new THREE.Group();
const gunMuzzle=new THREE.Object3D();
{
  const stock=mesh(new THREE.BoxGeometry(.06,.07,.44), matPlank, 0,-.012,-.1, {cast:false});
  stock.rotation.x=.07;
  gun.add(stock);
  gun.add(mesh(new THREE.CylinderGeometry(.026,.033,.62,8), matIron, 0,.03,-.42, {rx:Math.PI/2, cast:false}));
  gun.add(mesh(new THREE.CylinderGeometry(.042,.042,.05,8), matIron, 0,.03,-.18, {rx:Math.PI/2, cast:false}));
  gun.add(mesh(new THREE.CylinderGeometry(.04,.04,.04,8), matGoldTrim, 0,.03,-.68, {rx:Math.PI/2, cast:false}));
  gunMuzzle.position.set(0,.03,-.74);
  gun.add(gunMuzzle);
  gun.position.set(.34,-.3,-.5);
  camera.add(gun);
}

const FIRE_CD=.9, RANGE=70;
let fireCd=0, gunKick=0;
const crosshairEl=document.getElementById('crosshair');

export function fire(){
  if(fireCd>0||introVisible) return;
  fireCd=FIRE_CD; gunKick=1;
  crosshairEl.classList.add('cool');
  camera.updateMatrixWorld(true);
  const o=camera.position.clone();
  const d=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);
  let end=RANGE;
  if(d.y<-1e-6) end=Math.min(end, -o.y/d.y);              // the ground stops shot
  for(const c of colliders) end=Math.min(end, rayAABB(o,d,c));
  let hitId=null;
  for(const [id,v] of remotes){
    const t=rayPlayer(o,d,v.cur);
    if(t<end){ end=t; hitId=id; }
  }
  const muzzle=gunMuzzle.getWorldPosition(new THREE.Vector3());
  spawnFlash(muzzle,.9);
  spawnTracer(muzzle, o.clone().addScaledVector(d,end));
  boom(.85);
  sendNet({t:'shoot',
    o:[+o.x.toFixed(2),+o.y.toFixed(2),+o.z.toFixed(2)],
    d:[+d.x.toFixed(3),+d.y.toFixed(3),+d.z.toFixed(3)],
    l:+end.toFixed(1)});
  if(hitId!==null) sendNet({t:'hit', target:hitId});
}
addEventListener('mousedown',e=>{
  if(e.button===0 && !introVisible && (locked||dragLook)) fire();
});

export function remoteShoot(m){
  const v=remotes.get(m.id);
  const o=new THREE.Vector3(m.o[0],m.o[1],m.o[2]);
  const d=new THREE.Vector3(m.d[0],m.d[1],m.d[2]);
  const end=o.clone().addScaledVector(d, Math.min(m.l??RANGE,120));
  if(v){
    v.shootT=.45;
    v.group.updateMatrixWorld(true);
    const muz=v.muzzle.getWorldPosition(new THREE.Vector3());
    spawnFlash(muz,.8);
    spawnTracer(muz,end);
  }else{
    spawnTracer(o,end);
  }
  boom(Math.min(.6, 9/Math.max(3, o.distanceTo(camera.position))));
}
export function handleHitFx(m){
  if(m.target===myId){
    setHp(m.hp); hurtFlash(); thudSnd();
    gunKick=Math.max(gunKick,.5);                          // flinch
  }
  if(m.shooter===myId){ hitmark(); ding(); }
}
export function handleFell(m){
  const s=scoresMap.get(m.shooter);
  if(s) s.score=m.score;
  renderScores();
  if(m.target===myId){
    setHp(3); hurtFlash(); thudSnd();
    player.x=Math.random()*4-2; player.z=38.5; player.y=EYE;
    player.vy=0; player.grounded=true; player.yaw=0; player.pitch=0;
    vel.x=vel.z=0;
    announce(`Felled by ${m.sname}! Back to the gates`);
  }else if(m.shooter===myId){
    announce(`You felled ${m.tname}!`);
    ding();
  }else{
    announce(`${m.sname} felled ${m.tname}`);
  }
}

/* per-frame: cooldown, recoil decay, and walk sway of the viewmodel */
export function update(dt){
  gun.visible=!introVisible;
  if(fireCd>0){ fireCd-=dt; if(fireCd<=0) crosshairEl.classList.remove('cool'); }
  gunKick=Math.max(0, gunKick-dt*5);
  gun.position.set(.34, -.3+Math.sin(walkPhase)*.006, -.5+gunKick*.09);
  gun.rotation.x=gunKick*.22;
  gun.rotation.z=Math.sin(walkPhase*.5)*.012;
}
