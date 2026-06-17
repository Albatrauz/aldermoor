/* ============================ player & controls ============================ */
// First-person movement, look, jumping and the intro/menu gate. Owns the player
// state and the circle-vs-AABB collision against the town's colliders.
// `walkPhase` and `introVisible` are exported as live bindings so the gun
// viewmodel (combat) and zone/toast logic can read them without owning them.
import { canvas, camera, EYE } from './core';
import { colliders, colliderTopAt, SPAWNS } from './world';
import { ac } from './audio';

// player.y is the eye height that travels over the wire; player.feet is the
// floor the player stands on. Invariant each frame: y = feet + EYE.
export const player={x:-105, z:0, feet:0, y:EYE, vy:0, yaw:-Math.PI/2, pitch:0, grounded:true};
const R_PLAYER=.55, STEP_UP=.55, PLAYER_H=1.8;
export const vel={x:0,z:0};
export const keys=new Set();
export let walkPhase=0;

addEventListener('keydown',e=>{
  if(['Space','ArrowUp','ArrowDown'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if(e.code==='Space' && player.grounded && !introVisible && !dead){ player.vy=5.2; player.grounded=false; }
});
addEventListener('keyup',e=>keys.delete(e.code));

const intro=document.getElementById('intro');
export let introVisible=true;
// exported as live bindings so the gun can tell whether the player has control
export let locked=false, dragLook=false;
// frozen while the end-of-round overview screen is up: no walking, looking or firing
export let frozen=false;
export function setFrozen(v){ frozen=v; }
// `dead` freezes the player where they fell while the killscreen counts down;
// combat owns the timer and flips it back on respawn
export let dead=false;
export function setDead(v){ dead=v; }
// blur the name field on entry — a focused (invisible) input would swallow
// every gameplay key via its stopPropagation handler below
export function hideIntro(){ intro.classList.add('hidden'); introVisible=false; nameInput.blur(); }
function showIntro(){ intro.classList.remove('hidden'); introVisible=true; }

// typing a name must not feed the game's key handlers (Space is
// preventDefault-ed above, WASD would land in `keys`) — and Enter submits
const nameInput=document.getElementById('nameInput');
nameInput.addEventListener('keydown',e=>{
  e.stopPropagation();
  if(e.key==='Enter') document.getElementById('enter').click();
});
// no keyup trap: keyups must reach the window handler so `keys` never strands
// a code that was pressed before focus moved into the field

document.getElementById('enter').addEventListener('click',()=>{
  ac(); // unlock audio on the user gesture
  hideIntro();
  const p=canvas.requestPointerLock?.({unadjustedMovement:true}) ?? canvas.requestPointerLock?.();
  if(p && p.catch) p.catch(()=>{ dragLook=true; });
  if(!canvas.requestPointerLock) dragLook=true;
});
document.addEventListener('pointerlockchange',()=>{
  locked = document.pointerLockElement===canvas;
  // Don't fall back to the menu while the overview holds the screen (e.g. the
  // browser drops the lock on Escape) — the round restart will hand control back.
  if(!locked && !dragLook && !frozen) showIntro();
});
document.addEventListener('pointerlockerror',()=>{ dragLook=true; });
canvas.addEventListener('click',()=>{
  if(!introVisible && !locked && !dragLook) canvas.requestPointerLock?.();
});
addEventListener('keydown',e=>{
  if(e.code==='Escape' && dragLook && !frozen){ introVisible ? hideIntro() : showIntro(); }
});

let dragging=false;
addEventListener('mousedown',()=>dragging=true);
addEventListener('mouseup',()=>dragging=false);
addEventListener('mousemove',e=>{
  if(introVisible || frozen || dead) return;
  if(locked || (dragLook&&dragging)){
    player.yaw   -= e.movementX*0.0023;
    player.pitch -= e.movementY*0.0023;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch));
  }
});

/* floor height under (px,pz): highest collider top that is within step reach */
function groundAt(px,pz,feet){
  let g=0;
  for(const c of colliders){
    if(px<c.x-c.hx||px>c.x+c.hx||pz<c.z-c.hz||pz>c.z+c.hz) continue;
    const t=colliderTopAt(c,px,pz);
    if(t<=feet+STEP_UP && t>g) g=t;
  }
  return g;
}

/* place the player at a random spawn point, facing into play */
export function respawn(){
  const s=SPAWNS[Math.floor(Math.random()*SPAWNS.length)];
  player.x=s.x+Math.random()*2-1;
  player.z=s.z+Math.random()*2-1;
  player.yaw=s.yaw; player.pitch=0;
  vel.x=vel.z=0;
  walkPhase=0;                          // a fresh stride, not the one we died mid-step of
  camera.fov=70; camera.updateProjectionMatrix();  // drop any run-zoom held from death
  snapDown();
}

