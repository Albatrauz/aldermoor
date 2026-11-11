/* ============================ player & controls ============================ */
// First-person movement, look, jumping and the intro/menu gate. Owns the player
// state. Collision is a circle against the voxel world: the same rules the old
// box colliders enforced (step up anything knee-high, be stopped by anything
// taller, walk under anything above head height), now asked of whatever voxels
// are actually still standing — so a breach shot through a wall is a doorway.
// `walkPhase` and `introVisible` are exported as live bindings so the gun
// viewmodel (combat) and zone/toast logic can read them without owning them.
import { canvas, camera, EYE } from './core';
import { SPAWNS, menuCam } from './world';
import { floorUnder, standHeight, resolveCircle, confine, solidAt } from './voxel';
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
// fired the moment the lobby menu is raised from the field — net listens so it
// can tell the server we've stepped off (a player reading the menu is no target)
const menuListeners=new Set<()=>void>();
export function onMenuShown(fn:()=>void){ menuListeners.add(fn); return ()=>menuListeners.delete(fn); }
// blur the name field on entry — a focused (invisible) input would swallow
// every gameplay key via its stopPropagation handler below
export function hideIntro(){ intro.classList.add('hidden'); introVisible=false; nameInput.blur(); }
function showIntro(){
  const wasVisible=introVisible;
  intro.classList.remove('hidden'); introVisible=true;
  if(!wasVisible) for(const fn of menuListeners){ try{ fn(); }catch{ /* ignore */ } }
}
// raise the lobby menu from gameplay (round over, or stepping out) and free the
// cursor so the leaderboard to the right is readable
export function showMenu(){ showIntro(); try{ document.exitPointerLock?.(); }catch{ /* not locked */ } }

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
  if(introVisible || locked || dragLook) return;
  // same fallback as the enter button: no pointer lock here (an embedded pane) → drag to look
  const p=canvas.requestPointerLock?.();
  if(p && p.catch) p.catch(()=>{ dragLook=true; });
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

/* floor height under (px,pz): the highest surface that is within step reach */
function groundAt(px,pz,feet){
  return floorUnder(px,pz,feet+STEP_UP);
}

// The eye height the camera actually sits at. Voxel floors come in quarter-metre
// steps — a ramp is a staircase now — and snapping the view up each one would
// judder. The player's real height (what collides, what goes on the wire) still
// snaps; only the view eases after it.
let eyeY=EYE;

/* place the player at a random spawn point, facing into play */
export function respawn(){
  const s=SPAWNS[Math.floor(Math.random()*SPAWNS.length)];
  // Scatter a metre around the spot — but try a few scatters and keep the one
  // that lands lowest, stopping at the first on open ground. A spawn point that
  // grazes a wall or a crate would otherwise sometimes put you ON it; and on top
  // of an interior wall is above the ceiling, which is a room with no door.
  let low=Infinity;
  for(let n=0;n<12 && low>0;n++){
    const x=s.x+Math.random()*2-1, z=s.z+Math.random()*2-1, h=standHeight(x,z,PLAYER_H);
    if(h<low){ low=h; player.x=x; player.z=z; }
  }
  player.yaw=s.yaw; player.pitch=0;
  vel.x=vel.z=0;
  walkPhase=0;                          // a fresh stride, not the one we died mid-step of
  camera.fov=70; camera.updateProjectionMatrix();  // drop any run-zoom held from death
  snapDown();
}

/* drop the player onto whatever surface is under (x,z) — used by debug teleport.
   Picks the lowest spot with standing room, so a spawn under a roof lands on the
   floor rather than on the roof. */
export function snapDown(){
  const g=standHeight(player.x, player.z, PLAYER_H);
  player.feet=g; player.y=g+EYE; player.vy=0; player.grounded=true;
  eyeY=player.y;
}

respawn(); // first life starts somewhere random too

/* circle-vs-voxel collision, gated by the player's vertical span: anything
   solid above step height and below head height is a wall */
function collide(){
  resolveCircle(player, R_PLAYER, player.feet+STEP_UP, player.feet+PLAYER_H);
  confine(player, R_PLAYER, player.feet+STEP_UP);   // …and the outer walls go all the way up
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
    // Walls can be a single voxel thick once they've been shot at, so a long
    // frame is walked in short strides rather than one leap that could clear one.
    const strides=Math.max(1, Math.min(6, Math.ceil(Math.hypot(vel.x,vel.z)*dt/.2)));
    for(let s=0;s<strides;s++){
      player.x += vel.x*dt/strides;
      player.z += vel.z*dt/strides;
      collide();
    }

    // vertical: glue to the floor, step up/down small heights, otherwise fall
    const ground=groundAt(player.x, player.z, player.feet);
    if(player.grounded){
      if(player.feet<=ground+STEP_UP) player.feet=ground;     // glue / small step
      else { player.grounded=false; player.vy=0; }            // walked off an edge
    }else{
      player.vy -= 13*dt;
      // bumping the head on whatever is overhead ends the rise
      if(player.vy>0 && solidAt(player.x, player.feet+PLAYER_H+player.vy*dt, player.z)) player.vy=0;
      player.feet += player.vy*dt;
      if(player.feet<=ground){ player.feet=ground; player.vy=0; player.grounded=true; }
    }
    player.y=player.feet+EYE;
    const moving=Math.hypot(vel.x,vel.z)>.4;
    if(moving && player.grounded){
      walkPhase += dt*(run?11:7.5);
    }
    const bob=moving&&player.grounded ? Math.sin(walkPhase)*.045 : 0;
    // ease the view over voxel steps while walking; in the air (or after a real
    // drop) it simply follows
    if(player.grounded && Math.abs(player.y-eyeY)<.6) eyeY += (player.y-eyeY)*Math.min(1,dt*18);
    else eyeY=player.y;
    camera.position.set(player.x, eyeY+bob, player.z);
    camera.rotation.set(player.pitch, player.yaw, 0);
    const targetFov=run&&moving?75:70;
    camera.fov += (targetFov-camera.fov)*Math.min(1,dt*5);
    camera.updateProjectionMatrix();
  }else{
    // gentle establishing drift behind the menu — the active map sets the vantage
    const a=time*.04;
    camera.position.set(menuCam.x+Math.sin(a)*5, menuCam.y+Math.cos(a*.7)*1.5, menuCam.z+Math.cos(a*1.3)*4);
    camera.rotation.set(menuCam.pitch, menuCam.yaw+Math.sin(a*.5)*.22, 0);
  }
}
