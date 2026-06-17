/* ============================ entry point ============================ */
// Pulls the whole game together. Importing the modules below runs their one-time
// side effects (build the town, attach input, open the socket, raise the gun),
// then this file drives the single render loop and exposes the debug hook.
import * as THREE from 'three';
import { renderer, scene, camera } from './core';
import * as world from './world';
import * as controls from './controls';
import * as zones from './zones';
import * as combat from './combat';
import * as villagers from './villagers';
import { updateFx } from './effects';
import * as net from './net';
import './stats';            // reactive leaderboard + career (no-op without Convex)

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
  kill(id){ villagers.killRemote(id); },                 // topple a fellow traveller (death-anim check)

  get me(){ return {id:net.myId, name:net.myName, connected:!!net.net}; },
  get remotes(){ return [...villagers.remotes.entries()].map(([id,v])=>({id, name:v.name,
    x:+v.cur.x.toFixed(2), y:+v.cur.y.toFixed(2), z:+v.cur.z.toFixed(2),
    deadT:+(v.deadT||0).toFixed(2), rotX:+v.group.rotation.x.toFixed(2),
    tagWorld:v.tag.matrixWorld.elements.slice(12,15).map(n=>+n.toFixed(2))})); },
};
