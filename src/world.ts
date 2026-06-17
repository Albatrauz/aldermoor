/* ============================ de_aldermoor — Dust2 ============================ */
// A pragmatic, recognizable reproduction of Counter-Strike's Dust2, built from
// the same primitive idiom as the old town. Orientation: T spawn west (−X),
// CT spawn east (+X), Bombsite A north (+Z, raised), Bombsite B south (−Z,
// reached through covered tunnels). 1 unit ≈ 1 metre.
//
// Colliders carry a vertical span (base..top) and may be ramps whose top
// interpolates along one axis — controls.js and effects.js consume this.
import * as THREE from 'three';
import { scene, mesh, uvBox } from './core';
import {
  matSand, matSandPath, matSandstone, matSandstoneDark, matConcrete,
  matCrate, matIron, matContainerBlue, matCarRed, matSandbag, matMetalDoor,
} from './materials';
import { glowTex } from './textures';

/* ============================ sky & light ============================ */
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(560, 32, 16),
  new THREE.ShaderMaterial({
    side:THREE.BackSide, depthWrite:false, fog:false,
    uniforms:{
      top:{value:new THREE.Color(0x4a78b8)},
      mid:{value:new THREE.Color(0x9fc0e0)},
      low:{value:new THREE.Color(0xe8d9b0)},
    },
    vertexShader:'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader:`varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 low;
      void main(){
        float h=normalize(vP).y;
        vec3 c = h<0.14 ? mix(low,mid,smoothstep(-0.06,0.14,h)) : mix(mid,top,smoothstep(0.14,0.6,h));
        gl_FragColor=vec4(c,1.0);
      }`
  })
);
sky.renderOrder=-3; sky.frustumCulled=false;
scene.add(sky);

const sunDir = new THREE.Vector3(0.4, 0.85, 0.3).normalize();
{ // high desert sun glow
  const glow=new THREE.Sprite(new THREE.SpriteMaterial({
    map:glowTex, color:0xfff4dc, transparent:true, opacity:.85,
    blending:THREE.AdditiveBlending, depthWrite:false, fog:false}));
  glow.position.copy(sunDir).multiplyScalar(520); glow.scale.setScalar(150); glow.renderOrder=-2;
  scene.add(glow);
}

scene.add(new THREE.HemisphereLight(0x9fc0e0, 0x8a7350, 0.9));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
sun.position.copy(sunDir).multiplyScalar(160);
sun.castShadow = true;
sun.shadow.mapSize.set(4096,4096);
sun.shadow.camera.left=-140; sun.shadow.camera.right=140;
sun.shadow.camera.top=140; sun.shadow.camera.bottom=-140;
sun.shadow.camera.near=10; sun.shadow.camera.far=420;
sun.shadow.bias=-0.0006; sun.shadow.normalBias=0.02;
scene.add(sun);
const fill = new THREE.DirectionalLight(0xb9c9de, 0.4);
fill.position.set(-60, 40, -45);
scene.add(fill);

/* ============================ ground & worn paths ============================ */
{
  const sand = mesh(new THREE.PlaneGeometry(320,260), matSand, 0,0,0, {rx:-Math.PI/2, cast:false});
  scene.add(sand);
  // lighter worn paths down the three lanes
  const path=(x,z,w,l,ry=0)=>{
    const p=mesh(new THREE.PlaneGeometry(w,l), matSandPath, x,0.02,z, {rx:-Math.PI/2, cast:false});
    p.rotation.z=ry; scene.add(p);
  };
  path(-12,0, 6,130, Math.PI/2);    // mid: T upper → CT
  path(-36,40.5, 6,68, Math.PI/2);  // long
  path(-70,12, 6,40, Math.PI/2);    // T upper approach
  path(-57,-21.5, 5,42, Math.PI/2); // upper tunnels
  path(-29,-34, 5,40, Math.PI/2);   // lower tunnels
  path(-105,0, 10,36);              // T spawn
  path(95,0, 12,40);                // CT spawn
  path(2,-34, 14,22);               // B plateau
}

/* ============================ colliders & helpers ============================ */
export const colliders = [];
const addCollider=(x,z,hx,hz,top=5,base=0)=>
  colliders.push({x,z,hx,hz,base,top,h:top,kind:'box'});
// sloped surface: top interpolates loTop→hiTop along +axis
const addRamp=(x,z,hx,hz,loTop,hiTop,axis='x')=>
  colliders.push({x,z,hx,hz,base:0,loTop,hiTop,axis,
                  top:Math.max(loTop,hiTop), h:Math.max(loTop,hiTop), kind:'ramp'});
// height of a collider's top surface at world point (px,pz)
export function colliderTopAt(c,px,pz){
  if(c.kind!=='ramp') return c.top;
  const a = c.axis==='x' ? (px-(c.x-c.hx))/(2*c.hx) : (pz-(c.z-c.hz))/(2*c.hz);
  const t = Math.max(0, Math.min(1, a));
  return c.loTop + (c.hiTop-c.loTop)*t;
}

const WH=5;          // default wall height
const WT=0.8;        // default wall thickness

// a textured box whose *base* sits at y=`base` (no collider)
function block(cx,cz,sx,sy,sz,mat=matSandstone,base=0,uv=.22){
  const m=mesh(uvBox(new THREE.BoxGeometry(sx,sy,sz),uv), mat, cx, base+sy/2, cz);
  scene.add(m);
  return m;
}
// box + matching collider
function solid(cx,cz,sx,sy,sz,mat=matSandstone,base=0){
  block(cx,cz,sx,sy,sz,mat,base);
  addCollider(cx,cz,sx/2,sz/2, base+sy, base);
}
// split [a,b] by sorted gap intervals
function spans(a,b,gaps){
  const gs=[...gaps].sort((p,q)=>p[0]-q[0]);
  const out=[]; let cur=a;
  for(const [g1,g2] of gs){ if(g1>cur+.01) out.push([cur,g1]); cur=Math.max(cur,g2); }
  if(cur<b-.01) out.push([cur,b]);
  return out;
}
// wall running along X at fixed z / along Z at fixed x, with optional gaps
function wallX(z,x1,x2,{h=WH,t=WT,gaps=[],mat=matSandstone,base=0}={}){
  for(const [a,b] of spans(x1,x2,gaps)) solid((a+b)/2, z, b-a, h-base, t, mat, base);
}
function wallZ(x,z1,z2,{h=WH,t=WT,gaps=[],mat=matSandstone,base=0}={}){
  for(const [a,b] of spans(z1,z2,gaps)) solid(x, (a+b)/2, t, h-base, b-a, mat, base);
}
// overhead beam across a doorway: passable below `under`, blocks shots above
function lintel(cx,cz,sx,sz,under=3.0,top=WH,mat=matSandstone){
  block(cx,cz,sx,top-under,sz,mat,under);
  addCollider(cx,cz,sx/2,sz/2,top,under);
}

// right-triangle wedge rising from y=0 at −x to y=h at +x
// (triangles wound counter-clockwise seen from outside — front faces out)
function wedgeGeo(w,h,d,uvScale=.25){
  const hw=w/2, hd=d/2;
  const v=[
    -hw,0,-hd,  hw,0,-hd,  hw,0,hd,   -hw,0,-hd,  hw,0,hd, -hw,0,hd,   // bottom
    -hw,0,-hd,  hw,h,hd,   hw,h,-hd,  -hw,0,-hd, -hw,0,hd,  hw,h,hd,   // slope
     hw,0,-hd,  hw,h,hd,   hw,0,hd,    hw,0,-hd,  hw,h,-hd, hw,h,hd,   // back
    -hw,0,-hd,  hw,h,-hd,  hw,0,-hd,                                   // side −z
    -hw,0,hd,   hw,0,hd,   hw,h,hd,                                    // side +z
  ];
  const g=new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v,3));
  g.computeVertexNormals();
  return uvBox(g, uvScale);
}
// walkable ramp: `facing` is the direction of ascent ('+x','-x','+z','-z')
function ramp(cx,cz,sx,sz,h,facing,mat=matConcrete){
  const along=(facing==='+x'||facing==='-x');
  const g=wedgeGeo(along?sx:sz, h, along?sz:sx);
  const ry = facing==='+x'?0 : facing==='-x'?Math.PI : facing==='+z'?-Math.PI/2 : Math.PI/2;
  scene.add(mesh(g, mat, cx,0,cz, {ry}));
  if(facing==='+x')      addRamp(cx,cz,sx/2,sz/2,0,h,'x');
  else if(facing==='-x') addRamp(cx,cz,sx/2,sz/2,h,0,'x');
  else if(facing==='+z') addRamp(cx,cz,sx/2,sz/2,0,h,'z');
  else                   addRamp(cx,cz,sx/2,sz/2,h,0,'z');
}

/* ============================ outer boundary ============================ */
wallX( 94,-122,122,{h:7,t:2,mat:matSandstoneDark});
wallX(-94,-122,122,{h:7,t:2,mat:matSandstoneDark});
wallZ(-120,-94,94,{h:7,t:2,mat:matSandstoneDark});
wallZ( 120,-94,94,{h:7,t:2,mat:matSandstoneDark});

/* ============================ T spawn (west plaza) ============================ */
// open pad around (−105,0); N exit → long/mid, S exit → tunnels.
wallX( 20,-120,-88);                                  // plaza north
wallX(-20,-120,-88);                                  // plaza south
wallZ(-88,-26,20,{t:2,gaps:[[-18,-8],[8,18]]});       // east wall + split block between exits
// a little cover on the pad
solid(-110, 8, 1.8,.8,1.8, matCrate);
solid(-112,-6, 1.8,1.6,1.8, matCrate);
solid(-103,-12, .9,1.0,.9, matCarRed);                // barrel-ish drum
solid(-101.8,-11.2, .9,1.0,.9, matIron);

/* ============================ T upper (N exit → long & mid) ============================ */
// corridor x∈[−88,−52], z∈[5,18]
wallX(18,-88,-52,{gaps:[[-78,-60]]});                 // north, opens to outside-long
wallZ(-52,5,18);                                      // east end cap
// outside long courtyard x∈[−78,−60], z∈[18,30] → long doors at z=30
wallZ(-78,18,36);
wallZ(-60,18,36);
wallX(30,-78,-60,{gaps:[[-67.25,-64.75]]});           // LONG DOORS (2.5 gap)
lintel(-66,30, 2.5, WT, 3.0, 5);
{ // open door leaves
  const leaf=(x,z,ry)=>{ const m=mesh(new THREE.BoxGeometry(1.2,2.8,.08), matMetalDoor, x,1.4,z,{ry}); scene.add(m); };
  leaf(-67.7,30.5,  .8);
  leaf(-64.3,30.5, -.8);
}
solid(-76,21, 1.8,.8,1.8, matCrate);                  // courtyard crate

/* ============================ Long A ============================ */
// corridor x∈[−70,−2], z∈[36,45]; vestibule behind the doors feeds its west end
wallX(36,-78,-2,{gaps:[[-70,-60]]});                  // long south (open over vestibule)
wallX(45,-70,-2);                                     // long north
wallZ(-70,36,45);                                     // long west cap
// blue container against the north wall, climbable via the crates beside it
solid(-58,43.2, 6,2.6,2.4, matContainerBlue);
solid(-63.7,43.2, 1.8,.8,1.8, matCrate);   // flush risers — gaps would wedge the player
solid(-61.9,43.2, 1.8,1.6,1.8, matCrate);
// barrels mid-corridor
solid(-45,43.6, .9,1.0,.9, matIron);
solid(-44,42.7, .9,1.0,.9, matCarRed);
{ // the red car, near the foot of A ramp
  const cx=-14, cz=41;
  block(cx,cz, 4.4,1.0,1.9, matCarRed, .25);
  block(cx-.4,cz, 2.2,.8,1.7, matCarRed, 1.0);
  for(const [wx,wz] of [[-1.5,-.95],[1.5,-.95],[-1.5,.95],[1.5,.95]]){
    const w=mesh(new THREE.CylinderGeometry(.34,.34,.22,10), matIron, cx+wx,.34,cz+wz,{rx:Math.PI/2});
    scene.add(w);
  }
  addCollider(cx,cz, 2.2,.95, 1.6);
}
// ramp up from long to the raised A site
ramp(-6,40.5, 8,9, 1.2, '+x', matSandstone);

/* ============================ Bombsite A (raised +1.2) ============================ */
// platform x∈[−2,28], z∈[31,57]
block(13,44, 30,1.2,26, matConcrete);
addCollider(13,44, 15,13, 1.2);
wallX(57,-2,28);                                      // site north
wallZ(-2,31,57,{gaps:[[36,45]]});                     // site west (open at long ramp)
wallZ(28,31,57,{gaps:[[31,39]]});                     // site east (open to CT ramp)
wallX(31,-2,28,{gaps:[[0,8]]});                       // site south (open to catwalk)
// A crates (jumpable risers from the 1.2 floor) + the "goose" sandbags
solid(8,48,  1.8,.8,1.8, matCrate, 1.2);
solid(9.8,48, 1.8,1.6,1.8, matCrate, 1.2);
solid(8,49.8, 1.8,1.6,1.8, matCrate, 1.2);
solid(2,38, 4,1.1,2, matSandbag, 1.2);

/* ============================ Catwalk / Short A ============================ */
// corridor x∈[0,8], z∈[5,31]; ledge floor 1.4 from z=15 to the site
wallZ(0,5,31);
wallZ(8,5,31);
ramp(4,12, 7.2,6, 1.4, '+z', matConcrete);
block(4,23, 7.2,1.4,16, matConcrete);
addCollider(4,23, 3.6,8, 1.4);

/* ============================ Mid ============================ */
// lane z∈[−5,5] from T upper (x=−57) all the way to CT spawn (x=80)
wallX( 5,-88,80,{gaps:[[-57,-52],[0,8]]});            // north (T-upper entrance, catwalk)
wallX(-5,-57,80,{gaps:[[5,11]]});                     // south (mid→B passage)
wallZ(-57,-5,5);                                      // mid west cap (under T upper ledge wall)
// MID DOORS at x=−2
wallZ(-2,-5,5,{gaps:[[-1.25,1.25]]});
lintel(-2,0, WT, 2.5, 3.0, 5);
{
  const leaf=(x,z,ry)=>{ const m=mesh(new THREE.BoxGeometry(.08,2.8,1.2), matMetalDoor, x,1.4,z,{ry}); scene.add(m); };
  leaf(-2.5, 1.7,  .8);
  leaf(-2.5,-1.7, -.8);
}
// xbox crate (T side of doors) + step-up crate
solid(-8,0, 3,1.5,3, matCrate);
solid(-10.8,1.2, 1.5,.7,1.5, matCrate);
// CT-mid choke: sandbag pinch at x≈14
solid(14, 3.4, 3,1.2,2.4, matSandbag);
solid(14,-3.4, 3,1.2,2.4, matSandbag);

/* ============================ Mid → B passage ============================ */
// drops south from mid at x∈[5,11] into the B-doors corridor
wallZ(5,-22,-5);
wallZ(11,-14,-5);

/* ============================ Tunnels (T → B) ============================ */
// S-exit pocket x∈[−88,−75], z∈[−26,−8] → upper tunnel → dogleg → lower tunnel → B
wallX(-8,-88,-75);                                    // pocket north
wallZ(-75,-17,-8);                                    // pocket east (tunnel mouth below)
wallX(-26,-88,-47);                                   // pocket/upper south
wallX(-17,-75,-39);                                   // upper north
wallZ(-39,-30,-17);                                   // dogleg east (above lower opening)
wallZ(-47,-38,-26);                                   // dogleg west
wallX(-30,-39,-12);                                   // lower north
wallX(-38,-47,-12);                                   // lower south
// crates inside (low — headroom under the ceiling)
solid(-60,-19, 1.6,.8,1.6, matCrate);
solid(-30,-32, 1.6,.8,1.6, matCrate);
solid(-43,-35.8, .9,1.0,.9, matIron);
// ceilings (base 3.8 keeps jumps clear; blocks shots over the top)
const ceil=(cx,cz,sx,sz)=>{
  block(cx,cz,sx,.7,sz, matSandstoneDark, 3.8);
  addCollider(cx,cz,sx/2,sz/2, 4.5, 3.8);
};
ceil(-57,-21.5, 36,9);                                // upper
ceil(-43,-27.5, 8,21);                                // dogleg
ceil(-29.5,-34, 35,8);                                // lower

/* ============================ Bombsite B ============================ */
// plateau x∈[−12,16], z∈[−47,−22]
wallX(-47,-12,16);                                    // south
wallZ(-12,-47,-22,{gaps:[[-38,-30]]});                // west (tunnel doorway)
lintel(-12,-34, WT, 8, 3.0, 5);
wallZ(16,-47,-22,{gaps:[[-31,-25]]});                 // east, with the B WINDOW
solid(16,-28, WT,1.2,6, matSandstone);                // window sill (hoppable)
block(16,-28, WT,2.6,6, matSandstone, 2.4);           // window head
addCollider(16,-28, WT/2,3, 5, 2.4);
// back plat (raised 1.6) + ramp
block(11,-43, 10,1.6,8, matConcrete);
addCollider(11,-43, 5,4, 1.6);
ramp(11,-36.6, 8,4.8, 1.6, '-z', matConcrete);
// B crates & sandbags
solid(-2,-40, 1.8,.8,1.8, matCrate);
solid(-.2,-40, 1.8,1.6,1.8, matCrate);
solid(-2,-38.2, 1.8,1.6,1.8, matCrate);
solid(-6,-24.5, 4,1.2,2, matSandbag);

/* ============================ B doors corridor (CT → B) ============================ */
// z∈[−22,−14] from the mid→B passage (x=5) east to CT spawn (x=80)
wallX(-14,5,80,{gaps:[[5,11]]});                      // north (mid→B drops in)
wallX(-22,-12,120,{gaps:[[8,16],[30,38]]});           // south: B doors + window-yard entry
lintel(12,-22, 8, WT, 3.0, 5);                        // B doors arch
// window yard x∈[16,40], z∈[−32,−22] (looks into B through the window)
wallX(-32,16,40);
wallZ(40,-32,-22);
solid(24,-28, 1.8,.8,1.8, matCrate);

/* ============================ CT → A connector ============================ */
// CT spawn → north leg → west corridor → ramp up to A site east edge
wallX(39,28,92);                                      // corridor north
wallX(31,28,84);                                      // corridor south
wallZ(84,22,31);                                      // leg west
wallZ(92,22,39);                                      // leg east
ramp(32,35, 8,8, 1.2, '-x', matSandstone);            // CT ramp up to A
solid(50,37.6, 1.8,.8,1.8, matCrate);
solid(60,32.4, .9,1.0,.9, matIron);

/* ============================ CT spawn (east) ============================ */
wallX( 22,80,120,{gaps:[[84,92]]});                   // north (gate to A connector)
wallZ(80,-22,22,{gaps:[[-22,-14],[-5,5]]});           // west (B corridor, mid)
// concrete cover blocks
solid(95,10, 3,1,3, matConcrete);
solid(98,-8, 3,1,3, matConcrete);
solid(108,2, 2,.8,2, matConcrete);

/* ============================ skyline decoration (no colliders) ============================ */
{
  const spots=[
    [-100, 104, 26,12,16],[ -40,102, 18,16,14],[ 30,106, 30,10,20],[ 90,103, 22,14,15],
    [-100,-104, 24,14,15],[ -30,-103, 20,11,16],[ 45,-106, 28,15,18],[100,-102, 18,10,14],
    [ 128, 50, 16,13,22],[ 128,-40, 18,16,20],[-128, 55, 18,12,18],[-128,-50, 16,15,20],
  ];
  for(const [x,z,w,h,d] of spots){
    block(x,z,w,h,d, matSandstoneDark);
    if(h>13){ // a dome on the taller blocks
      const dome=mesh(new THREE.SphereGeometry(Math.min(w,d)*.38, 14, 9, 0, Math.PI*2, 0, Math.PI/2),
        matConcrete, x,h,z);
      scene.add(dome);
    }
  }
  // a couple of minarets
  for(const [x,z] of [[-115,108],[70,-112],[132,8]]){
    scene.add(mesh(new THREE.CylinderGeometry(1.6,2.2,26,10), matSandstone, x,13,z));
    scene.add(mesh(new THREE.ConeGeometry(2.4,5,10), matSandstoneDark, x,28.5,z));
  }
}

/* ============================ spawn points ============================ */
// Curated open-floor spots across the whole map. yaw faces into play
// (forward = (−sin yaw, −cos yaw)). controls.js snaps feet to the surface.
export const SPAWNS=[
  {x:-105, z:0,    yaw:-Math.PI/2},  // T spawn → east
  {x:-70,  z:11.5, yaw:-Math.PI/2},  // T upper → east
  {x:-69,  z:24,   yaw: Math.PI},    // outside long → north to the doors
  {x:-40,  z:40.5, yaw:-Math.PI/2},  // long A → east
  {x: 13,  z:44,   yaw: Math.PI/2},  // bombsite A plat → west
  {x:  4,  z:7,    yaw: Math.PI},    // catwalk foot → north
  {x:-20,  z:0,    yaw:-Math.PI/2},  // mid → east
  {x: 22,  z:0,    yaw: Math.PI/2},  // CT mid → west
  {x:-57,  z:-21.5,yaw:-Math.PI/2},  // upper tunnels → east
  {x:-29,  z:-34,  yaw:-Math.PI/2},  // lower tunnels → east
  {x:  2,  z:-33,  yaw:-Math.PI/2},  // bombsite B → east
  {x: 30,  z:-18,  yaw: Math.PI/2},  // B doors corridor → west
  {x: 55,  z:35,   yaw: Math.PI/2},  // CT→A connector → west
  {x: 95,  z:2,    yaw: Math.PI/2},  // CT spawn → west
];

/* ============================ per-frame ambient animation ============================ */
// High noon in the desert: nothing flickers. Kept because main.js calls it.
export function updateAmbient(_time?: number){}
