/* ============================ weapons & the tally ============================ */
// First-person viewmodels, firing (ray test → tracer, flash, sound, network
// shot/hit), and reactions to incoming shots and kills. What a shot hits in the
// world, and what it does to it, is the voxel engine's business (./voxel).
import * as THREE from 'three';
import { scene, camera, renderer } from './core';
import { WEAPONS, buildHandgonneFP, buildAK47FP } from './weapons';
import { traceWorld, shotImpact } from './voxel';
import { remotes, killRemote } from './villagers';
import { myId, sendNet } from './net';
import { spawnFlash, spawnTracer, spawnDamageNumber, rayPlayer } from './effects';
import { boom, crack, ding, thudSnd, clack } from './audio';
import { scoresMap, setHp, setAmmo, renderScores, hurtFlash, hitmark,
  showKillscreen, hideKillscreen, setKillCount, showOverview, hideOverview, MAX_HP } from './hud';
import { announce, syncZone } from './zones';
import { isCooking, resetNades } from './grenades';
import { aim } from './aim';
import { introVisible, locked, dragLook, walkPhase, respawn, setDead, frozen, setFrozen, showMenu, onMenuShown, player, vel, keys } from './controls';

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
// linear raise progress 0..1 (aim.t is this, eased)
let adsLin=0;
// sustained-fire "heat": climbs by one per shot and bleeds off at the weapon's
// `cool` rate, scaling each shot's bloom so a held spray walks the cone open.
let fireHeat=0;
// seconds since the last shot left; recovery waits for the weapon's `settle`
let sinceShot=Infinity;
let mouseDown=false;
// renderer.info.render.frame when the last shot left (only main.ts renders, so
// that counter is the drawn-frame count); full-auto fires once per frame at most
let shotFrame=-1;
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
  reloadT=0; fireCd=0; gunKick=0; fireHeat=0; sinceShot=Infinity; spread=WEAPONS[weaponIdx].spread.base;
  const w=WEAPONS[weaponIdx];
  setAmmo(ammo[weaponIdx], w.mag, false, spare[weaponIdx], w);
  resetNades();
}

// show the active model (called once after modules load and controls unlock)
fpModels[weaponIdx].group.visible=true;
setAmmo(ammo[weaponIdx], WEAPONS[weaponIdx].mag, false, spare[weaponIdx], WEAPONS[weaponIdx]);

export function startReload(){
  const w=WEAPONS[weaponIdx];
  if(reloadT>0||ammo[weaponIdx]===w.mag||spare[weaponIdx]<=0||introVisible||deathT>0||isCooking()) return;
  reloadT=w.reloadTime;
  setAmmo(ammo[weaponIdx], w.mag, true, spare[weaponIdx], w);
  clack();
}

