/* ============================ weapons & the tally ============================ */
// First-person viewmodels, firing (ray test → tracer, flash, sound, network
// shot/hit), and reactions to incoming shots and kills.
import * as THREE from 'three';
import { scene, camera, renderer } from './core';
import { WEAPONS, buildHandgonneFP, buildAK47FP } from './weapons';
import { colliders } from './world';
import { remotes, killRemote } from './villagers';
import { myId, sendNet } from './net';
import { spawnFlash, spawnTracer, rayAABB, rayPlayer } from './effects';
import { boom, crack, ding, thudSnd, clack } from './audio';
import { scoresMap, setHp, setAmmo, renderScores, hurtFlash, hitmark,
  showKillscreen, hideKillscreen, setKillCount, showOverview, hideOverview, MAX_HP } from './hud';
import { announce, syncZone } from './zones';
import { introVisible, locked, dragLook, walkPhase, respawn, setDead, frozen, setFrozen, player, vel, keys } from './controls';

scene.add(camera); // the viewmodel rides on the camera
const fpModels = [buildHandgonneFP(), buildAK47FP()];
for(const fm of fpModels){ camera.add(fm.group); fm.group.visible=false; }

export let weaponIdx = 0; // live binding — net.js reads it at send-time
const ammo  = WEAPONS.map(w => w.mag);
const spare = WEAPONS.map(w => w.spareMax);

const DEATH_T = 4;
// height above a foe's feet that counts as a head — the model's skull/hood sit
// here (body cylinder tops out ~1.35, head sphere centres ~1.52). See rayPlayer.
const HEAD_Y = 1.4;
let fireCd=0, gunKick=0, reloadT=0, deathT=0;
// sustained-fire "heat": climbs by one per shot and bleeds off at the weapon's
// `cool` rate, scaling each shot's bloom so a held spray walks the cone open.
let fireHeat=0;
let mouseDown=false;
// shot scatter as a cone half-angle (radians), drawn from the active weapon's
// `spread` config. a small idle floor keeps even a settled shot from being a
// guaranteed headshot; moving/running/hopping raise the floor and every shot
// blooms, then it eases back. the crosshair draws this same cone, so its tick
// gap honestly bounds where a shot can land — and a held full-auto spray walks
// the cone wide open, so spraying for headshots doesn't pay.
let spread = WEAPONS[weaponIdx].spread.base;
const crosshairEl=document.getElementById('crosshair');

function refillAll(){
  for(let i=0;i<WEAPONS.length;i++){ ammo[i]=WEAPONS[i].mag; spare[i]=WEAPONS[i].spareMax; }
  reloadT=0; fireCd=0; gunKick=0; fireHeat=0; spread=WEAPONS[weaponIdx].spread.base;
  const w=WEAPONS[weaponIdx];
  setAmmo(ammo[weaponIdx], w.mag, false, spare[weaponIdx], w);
}

// show the active model (called once after modules load and controls unlock)
fpModels[weaponIdx].group.visible=true;
setAmmo(ammo[weaponIdx], WEAPONS[weaponIdx].mag, false, spare[weaponIdx], WEAPONS[weaponIdx]);

export function startReload(){
  const w=WEAPONS[weaponIdx];
  if(reloadT>0||ammo[weaponIdx]===w.mag||spare[weaponIdx]<=0||introVisible||deathT>0) return;
  reloadT=w.reloadTime;
  setAmmo(ammo[weaponIdx], w.mag, true, spare[weaponIdx], w);
  clack();
}

