/* ============================ handgonnes & the tally ============================ */
// The first-person handgonne: its viewmodel, firing (ray test → tracer, flash,
// boom, and a network shot/hit), and reactions to incoming shots and kills.
import * as THREE from 'three';
import { scene, camera, mesh, renderer } from './core.js';
import { matPlank, matIron, matGoldTrim } from './materials.js';
import { colliders } from './world.js';
import { remotes, killRemote } from './villagers.js';
import { myId, sendNet } from './net.js';
import { spawnFlash, spawnTracer, rayAABB, rayPlayer } from './effects.js';
import { boom, ding, thudSnd, clack } from './audio.js';
import { scoresMap, setHp, setAmmo, renderScores, hurtFlash, hitmark,
  showKillscreen, hideKillscreen, setKillCount, showOverview, hideOverview, MAX_HP } from './hud.js';
import { announce, syncZone } from './zones.js';
import { introVisible, locked, dragLook, walkPhase, respawn, setDead, frozen, setFrozen, player, vel, keys } from './controls.js';

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

const FIRE_CD=.9, RANGE=70, MAG=5, RELOAD_T=2.2, DEATH_T=4;
// height above a foe's feet that counts as a head — the model's skull/hood sit
// here (body cylinder tops out ~1.35, head sphere centres ~1.52). See rayPlayer.
const HEAD_Y=1.4;
// shot scatter as a cone half-angle (radians). there's a small idle floor so even
// a settled shot isn't a guaranteed headshot at range; moving, running and hopping
// raise the floor, and every shot blooms then eases back. the crosshair draws this
// same cone, so the gap between its ticks is an honest "shots land somewhere inside".
const SP_BASE=.007, SP_WALK=.028, SP_RUN=.045, SP_AIR=.08,   // ~0.4° / 1.6° / 2.6° / 4.6°
      SP_SHOT=.024, SP_MAX=.12, SP_RECOVER=5;                // +1.4°/shot, cap ~7°, ease rate
let fireCd=0, gunKick=0, ammo=MAG, reloadT=0, deathT=0, spread=SP_BASE;
const crosshairEl=document.getElementById('crosshair');
setAmmo(ammo, MAG, false);

export function startReload(){
  if(reloadT>0||ammo===MAG||introVisible||deathT>0) return;
  reloadT=RELOAD_T;
  setAmmo(ammo, MAG, true);
  clack();
}