/* drop the player onto whatever surface is under (x,z) — used by debug teleport */
export function snapDown(){
  let g=0;
  for(const c of colliders){
    if(c.base>0) continue; // skip ceilings/lintels — snap to the floor below them
    if(player.x<c.x-c.hx||player.x>c.x+c.hx||player.z<c.z-c.hz||player.z>c.z+c.hz) continue;
    const t=colliderTopAt(c,player.x,player.z);
    if(t>g) g=t;
  }
  player.feet=g; player.y=g+EYE; player.vy=0; player.grounded=true;
}

respawn(); // first life starts somewhere random too

/* circle-vs-AABB collision, gated by the player's vertical span */
function collide(){
  const r=R_PLAYER;
  for(let pass=0;pass<2;pass++){
    for(const c of colliders){
      const topHere=colliderTopAt(c, player.x, player.z);
      if(topHere<=player.feet+STEP_UP) continue;   // low enough → step onto it
      if(c.base>=player.feet+PLAYER_H) continue;   // overhang → walk under it
      const cx=Math.max(c.x-c.hx, Math.min(player.x, c.x+c.hx));
      const cz=Math.max(c.z-c.hz, Math.min(player.z, c.z+c.hz));
      let dx=player.x-cx, dz=player.z-cz;
      const d2=dx*dx+dz*dz;
      if(d2 < r*r){
        if(d2<1e-9){ dx=player.x-c.x; dz=player.z-c.z;
          if(Math.abs(dx)>Math.abs(dz)){ player.x=c.x+Math.sign(dx||1)*(c.hx+r); }
          else { player.z=c.z+Math.sign(dz||1)*(c.hz+r); }
        }else{
          const d=Math.sqrt(d2), push=(r-d)/d;
          player.x+=dx*push; player.z+=dz*push;
        }
      }
    }
  }
  player.x=Math.max(-118,Math.min(118,player.x));
  player.z=Math.max(-92,Math.min(92,player.z));
}

/* per-frame: walk the player and drive the camera, or drift gently behind the menu */
export function update(dt, time){
  if(dead){
    // hold the view exactly where we fell — no bob, no input — until we rise
    camera.position.set(player.x, player.y, player.z);
    camera.rotation.set(player.pitch, player.yaw, 0);
    return;
  }
  if(!introVisible && !frozen){
    const run=keys.has('ShiftLeft')||keys.has('ShiftRight');
    const speed=run?7.4:4.62;   // default walk bumped 10% (4.2 → 4.62); sprint unchanged
    let ix=0,iz=0;
    if(keys.has('KeyW')||keys.has('ArrowUp')) iz-=1;
    if(keys.has('KeyS')||keys.has('ArrowDown')) iz+=1;
    if(keys.has('KeyA')||keys.has('ArrowLeft')) ix-=1;
    if(keys.has('KeyD')||keys.has('ArrowRight')) ix+=1;
    const len=Math.hypot(ix,iz)||1;
    const sy=Math.sin(player.yaw), cy=Math.cos(player.yaw);
    const tx=((ix*cy - iz*sy)/len)*speed;   // wait: derive properly below
    const tz=((iz*cy + ix*sy)/len)*speed;
    // forward = (-sin yaw, -cos yaw); right = (cos yaw, -sin yaw)
    const fx=-sy, fz=-cy, rx=cy, rz=-sy;
    const wx=(fx*-iz + rx*ix)/len*speed*( (iz!==0||ix!==0)?2:0 );
    const wz=(fz*-iz + rz*ix)/len*speed*( (iz!==0||ix!==0)?2:0 );
    vel.x += (wx-vel.x)*Math.min(1,dt*10);
    vel.z += (wz-vel.z)*Math.min(1,dt*10);
    player.x += vel.x*dt;
    player.z += vel.z*dt;
    collide();

    // vertical: glue to the floor, step up/down small heights, otherwise fall
    const ground=groundAt(player.x, player.z, player.feet);
    if(player.grounded){
      if(player.feet<=ground+STEP_UP) player.feet=ground;     // glue / small step
      else { player.grounded=false; player.vy=0; }            // walked off an edge
    }else{
      player.vy -= 13*dt;
      player.feet += player.vy*dt;
      if(player.feet<=ground){ player.feet=ground; player.vy=0; player.grounded=true; }
    }
    player.y=player.feet+EYE;
    const moving=Math.hypot(vel.x,vel.z)>.4;
    if(moving && player.grounded){
      walkPhase += dt*(run?11:7.5);
    }
    const bob=moving&&player.grounded ? Math.sin(walkPhase)*.045 : 0;
    camera.position.set(player.x, player.y+bob, player.z);
    camera.rotation.set(player.pitch, player.yaw, 0);
    const targetFov=run&&moving?75:70;
    camera.fov += (targetFov-camera.fov)*Math.min(1,dt*5);
    camera.updateProjectionMatrix();
  }else{
    // gentle establishing drift behind the menu — drifting high over mid
    const a=time*.04;
    camera.position.set(-48+Math.sin(a)*5, 12+Math.cos(a*.7)*1.5, 2+Math.cos(a*1.3)*4);
    camera.rotation.set(-.16, -Math.PI/2+Math.sin(a*.5)*.22, 0);
  }
}