export function fire(){
  const w=WEAPONS[weaponIdx];
  if(fireCd>0||reloadT>0||introVisible||deathT>0) return;
  if(ammo[weaponIdx]<=0){ startReload(); return; }
  ammo[weaponIdx]-=1;
  setAmmo(ammo[weaponIdx], w.mag, false, spare[weaponIdx], w);
  fireCd=w.fireCd; gunKick=Math.max(gunKick, w.kick);
  camera.updateMatrixWorld(true);
  const o=camera.position.clone();
  const d=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);
  // scatter inside the current spread cone (uniform over the disk: sqrt for even area),
  // then bloom for the next shot — this same d drives the raycast, tracer and hit report
  const aRand=Math.random()*Math.PI*2, rr=Math.sqrt(Math.random())*Math.tan(spread);
  const right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion);
  const up=new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion);
  d.addScaledVector(right, Math.cos(aRand)*rr).addScaledVector(up, Math.sin(aRand)*rr).normalize();
  // each held shot blooms harder than the last: heat scales the per-shot growth,
  // then ticks up so the next round in a sustained spray opens the cone further
  spread=Math.min(w.spread.max, spread+w.spread.shot*(1+fireHeat*(w.spread.ramp||0)));
  fireHeat+=1;
  let end=w.range;
  if(d.y<-1e-6) end=Math.min(end, -o.y/d.y);             // ground stops shot
  for(const c of colliders) end=Math.min(end, rayAABB(o,d,c));
  let hitId=null;
  for(const [id,v] of remotes){
    const t=rayPlayer(o,d,v.cur);
    if(t<end){ end=t; hitId=id; }
  }
  const muz=fpModels[weaponIdx].muzzle.getWorldPosition(new THREE.Vector3());
  spawnFlash(muz, w.id==='ak47' ? .7 : .9);
  spawnTracer(muz, o.clone().addScaledVector(d,end));
  (w.id==='ak47' ? crack : boom)(.85);
  sendNet({t:'shoot', w:weaponIdx,
    o:[+o.x.toFixed(2),+o.y.toFixed(2),+o.z.toFixed(2)],
    d:[+d.x.toFixed(3),+d.y.toFixed(3),+d.z.toFixed(3)],
    l:+end.toFixed(1)});
  if(hitId!==null){
    const v=remotes.get(hitId);
    const head=v ? (o.y+d.y*end)-v.cur.y >= HEAD_Y : false;
    sendNet({t:'hit', target:hitId, head, w:weaponIdx});
  }
  if(ammo[weaponIdx]===0) startReload();
}

addEventListener('mousedown',e=>{
  if(e.button===0 && !introVisible && !frozen && (locked||dragLook)){ mouseDown=true; fire(); }
});
addEventListener('mouseup',e=>{
  if(e.button===0) mouseDown=false;
});
addEventListener('keydown',e=>{
  if(e.code==='KeyR' && !introVisible) startReload();
  if(e.code==='Digit1' && !introVisible && deathT<=0) switchWeapon(0);
  if(e.code==='Digit2' && !introVisible && deathT<=0) switchWeapon(1);
});

function switchWeapon(idx){
  if(idx===weaponIdx||reloadT>0||introVisible||deathT>0) return;
  fpModels[weaponIdx].group.visible=false;
  weaponIdx=idx;
  fpModels[weaponIdx].group.visible=true;
  fireCd=Math.max(fireCd,.25); // brief draw delay
  mouseDown=false;             // avoid carrying a held trigger into the new weapon
  fireHeat=0;                            // a fresh arm starts cold — no carried spray heat
  spread=WEAPONS[weaponIdx].spread.base; // fresh arm draws to its own settled cone
  const w=WEAPONS[weaponIdx];
  setAmmo(ammo[weaponIdx], w.mag, false, spare[weaponIdx], w);
}

export function remoteShoot(m){
  const v=remotes.get(m.id);
  const o=new THREE.Vector3(m.o[0],m.o[1],m.o[2]);
  const d=new THREE.Vector3(m.d[0],m.d[1],m.d[2]);
  const end=o.clone().addScaledVector(d, Math.min(m.l??70,120));
  const rw=m.w===1 ? 1 : 0;
  if(v){
    v.shootT=.45;
    v.group.updateMatrixWorld(true);
    const muzzleObj=rw===1 ? v.akMuzzle : v.muzzle;
    const muz=muzzleObj.getWorldPosition(new THREE.Vector3());
    spawnFlash(muz, rw===1 ? .7 : .8);
    spawnTracer(muz,end);
  }else{
    spawnTracer(o,end);
  }
  (rw===1 ? crack : boom)(Math.min(.6, 9/Math.max(3, o.distanceTo(camera.position))));
}
export function handleHitFx(m){
  if(m.target===myId){
    setHp(m.hp); hurtFlash(); thudSnd();
    gunKick=Math.max(gunKick,.5);                         // flinch
  }
  if(m.shooter===myId){ hitmark(); ding(); }
}
export function handleFell(m){
  const s=scoresMap.get(m.shooter);
  if(s) s.score=m.score;
  const td=scoresMap.get(m.target);
  if(td && m.tdeaths!=null) td.deaths=m.tdeaths;
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
    const s=scoresMap.get(m.winnerId); s.score=m.cap;
  }
  setFrozen(true);
  renderScores();
  showOverview(m);
}

