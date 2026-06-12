/* ============================ entry point ============================ */
// Pulls the whole game together. Importing the modules below runs their one-time
// side effects (build the town, attach input, open the socket, raise the gun),
// then this file drives the single render loop and exposes the debug hook.
import * as THREE from 'three';
import { renderer, scene, camera } from './core.js';
import * as world from './world.js';
import * as controls from './controls.js';
import * as zones from './zones.js';
import * as combat from './combat.js';
import * as villagers from './villagers.js';
import { updateFx } from './effects.js';
import * as net from './net.js';

const clock=new THREE.Clock();
let time=0;

function frame(dt){
  time+=dt;
  controls.update(dt, time);   // movement / menu drift + camera
  zones.update(dt);            // zone toasts
  combat.update(dt);           // handgonne viewmodel
  updateFx(dt);                // tracers, flashes, smoke puffs
  world.updateAmbient(time);   // ambient animation (a no-op at high noon)
  villagers.updateRemotes(dt); // interpolate fellow travellers
  renderer.render(scene,camera);
}
function animate(){
  requestAnimationFrame(animate);
  frame(Math.min(clock.getDelta(), .05));
}
animate();

addEventListener('resize',()=>{
  camera.aspect=innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
});

/* debug hook for automated checks */
window.__town={
  hideIntro: controls.hideIntro,
  fire: combat.fire,
  over: combat.handleOver,        // e.g. over({winnerName:'Wat the Cooper', cap:15, restartIn:20, standings:[...]})
  restart: combat.handleRestart,
  teleport(x,z,yaw=0,pitch=0){ controls.player.x=x; controls.player.z=z; controls.player.yaw=yaw; controls.player.pitch=pitch; controls.snapDown(); },
  respawn: controls.respawn,
  get pos(){ return [controls.player.x, controls.player.z]; },
  get player(){ return controls.player; },
  step(n=1,dt=1/60){ for(let i=0;i<n;i++) frame(dt); }, // drive frames headlessly

  get me(){ return {id:net.myId, name:net.myName, connected:!!net.net}; },
  get remotes(){ return [...villagers.remotes.entries()].map(([id,v])=>({id, name:v.name, x:+v.cur.x.toFixed(2), y:+v.cur.y.toFixed(2), z:+v.cur.z.toFixed(2)})); },
};
