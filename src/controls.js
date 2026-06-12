/* ============================ player & controls ============================ */
// First-person movement, look, jumping and the intro/menu gate. Owns the player
// state and the circle-vs-AABB collision against the town's colliders.
// `walkPhase` and `introVisible` are exported as live bindings so the gun
// viewmodel (combat) and zone/toast logic can read them without owning them.
import { canvas, camera, EYE } from './core.js';
import { colliders } from './world.js';
import { ac } from './audio.js';

export const player={x:0, z:38.5, y:EYE, vy:0, yaw:0, pitch:0, grounded:true};
export const vel={x:0,z:0};
export const keys=new Set();
export let walkPhase=0;

addEventListener('keydown',e=>{
  if(['Space','ArrowUp','ArrowDown'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if(e.code==='Space' && player.grounded && !introVisible && !frozen){ player.vy=4.6; player.grounded=false; }
});
addEventListener('keyup',e=>keys.delete(e.code));

const intro=document.getElementById('intro');
export let introVisible=true;
// exported as live bindings so the gun can tell whether the player has control
export let locked=false, dragLook=false;
// frozen while the end-of-round overview screen is up: no walking, looking or firing
export let frozen=false;
export function setFrozen(v){ frozen=v; }
export function hideIntro(){ intro.classList.add('hidden'); introVisible=false; }
function showIntro(){ intro.classList.remove('hidden'); introVisible=true; }

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
  if(introVisible||frozen) return;
  if(locked || (dragLook&&dragging)){
    player.yaw   -= e.movementX*0.0023;
    player.pitch -= e.movementY*0.0023;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch));
  }
});

/* circle-vs-AABB collision */
function collide(){
  const r=.55;
  for(let pass=0;pass<2;pass++){
    for(const c of colliders){
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
  player.x=Math.max(-95,Math.min(95,player.x));
  player.z=Math.max(-95,Math.min(100,player.z));
}

/* per-frame: walk the player and drive the camera, or drift gently behind the menu */
export function update(dt, time){
  if(!introVisible && !frozen){
    const run=keys.has('ShiftLeft')||keys.has('ShiftRight');
    const speed=run?7.4:4.2;
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
    const wx=(fx*-iz + rx*ix)/len*speed*( (iz!==0||ix!==0)?1:0 );
    const wz=(fz*-iz + rz*ix)/len*speed*( (iz!==0||ix!==0)?1:0 );
    vel.x += (wx-vel.x)*Math.min(1,dt*10);
    vel.z += (wz-vel.z)*Math.min(1,dt*10);
    player.x += vel.x*dt;
    player.z += vel.z*dt;
    collide();

    // vertical
    if(!player.grounded){
      player.vy -= 13*dt;
      player.y += player.vy*dt;
      if(player.y<=EYE){ player.y=EYE; player.vy=0; player.grounded=true; }
    }
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
  }else if(introVisible){
    // gentle establishing drift behind the menu
    const a=time*.04;
    camera.position.set(Math.sin(a)*2, EYE+1.2, 38+Math.cos(a*1.3));
    camera.rotation.set(-.04, Math.sin(a*.5)*.18, 0);
  }
}