export function fire(){
  const w=WEAPONS[weaponIdx];
  if(fireCd>0||reloadT>0||introVisible||deathT>0||isCooking()) return;   // one hand is on the grenade
  if(ammo[weaponIdx]<=0){ startReload(); return; }
  ammo[weaponIdx]-=1;
  setAmmo(ammo[weaponIdx], w.mag, false, spare[weaponIdx], w);
  fireCd=w.fireCd; gunKick=Math.max(gunKick, w.kick);
  shotFrame=renderer.info.render.frame;
  sinceShot=0;
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
  // aiming down sights steadies a cold shot's bloom, but not the heat on top:
  // holding the trigger walks the cone open through the sights as well
  const steady=1+(w.ads.spread-1)*aim.t;
  spread=Math.min(w.spread.max, spread+w.spread.shot*(steady+fireHeat*(w.spread.ramp||0)));
  fireHeat+=1;
  let end=traceWorld(o,d,w.range).end;   // how far the world lets it fly
  let hitId=null;
  for(const [id,v] of remotes){
    const t=rayPlayer(o,d,v.cur);
    if(t<end){ end=t; hitId=id; }   // a body absorbs it
  }
  const muz=fpModels[weaponIdx].muzzle.getWorldPosition(new THREE.Vector3());
  const hitPoint=o.clone().addScaledVector(d,end);
  spawnFlash(muz, w.id==='ak47' ? .7 : .9);
  spawnTracer(muz, hitPoint);
  (w.id==='ak47' ? crack : boom)(.85);
  // The shot as it goes on the wire. Its effect on the world is computed from
  // these rounded numbers — not from the exact ones above — because they are
  // all any other client will ever see, and every client has to knock the same
  // hole in the same wall. A shot that stopped in a body carries that shorter
  // length, so it never reaches the wall behind.
  const wire={t:'shoot', w:weaponIdx,
    o:[+o.x.toFixed(2),+o.y.toFixed(2),+o.z.toFixed(2)],
    d:[+d.x.toFixed(3),+d.y.toFixed(3),+d.z.toFixed(3)],
    l:+end.toFixed(1)};
  // Online, the hole is not knocked here: the server sends every accepted shot
  // back to everyone, us included, and it lands then (see remoteShoot) — so all
  // clients apply the same shots in the same order. Offline there is nobody to
  // agree with, and it lands at once.
  if(!sendNet(wire)) shotImpact(wire.o, wire.d, wire.l, weaponIdx);
  if(hitId!==null){
    const v=remotes.get(hitId);
    const head=v ? (o.y+d.y*end)-v.cur.y >= HEAD_Y : false;
    sendNet({t:'hit', target:hitId, head, w:weaponIdx});
  }
  if(ammo[weaponIdx]===0) startReload();
}

addEventListener('mousedown',e=>{
  if(e.button===0 && !introVisible && !frozen && (locked||dragLook)){ mouseDown=true; fire(); }
  if(e.button===2 && !introVisible && !frozen && (locked||dragLook)) aim.held=true;
});
addEventListener('mouseup',e=>{
  if(e.button===0) mouseDown=false;
  if(e.button===2) aim.held=false;
});
// the right button is the sights, never the browser's context menu
addEventListener('contextmenu',e=>{ if(!introVisible) e.preventDefault(); });
// a released button the page never hears about (alt-tab, lost lock) must not leave the sights up
addEventListener('blur',()=>{ aim.held=false; });
document.addEventListener('pointerlockchange',()=>{ if(!document.pointerLockElement) aim.held=false; });
addEventListener('keydown',e=>{
  if(e.code==='KeyR' && !introVisible) startReload();
  if(e.code==='Digit1' && !introVisible && deathT<=0) switchWeapon(0);
  if(e.code==='Digit2' && !introVisible && deathT<=0) switchWeapon(1);
});

function switchWeapon(idx){
  if(idx===weaponIdx||reloadT>0||introVisible||deathT>0||isCooking()) return;
  fpModels[weaponIdx].group.visible=false;
  weaponIdx=idx;
  fpModels[weaponIdx].group.visible=true;
  fireCd=Math.max(fireCd,.25); // brief draw delay
  adsLin=0; aim.t=0;           // the new gun comes up at the hip
  mouseDown=false;             // avoid carrying a held trigger into the new weapon
  fireHeat=0; sinceShot=Infinity;        // a fresh arm starts cold — no carried spray heat
  spread=WEAPONS[weaponIdx].spread.base; // fresh arm draws to its own settled cone
  const w=WEAPONS[weaponIdx];
  setAmmo(ammo[weaponIdx], w.mag, false, spare[weaponIdx], w);
}

export function remoteShoot(m){
  const len=Math.min(m.l??70,120);
  const rw=m.w===1 ? 1 : 0;
  // Land it on our copy of the world: the same function, fed the same numbers,
  // in the same order, as on every other client — so the same voxels go here
  // as go there.
  shotImpact(m.o, m.d, len, rw);
  if(m.id===myId) return;   // our own shot coming back: flash, tracer and bang already happened
  const v=remotes.get(m.id);
  const o=new THREE.Vector3(m.o[0],m.o[1],m.o[2]);
  const d=new THREE.Vector3(m.d[0],m.d[1],m.d[2]).normalize();
  const end=o.clone().addScaledVector(d, len);
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
  if(m.shooter===myId && m.target!==myId){ hitmark(); ding(); }
  popDamage(m.target, m.dmg, m.head);                     // float the ball's bite off the struck traveller
}

