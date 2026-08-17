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
import { updateParticles } from './particles';
import { updateWeather } from './weather';
import * as net from './net';
import * as quality from './quality';   // dev frame-time monitor (backquote toggles it)
import './stats';            // reactive leaderboard + career (no-op without Convex)

// Timer over Clock: Clock warns on construction from r183, and Timer takes the
// timestamp requestAnimationFrame already hands us instead of calling
// performance.now() a second time. getDelta() is in seconds either way.
const clock=new THREE.Timer();
let time=0;

function frame(dt){
  time+=dt;
  controls.update(dt, time);   // movement / menu drift + camera
  zones.update(dt);            // zone toasts
  combat.update(dt);           // handgonne viewmodel
  updateFx(dt);                // tracers, flashes, smoke puffs, impacts
  updateParticles(dt);         // GPU debris — just advances the shader's clock
  updateWeather(dt);           // snow / dust, box snapped to the camera
  world.updateAmbient(time);   // ambient animation (a no-op at high noon)
  villagers.updateRemotes(dt); // interpolate fellow travellers
  renderer.render(scene,camera);
  quality.sample(dt);          // after the render: info.render resets on each render()
}
function animate(ts?: number){
  requestAnimationFrame(animate);
  clock.update(ts);
  frame(Math.min(clock.getDelta(), .05));
}
animate();

/* ============================ shader pre-warming ============================ */
// Three compiles a shader program the first time a given material/light/geometry
// combination is actually drawn. Measured: firing the first shot took the program
// count from 25 to 27, i.e. two compiles mid-firefight — exactly the wrong moment.
// The same happens the first time a player joins and their rig is drawn.
//
// compileAsync walks the scene and builds everything it can ahead of time, off
// the critical path. The effect pools already live in the scene (they are just
// invisible), so briefly revealing them is what lets the compiler see them at all
// — an invisible object is skipped by the renderer and therefore never compiled.
async function prewarm(){
  const hidden: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (!o.visible) { o.visible = true; hidden.push(o); }
  });
  try {
    await renderer.compileAsync(scene, camera);
  } catch { /* a warm-up failure must never keep the game from starting */ }
  for (const o of hidden) o.visible = false;
}
// After the first frames, so it never competes with getting something on screen.
setTimeout(prewarm, 400);

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
  setMap: world.setMap,                   // jump to a named map (offline / debug)
  rotateMap: world.rotateMap,             // advance to the next map in the rotation
  get map(){ return world.currentMapName; },
  get pos(){ return [controls.player.x, controls.player.z]; },
  get player(){ return controls.player; },
  step(n=1,dt=1/60){ for(let i=0;i<n;i++) frame(dt); }, // drive frames headlessly
  perf: quality.stats,                    // frame time + draw counts
  showPerf: quality.showPerf,             // on-screen overlay (also: backquote)
  renderer, sun: world.sun,               // handles for A/B-ing lighting costs
  kill(id){ villagers.killRemote(id); },                 // topple a fellow traveller (death-anim check)

  get me(){ return {id:net.myId, name:net.myName, connected:!!net.net}; },
  get remotes(){ return [...villagers.remotes.entries()].map(([id,v])=>({id, name:v.name,
    x:+v.cur.x.toFixed(2), y:+v.cur.y.toFixed(2), z:+v.cur.z.toFixed(2),
    deadT:+(v.deadT||0).toFixed(2), rotX:+v.group.rotation.x.toFixed(2),
    tagWorld:v.tag.matrixWorld.elements.slice(12,15).map(n=>+n.toFixed(2))})); },
};