export function fire(){
  if(fireCd>0||reloadT>0||introVisible||deathT>0) return;
  if(ammo<=0){ startReload(); return; }
  ammo-=1; setAmmo(ammo, MAG, false);
  fireCd=FIRE_CD; gunKick=1;
  camera.updateMatrixWorld(true);
  const o=camera.position.clone();
  const d=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);
  // scatter inside the current spread cone (uniform over the disk: sqrt for even area),
  // then bloom for the next shot — this same d drives the raycast, tracer and hit report
  const aRand=Math.random()*Math.PI*2, rr=Math.sqrt(Math.random())*Math.tan(spread);
  const right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion);
  const up=new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion);
  d.addScaledVector(right, Math.cos(aRand)*rr).addScaledVector(up, Math.sin(aRand)*rr).normalize();
  spread=Math.min(SP_MAX, spread+SP_SHOT);
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
  if(hitId!==null){
    const v=remotes.get(hitId);
    // impact height above the foe's feet decides head vs body (one-shot vs chip)
    const head=v ? (o.y+d.y*end) - v.cur.y >= HEAD_Y : false;
    sendNet({t:'hit', target:hitId, head});
  }
  if(ammo===0) startReload();                              // ram the next charge
}
addEventListener('mousedown',e=>{
  if(e.button===0 && !introVisible && !frozen && (locked||dragLook)) fire();
});
addEventListener('keydown',e=>{
  if(e.code==='KeyR' && !introVisible) startReload();
});
addEventListener('keydown',e=>{
  if(e.code==='KeyR' && !introVisible) startReload();
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
  if(m.target!==myId) killRemote(m.target);   // topple the felled body for onlookers
  if(m.target===myId){
    if(deathT>0) return;                  // already lying dead — ignore a stray second blow
    setHp(0); hurtFlash(); thudSnd();
    setDead(true);                        // freeze where we fell; respawn happens on the count
    deathT=DEATH_T;
    showKillscreen(m.sname, Math.ceil(DEATH_T), m.dmg, m.head, m.shooter);
  }else if(m.shooter===myId){
    announce(m.head ? `You felled ${m.tname} with a ball to the head!` : `You felled ${m.tname}!`);
    ding();
  }else{
    announce(m.head ? `${m.sname} felled ${m.tname} with a headshot` : `${m.sname} felled ${m.tname}`);
  }
}
export function handleOver(m){
  if(m.winnerId!=null && scoresMap.has(m.winnerId)){
    const s=scoresMap.get(m.winnerId); s.score=m.cap; // make sure the tally agrees
  }
  setFrozen(true);
  renderScores();
  showOverview(m);
}

export function handleRestart(){
  hideOverview();
  setFrozen(false);
  for(const s of scoresMap.values()) s.score=0;
  setHp(MAX_HP); renderScores();
  respawn();                                         // fresh spawn + ground snap, as a rise does
  syncZone();                                        // adopt the new locale without a toast
  ammo=MAG; reloadT=0; fireCd=0; gunKick=0; spread=SP_BASE;   // a full gonne for the new contest
  setAmmo(ammo, MAG, false);
  announce('A new contest begins!');
}

/* end a death: fresh spawn, restored gonne, control handed back to the player */
function rise(){
  deathT=0;
  respawn();                                         // pick a fresh spawn and snap there
  syncZone();                                        // adopt the new locale without a toast
  setHp(MAX_HP);
  ammo=MAG; reloadT=0; fireCd=0; gunKick=0; spread=SP_BASE; setAmmo(ammo, MAG, false);
  hideKillscreen();
  setDead(false);
}
/* abort a death screen outright — net calls this when the socket (re)connects
   mid-count, so a dropped link can't strand us frozen behind the overlay */
export function clearDeath(){ if(deathT>0) rise(); }

/* per-frame: cooldown, reload, recoil decay, and walk sway of the viewmodel */
export function update(dt){
  gun.visible=!introVisible && deathT<=0;
  if(deathT>0){
    deathT-=dt;
    setKillCount(Math.max(1, Math.ceil(deathT)));    // 4 → 3 → 2 → 1, then rise
    if(deathT<=0) rise();                            // the count is up — back to the fight
    return;                                          // no gun sway or reload progress while dead
  }
  if(fireCd>0) fireCd-=dt;
  if(reloadT>0){
    reloadT-=dt;
    if(reloadT<=0){ reloadT=0; ammo=MAG; setAmmo(ammo, MAG, false); ding(); }
  }
  gunKick=Math.max(0, gunKick-dt*5);
  // ease spread toward its floor (moving/running/airborne raise it; firing bloomed it),
  // then map the cone half-angle to a screen-pixel gap at the live FOV so the crosshair
  // stays an honest spread gauge even through the run-zoom.
  const movingNow=Math.hypot(vel.x,vel.z)>.4, running=keys.has('ShiftLeft')||keys.has('ShiftRight');
  let floor=SP_BASE;
  if(!player.grounded) floor+=SP_AIR;
  else if(movingNow)   floor+=running?SP_RUN:SP_WALK;
  spread += (floor-spread)*Math.min(1,dt*SP_RECOVER);
  spread = Math.min(spread, SP_MAX);
  const gapPx=Math.tan(spread)/Math.tan(camera.fov*Math.PI/360)*(renderer.domElement.clientHeight/2);
  crosshairEl.style.setProperty('--gap', gapPx.toFixed(1)+'px');
  // during a reload the gonne dips down and swings back up
  const dip=reloadT>0 ? Math.sin((1-reloadT/RELOAD_T)*Math.PI) : 0;
  gun.position.set(.34, -.3+Math.sin(walkPhase)*.006-dip*.16, -.5+gunKick*.09);
  gun.rotation.x=gunKick*.22-dip*.7;
  gun.rotation.z=Math.sin(walkPhase*.5)*.012+dip*.25;
}