// Pop a Borderlands-style damage number off a struck remote so every onlooker
// (the shooter included) sees how hard the ball landed. We can't see our own
// first-person body, so a hit on us shows as the screen flinch, not a number.
function popDamage(targetId, dmg, head){
  if(dmg==null || targetId===myId) return;
  const v=remotes.get(targetId);
  if(v) spawnDamageNumber(new THREE.Vector3(v.cur.x, v.cur.y+1.55, v.cur.z), dmg, head);
}
export function handleFell(m){
  const s=scoresMap.get(m.shooter);
  if(s) s.score=m.score;
  const td=scoresMap.get(m.target);
  if(td && m.tdeaths!=null) td.deaths=m.tdeaths;
  renderScores();
  popDamage(m.target, m.lastDmg, m.head);      // the felling ball's bite, before the body topples
  if(m.target!==myId) killRemote(m.target);   // topple the felled body for onlookers
  if(m.target===myId){
    if(deathT>0) return;                  // already lying dead — ignore a stray second blow
    setHp(0); hurtFlash(); thudSnd();
    setDead(true);                        // freeze where we fell; respawn happens on the count
    deathT=DEATH_T;
    adsLin=0; aim.t=0;                    // the sights drop with us
    showKillscreen(m.sname, Math.ceil(DEATH_T), m.dmg, m.head, m.shooter, m.self);
  }else if(m.self){
    announce(`${m.tname} was killed by their own grenade`);
  }else if(m.shooter===myId){
    announce(m.w===2 ? `Your grenade killed ${m.tname}`
      : m.head ? `Headshot — you killed ${m.tname}` : `You killed ${m.tname}`);
    ding();
  }else{
    announce(m.w===2 ? `${m.sname}'s grenade killed ${m.tname}`
      : m.head ? `${m.sname} killed ${m.tname} · headshot` : `${m.sname} killed ${m.tname}`);
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
  announce('New round — go!');
}

// true while the live socket has us as an active combatant (between a spawn and
// the next lobby return / disconnect). Lets a menu peek mid-fight resume in place
// rather than respawn, and tells us whether Esc means "bow out" or "still fighting".
let inField=false;

/* Take the field: a fresh life with weapons restored, and tell the server we're
   now a combatant (so we can shoot and be shot). Wired to the intro's "Take the
   Field" button and re-fired on a reconnect that lands us mid-fight. If we're
   already on the field (resuming a menu peek), this just hands control back — no
   teleport, no fresh spawn. */
export function enterField(){
  if(inField) return;                 // already fighting — resuming a peek, stay put
  inField=true;
  setFrozen(false);
  setDead(false);
  deathT=0;
  hideKillscreen();
  hideOverview();
  respawn();
  syncZone();
  setHp(MAX_HP);
  refillAll();
  mouseDown=false;
  renderScores();
  sendNet({t:'spawn',
    x:+player.x.toFixed(2), y:+player.y.toFixed(2), z:+player.z.toFixed(2), yaw:+player.yaw.toFixed(3)});
}

/* A reconnect opens a fresh socket that the server treats as a lobby spectator,
   so forget any prior field standing before the welcome decides whether to retake it. */
export function resetFieldState(){ inField=false; }

/* Back to the lobby — the round is over (server `lobby`), or the server bounced
   our spawn (`denied`). Clear the battle overlays, drop the live tally, and raise
   the menu, where the freshly-updated leaderboard waits. We're a safe spectator
   until we take the field again. */
export function handleLobby(){
  inField=false;
  hideOverview();
  hideKillscreen();
  deathT=0;
  setDead(false);
  setFrozen(false);
  mouseDown=false;
  for(const s of scoresMap.values()){ s.score=0; s.deaths=0; }
  renderScores();
  showMenu();
}

/* Raising the lobby menu mid-fight: a felled player (the killscreen is counting)
   may bow out to the lobby and become a safe spectator. A living one stays in the
   fight — Esc must never be an escape hatch from a losing trade. */
onMenuShown(()=>{
  if(inField && deathT>0){
    inField=false;
    deathT=0;
    setDead(false);
    hideKillscreen();
    sendNet({t:'spectate'});
  }
});

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
  // full-auto: keep firing while mouse is held — but at most one shot per drawn
  // frame. A slow frame runs several sub-steps (main.ts), and the shots they'd
  // fire leave in one burst; the server spaces shots by arrival time and drops
  // all but the first, which would cost ammo and a tracer for nothing.
  if(mouseDown && WEAPONS[weaponIdx].full && !frozen && shotFrame!==renderer.info.render.frame) fire();
  gunKick=Math.max(0, gunKick-dt*5);
  // ease spread toward its floor (moving/running/airborne raise it; firing bloomed it),
  // then map the cone half-angle to a screen-pixel gap at the live FOV so the crosshair
  // stays an honest spread gauge even through the run-zoom.
  const sp=WEAPONS[weaponIdx].spread;
  const movingNow=Math.hypot(vel.x,vel.z)>.4, running=keys.has('ShiftLeft')||keys.has('ShiftRight');
  let floor=sp.base;
  if(!player.grounded) floor+=sp.air;
  else if(movingNow)   floor+=running?sp.run:sp.walk;
  // aiming down sights: allowed unless reloading, sprinting, or a grenade is in
  // hand. The raise runs linearly over the weapon's `ads.time` and is eased into
  // aim.t, which everything else (zoom, mouse, walk, spread, gun pose) reads.
  const ads=WEAPONS[weaponIdx].ads;
  const wantAim=aim.held && reloadT<=0 && !(running && movingNow) && !isCooking();
  adsLin=Math.max(0, Math.min(1, adsLin+(wantAim?1:-1)*dt/ads.time));
  aim.t=adsLin*adsLin*(3-2*adsLin);
  aim.fov=ads.fov; aim.speed=ads.speed;
  floor*=1+(ads.spread-1)*aim.t;
  // A held spray gets no relief: until `settle` has passed since the last shot the
  // cone only grows (it still rises to a higher floor if you start moving), and
  // heat keeps counting rounds. Once off the trigger, both recover.
  sinceShot+=dt;
  const settled=sinceShot>=(sp.settle||0);
  if(spread<floor || settled) spread += (floor-spread)*Math.min(1,dt*sp.recover);
  spread = Math.min(spread, sp.max);
  if(settled) fireHeat = Math.max(0, fireHeat-dt*(sp.cool||0));  // spray heat bleeds off once the trigger's let off
  const gapPx=Math.tan(spread)/Math.tan(camera.fov*Math.PI/360)*(renderer.domElement.clientHeight/2);
  crosshairEl.style.setProperty('--gap', gapPx.toFixed(1)+'px');
  // the sights take over from the crosshair as the gun comes up
  crosshairEl.style.opacity=String(Math.max(0, 1-aim.t*1.6));
  const w=WEAPONS[weaponIdx];
  const fm=fpModels[weaponIdx];
  const b=fm.base;
  const dip=reloadT>0 ? Math.sin((1-reloadT/w.reloadTime)*Math.PI) : 0;
  // hip pose → sight pose; at the eye the stock is in the shoulder, so the gun
  // bobs and kicks less (the kick still reads, mostly as a jolt back)
  const a=aim.t, p=w.ads.pos, kick=gunKick*(1+(w.ads.kick-1)*a), sway=1-a*.8;
  fm.group.position.set(b.x+(p.x-b.x)*a,
    b.y+(p.y-b.y)*a+Math.sin(walkPhase)*.006*sway-dip*.16,
    b.z+(p.z-b.z)*a+kick*.09);
  fm.group.rotation.x=kick*.22-dip*.7;
  fm.group.rotation.z=Math.sin(walkPhase*.5)*.012*sway+dip*.25;
}