export function handleRestart(_msg?: unknown){
  hideOverview();
  setFrozen(false);
  for(const s of scoresMap.values()){ s.score=0; s.deaths=0; }
  setHp(MAX_HP); renderScores();
  respawn();
  syncZone();
  refillAll();
  mouseDown=false;
  announce('A new contest begins!');
}

/* end a death: fresh spawn, restored weapons, control handed back */
function rise(){
  deathT=0;
  respawn();
  syncZone();
  setHp(MAX_HP);
  refillAll();
  mouseDown=false;
  hideKillscreen();
  setDead(false);
}
/* abort a death screen outright when the socket (re)connects mid-count */
export function clearDeath(){ if(deathT>0) rise(); }

/* per-frame: cooldown, reload, recoil decay, spread easing + crosshair, sway */
export function update(dt){
  fpModels[weaponIdx].group.visible=!introVisible && deathT<=0;
  if(deathT>0){
    deathT-=dt;
    setKillCount(Math.max(1, Math.ceil(deathT)));   // 4 → 3 → 2 → 1, then rise
    if(deathT<=0) rise();                           // the count is up — back to the fight
    return;                                         // no gun sway or reload progress while dead
  }
  if(fireCd>0) fireCd-=dt;
  if(reloadT>0){
    reloadT-=dt;
    if(reloadT<=0){
      reloadT=0;
      const w=WEAPONS[weaponIdx];
      const need=w.mag-ammo[weaponIdx];
      const take=Math.min(need, spare[weaponIdx]);
      ammo[weaponIdx]+=take; spare[weaponIdx]-=take;
      setAmmo(ammo[weaponIdx], w.mag, false, spare[weaponIdx], w);
      ding();
    }
  }
  // full-auto: keep firing while mouse is held
  if(mouseDown && WEAPONS[weaponIdx].full && !frozen) fire();
  gunKick=Math.max(0, gunKick-dt*5);
  // ease spread toward its floor (moving/running/airborne raise it; firing bloomed it),
  // then map the cone half-angle to a screen-pixel gap at the live FOV so the crosshair
  // stays an honest spread gauge even through the run-zoom.
  const sp=WEAPONS[weaponIdx].spread;
  const movingNow=Math.hypot(vel.x,vel.z)>.4, running=keys.has('ShiftLeft')||keys.has('ShiftRight');
  let floor=sp.base;
  if(!player.grounded) floor+=sp.air;
  else if(movingNow)   floor+=running?sp.run:sp.walk;
  spread += (floor-spread)*Math.min(1,dt*sp.recover);
  spread = Math.min(spread, sp.max);
  fireHeat = Math.max(0, fireHeat-dt*(sp.cool||0));  // spray heat bleeds off between shots / once the trigger's let off
  const gapPx=Math.tan(spread)/Math.tan(camera.fov*Math.PI/360)*(renderer.domElement.clientHeight/2);
  crosshairEl.style.setProperty('--gap', gapPx.toFixed(1)+'px');
  const w=WEAPONS[weaponIdx];
  const fm=fpModels[weaponIdx];
  const b=fm.base;
  const dip=reloadT>0 ? Math.sin((1-reloadT/w.reloadTime)*Math.PI) : 0;
  fm.group.position.set(b.x, b.y+Math.sin(walkPhase)*.006-dip*.16, b.z+gunKick*.09);
  fm.group.rotation.x=gunKick*.22-dip*.7;
  fm.group.rotation.z=Math.sin(walkPhase*.5)*.012+dip*.25;
}
