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
import { updateVoxels, voxelStats, voxelGrid, shotImpact, replayShots, skyAt } from './voxel';
import * as net from './net';
import * as quality from './quality';   // dev frame-time monitor (backquote toggles it)
import './stats';            // reactive leaderboard + career (no-op without Convex)

// Timer over Clock: Clock warns on construction from r183, and Timer takes the
// timestamp requestAnimationFrame already hands us instead of calling
// performance.now() a second time. getDelta() is in seconds either way.
const clock=new THREE.Timer();
let time=0;
// compileAsync yields back to the event loop. The render loop must not run
// while pooled meshes are temporarily visible, or they draw at the origin
// for a frame — and a shot fired in that window would then be hidden again
// when visibility is restored.
let prewarming = false;

// The game rules must keep real time whatever the frame rate — a player on a slow
// machine must not walk, reload or fire slower than everyone else — yet no single
// update may see more than STEP, or the player strides through a one-voxel wall
// or drops through a floor. So a long frame is simulated in equal sub-steps of at
// most STEP. At 20 fps and up that is one step with the real dt, as it always was.
// CATCH_UP bounds what one frame may consume (5 steps): a tab back from the
// background resumes rather than fast-forwarding, and a frame the simulation
// itself made slow can't snowball into ever more steps.
const STEP=.05, CATCH_UP=.25;

// Advance the game by dt seconds of real time and draw it once.
function frame(dt){
  const n=Math.max(1, Math.ceil(dt/STEP)), h=dt/n;
  for(let i=0;i<n;i++){
    time+=h;
    controls.update(h, time);  // movement / menu drift + camera
    combat.update(h);          // cooldown, reload, full-auto, viewmodel
  }
  // Once per drawn frame. Voxels re-mesh on a per-call budget (flush) and their
  // debris and falling islands collide by point samples, so they get one call
  // with the old clamp: at < 20 fps the rubble still falls in slow motion, as
  // before, rather than through the floor.
  updateVoxels(Math.min(dt, STEP)); // falling masonry, debris, re-meshing what was shot
  // The rest is presentation and takes any dt up to CATCH_UP: closed-form or
  // clamped/exponential easing, nothing that collides.
  zones.update(dt);            // zone toasts
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
  if (prewarming) return;
  frame(Math.min(clock.getDelta(), CATCH_UP));
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
  prewarming = true;
  try {
    scene.traverse((o) => {
      if (!o.visible) { o.visible = true; hidden.push(o); }
    });
    await renderer.compileAsync(scene, camera);
  } catch { /* a warm-up failure must never keep the game from starting */ }
  finally {
    for (const o of hidden) o.visible = false;
    prewarming = false;
  }
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
  voxels: voxelStats,                     // quads, pending re-meshes, live debris / falling islands
  get grid(){ return voxelGrid(); },      // the live voxel grid, for poking at from the console
  blast: shotImpact,                      // blast([x,y,z],[dx,dy,dz],len,weapon): land a shot on the world
  skyAt,                                  // skyAt(x,y,z): sky light 0–255 at a world position
  replay: replayShots,                    // replay([[w,ox,oy,oz,dx,dy,dz,len],…]): land a list of shots silently
  showPerf: quality.showPerf,             // on-screen overlay (also: backquote)
  renderer, sun: world.sun,               // handles for A/B-ing lighting costs
  kill(id){ villagers.killRemote(id); },                 // topple a fellow traveller (death-anim check)

  get me(){ return {id:net.myId, name:net.myName, connected:!!net.net}; },
  get remotes(){ return [...villagers.remotes.entries()].map(([id,v])=>({id, name:v.name,
    x:+v.cur.x.toFixed(2), y:+v.cur.y.toFixed(2), z:+v.cur.z.toFixed(2),
    deadT:+(v.deadT||0).toFixed(2), rotX:+v.group.rotation.x.toFixed(2),
    tagWorld:v.tag.matrixWorld.elements.slice(12,15).map(n=>+n.toFixed(2))})); },
};
