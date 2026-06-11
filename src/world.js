/* ============================ the town of Aldermoor ============================ */
// Builds the entire static scene — sky, lighting, ground, every building, wall,
// prop, torch and particle system — as a one-time side effect on import.
//
// IMPORTANT: the order of construction below must not change. Layout is driven by
// the seeded RNG (`rand`/`R`/`pick` from core), so reordering any build step
// reshuffles the whole town. `updateAmbient` drives the per-frame flicker/sway.
import * as THREE from 'three';
import { scene, rand, R, pick, mesh, prismGeo, uvBox } from './core.js';
import {
  matCobble, matGrass, matDirt, matStone, matStone2, matPlank, matDarkWood,
  matIron, matLitWin, matLitWin2, matDarkWin, matFoliage, matFoliage2,
  matGoldTrim, wallMats, roofMats, stripeMats,
} from './materials.js';
import {
  clonedTex, stoneTex, plankTex, thatchTex, parchTex, signTex,
  glowTex, flameTex, smokeTex, moonTex, archWinTex, roseTex,
} from './textures.js';

/* ============================ sky & light ============================ */
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(560, 32, 16),
  new THREE.ShaderMaterial({
    side:THREE.BackSide, depthWrite:false, fog:false,
    uniforms:{
      top:{value:new THREE.Color(0x1b2244)},
      mid:{value:new THREE.Color(0x73465e)},
      low:{value:new THREE.Color(0xd98a4e)},
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

{ // stars
  const n=650, pos=new Float32Array(n*3);
  for(let i=0;i<n;i++){
    const y=R(.2,.97), th=R(0,Math.PI*2), r=Math.sqrt(1-y*y);
    pos[i*3]=Math.cos(th)*r*540; pos[i*3+1]=y*540; pos[i*3+2]=Math.sin(th)*r*540;
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos,3));
  const stars=new THREE.Points(g, new THREE.PointsMaterial({
    color:0xcdd6ff, size:1.7, sizeAttenuation:false, transparent:true, opacity:.8,
    fog:false, depthWrite:false}));
  stars.renderOrder=-2;
  scene.add(stars);
}
const sunDir = new THREE.Vector3(-55, 24, 30).normalize();
{ // setting-sun glow + moon
  const glow=new THREE.Sprite(new THREE.SpriteMaterial({
    map:glowTex, color:0xff9a4a, transparent:true, opacity:.8,
    blending:THREE.AdditiveBlending, depthWrite:false, fog:false}));
  glow.position.copy(sunDir).multiplyScalar(530); glow.scale.setScalar(240); glow.renderOrder=-2;
  scene.add(glow);
  const core=new THREE.Sprite(glow.material.clone());
  core.material.color.set(0xffe3b0); core.material.opacity=.9;
  core.position.copy(sunDir).multiplyScalar(528); core.scale.setScalar(80); core.renderOrder=-2;
  scene.add(core);
  const moon=new THREE.Sprite(new THREE.SpriteMaterial({
    map:moonTex, transparent:true, opacity:.95, depthWrite:false, fog:false}));
  moon.position.set(230, 260, -300); moon.scale.setScalar(38); moon.renderOrder=-2;
  scene.add(moon);
}

scene.add(new THREE.HemisphereLight(0x65689e, 0x46342a, 0.55));
const sun = new THREE.DirectionalLight(0xff9750, 2.4);
sun.position.copy(sunDir).multiplyScalar(90);
sun.castShadow = true;
sun.shadow.mapSize.set(2048,2048);
sun.shadow.camera.left=-65; sun.shadow.camera.right=65;
sun.shadow.camera.top=65; sun.shadow.camera.bottom=-65;
sun.shadow.camera.near=10; sun.shadow.camera.far=220;
sun.shadow.bias=-0.0006; sun.shadow.normalBias=0.02;
scene.add(sun);
const fill = new THREE.DirectionalLight(0x33406e, 0.55);
fill.position.set(45, 35, -50);
scene.add(fill);

/* ============================ ground ============================ */
{
  const grass = mesh(new THREE.PlaneGeometry(440,440), matGrass, 0,0,0, {rx:-Math.PI/2, cast:false});
  scene.add(grass);
  const cobbles = mesh(new THREE.PlaneGeometry(86,86), matCobble, 0,0.02,0, {rx:-Math.PI/2, cast:false});
  scene.add(cobbles);
  const road = mesh(new THREE.PlaneGeometry(7,62), matDirt, 0,0.03,73, {rx:-Math.PI/2, cast:false});
  scene.add(road);
}

/* ============================ colliders & registries ============================ */
export const colliders = [];
const addCollider=(x,z,hx,hz,h=5)=>colliders.push({x,z,hx,hz,h});
const torches=[], swaySigns=[], flutterFlags=[], smokeEmitters=[];

/* ============================ torch ============================ */
function addTorch(x,z){
  const g=new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(.06,.08,2.3,7), matDarkWood, 0,1.15,0));
  g.add(mesh(new THREE.CylinderGeometry(.13,.10,.26,7), matIron, 0,2.36,0));
  const flame=new THREE.Sprite(new THREE.SpriteMaterial({
    map:flameTex, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false}));
  flame.scale.set(.6,.95,1); flame.position.set(0,2.75,0);
  g.add(flame);
  const light=new THREE.PointLight(0xff9038, 16, 17, 2);
  light.position.set(0,2.7,0);
  g.add(light);
  g.position.set(x,0,z);
  scene.add(g);
  torches.push({light, flame, phase:R(0,9), base:16});
  addCollider(x,z,.25,.25,2.4);
}

/* ============================ houses ============================ */
function addWindow(parent, x,y,z, ry, lit){
  const w=new THREE.Group();
  const glass = mesh(new THREE.PlaneGeometry(.6,.78),
    lit ? (rand()<.5?matLitWin:matLitWin2) : matDarkWin, 0,0,0, {cast:false});
  w.add(glass);
  w.add(mesh(new THREE.PlaneGeometry(.26,.8), matDarkWood, -.47,0,.005, {cast:false}));
  w.add(mesh(new THREE.PlaneGeometry(.26,.8), matDarkWood,  .47,0,.005, {cast:false}));
  w.add(mesh(new THREE.BoxGeometry(.86,.07,.1), matDarkWood, 0,-.45,.03));
  w.position.set(x,y,z); w.rotation.y=ry;
  parent.add(w);
}
function buildHouse(x,z,rotY,opt={}){
  const g=new THREE.Group();
  const w=opt.tavern?6.4:R(4.6,6.2), d=opt.tavern?5.8:R(4.4,5.6);
  const twoStory = opt.tavern || rand()>0.28;
  const h1=R(2.5,2.9), h2=twoStory?R(2.2,2.6):0;
  const wallMat=pick(wallMats), roofMat=pick(roofMats);
  const jet = twoStory? .7 : 0;

  g.add(mesh(new THREE.BoxGeometry(w,h1,d), wallMat, 0,h1/2,0));
  if(twoStory) g.add(mesh(new THREE.BoxGeometry(w+jet,h2,d+jet*.8), pick(wallMats), 0,h1+h2/2,0));
  const roofH=R(2.1,3.0)*(w/5.6);
  g.add(mesh(prismGeo(w+1.3, roofH, d+1.1), roofMat, 0,h1+h2,0));

  // door + step
  const doorX = R(-w/4,w/4);
  g.add(mesh(new THREE.PlaneGeometry(1.05,1.95), matPlank, doorX,0.98,d/2+0.02, {cast:false}));
  g.add(mesh(new THREE.BoxGeometry(1.35,.16,.12), matDarkWood, doorX,2.02,d/2+0.05));
  g.add(mesh(new THREE.BoxGeometry(1.3,.13,.55), matStone, doorX,.065,d/2+.25));

  // windows
  addWindow(g, -Math.sign(doorX||1)*w/4, 1.55, d/2+0.02, 0, rand()<.5);
  if(twoStory){
    addWindow(g, -w/4, h1+h2/2, (d+jet*.8)/2+0.02, 0, rand()<.6);
    addWindow(g,  w/4, h1+h2/2, (d+jet*.8)/2+0.02, 0, rand()<.6);
    if(rand()<.6) addWindow(g, (w+jet)/2+0.02, h1+h2/2, 0, Math.PI/2, rand()<.5);
    if(rand()<.6) addWindow(g, -(w+jet)/2-0.02, h1+h2/2, 0, -Math.PI/2, rand()<.5);
  }

  // chimney
  if(rand()<0.62 || opt.tavern){
    const cx=w*0.27*(rand()<.5?-1:1);
    const cm=mesh(new THREE.BoxGeometry(.55,1.5,.55), matStone2, cx, h1+h2+roofH*.55, 0);
    g.add(cm);
    if(smokeEmitters.length<6) smokeEmitters.push({obj:cm, off:1.0, sprites:[], phase:R(0,9)});
  }

  if(opt.tavern){
    const arm=mesh(new THREE.BoxGeometry(.09,.09,1.25), matIron, doorX+1.5, h1+0.55, d/2+0.6);
    g.add(arm);
    const pivot=new THREE.Group();
    pivot.position.set(doorX+1.5, h1+0.5, d/2+1.1);
    const board=mesh(new THREE.PlaneGeometry(1.25,.95),
      new THREE.MeshStandardMaterial({map:signTex('Ye Gilded Boar'), roughness:.85, side:THREE.DoubleSide}),
      0,-.62,0);
    pivot.add(board);
    g.add(pivot);
    swaySigns.push({pivot, phase:R(0,9)});
  }

  g.position.set(x,0,z);
  g.rotation.y = rotY + R(-0.035,0.035);
  scene.add(g);

  const s=Math.abs(Math.sin(rotY));
  const pad=.55+jet/2;
  const hh=h1+h2+roofH;
  if(s<0.3)      addCollider(x,z, w/2+pad, d/2+pad, hh);
  else if(s>0.7 && Math.abs(Math.cos(rotY))<0.3) addCollider(x,z, d/2+pad, w/2+pad, hh);
  else { const m=Math.max(w,d)/2+pad; addCollider(x,z,m,m,hh); }
  return g;
}

const houseSpots = [
  // main street, south of square
  [-8.5,14, Math.PI/2],[-8.5,21, Math.PI/2],[-8.5,28, Math.PI/2],
  [ 8.5,14,-Math.PI/2],[ 8.5,21,-Math.PI/2],[ 8.5,28,-Math.PI/2],
  // main street, north of square
  [-8.5,-12, Math.PI/2],[ 8.5,-12,-Math.PI/2],
  // cross street, north side (faces +z)
  [-12,-8,0],[-20,-8,0],[-28,-8,0],[20,-8,0],[28,-8,0],
  // cross street, south side (faces -z)
  [-12,8,Math.PI],[-20,8,Math.PI],[-28,8,Math.PI],[12,8,Math.PI],[20,8,Math.PI],[28,8,Math.PI],
];
for(const [hx,hz,ry] of houseSpots) buildHouse(hx,hz,ry);
buildHouse(12,-8,0,{tavern:true});
for(const [hx,hz] of [[17,17],[-17,17],[-17,-17],[17,-17]]){
  buildHouse(hx,hz, Math.atan2(-hx,-hz));
}

/* ============================ church ============================ */
{
  const g=new THREE.Group();
  const naveGeo=uvBox(new THREE.BoxGeometry(9,6,14), 0.22);
  g.add(mesh(naveGeo, matStone2, 0,3,0));
  g.add(mesh(prismGeo(10.4,3.8,15.4,0.3), roofMats[1], 0,6,0));
  // tower
  const towerGeo=uvBox(new THREE.BoxGeometry(3.8,13,3.8), 0.22);
  g.add(mesh(towerGeo, matStone2, -6.4,6.5,5));
  const spire=mesh(new THREE.ConeGeometry(2.9,4.8,4), roofMats[1], -6.4,15.4,5, {ry:Math.PI/4});
  g.add(spire);
  g.add(mesh(new THREE.BoxGeometry(.1,1.5,.1), matGoldTrim, -6.4,18.4,5));
  g.add(mesh(new THREE.BoxGeometry(.7,.1,.1), matGoldTrim, -6.4,18.55,5));
  // belfry openings
  for(const ry of [0,Math.PI/2]){
    const b=mesh(new THREE.PlaneGeometry(1,1.5), matDarkWin, 0,0,0,{cast:false});
    const holder=new THREE.Group(); holder.add(b);
    holder.position.set(-6.4,11.5,5); holder.rotation.y=ry;
    b.position.z=1.93;
    scene.add(holder); g.add(holder);
  }
  // glowing gothic windows
  const winMat=new THREE.MeshBasicMaterial({map:archWinTex, transparent:true});
  for(let i=0;i<3;i++){
    for(const sgn of [1,-1]){
      const wm=mesh(new THREE.PlaneGeometry(1.15,2.3), winMat, sgn*4.52, 3.4, -4+i*4, {ry:sgn*Math.PI/2, cast:false});
      g.add(wm);
    }
  }
  // rose window + door (front faces +z toward town)
  const rose=mesh(new THREE.CircleGeometry(.95,24),
    new THREE.MeshBasicMaterial({map:roseTex, transparent:true}), 0,4.7,7.02, {cast:false});
  g.add(rose);
  g.add(mesh(new THREE.PlaneGeometry(1.7,2.6), matPlank, 0,1.3,7.02, {cast:false}));
  g.add(mesh(new THREE.BoxGeometry(2.2,.2,.2), matStone, 0,2.7,7.06));
  g.add(mesh(new THREE.BoxGeometry(2.4,.18,1.1), matStone, 0,.09,7.4));
  g.position.set(0,0,-26);
  scene.add(g);
  addCollider(0,-26, 5.1, 7.6, 9);
  addCollider(-6.4,-21, 2.5, 2.5, 17);

  // graveyard
  for(const [gx,gz] of [[6.5,-27.5],[7.8,-29.4],[9,-26.8],[9.8,-29],[7,-31],[10.6,-31.4]]){
    const slab=mesh(new THREE.BoxGeometry(.5,R(.55,.85),.12), matStone, gx,R(.22,.34),gz,
      {ry:R(-.3,.3), rz:R(-.12,.12)});
    scene.add(slab);
  }
}

/* ============================ town walls & gate ============================ */
{
  const WALL=42, WH=5, WT=1.4;
  const segs=[
    {x:0, z:-WALL, w:WALL*2+WT, d:WT},
    {x:-WALL, z:0, w:WT, d:WALL*2+WT},
    {x: WALL, z:0, w:WT, d:WALL*2+WT},
    {x:-(3.6+WALL)/2-0, z:WALL, w:WALL-3.6, d:WT, gx:-(WALL+3.6)/2},
    {x: (3.6+WALL)/2+0, z:WALL, w:WALL-3.6, d:WT, gx: (WALL+3.6)/2},
  ];
  for(const s of segs){
    const cx = s.gx!==undefined ? s.gx : s.x;
    const wallGeo=uvBox(new THREE.BoxGeometry(s.w,WH,s.d), 0.2);
    scene.add(mesh(wallGeo, matStone, cx, WH/2, s.z));
    addCollider(cx, s.z, s.w/2, s.d/2, WH+.9);
  }
  // crenellations
  const merlonGeo=new THREE.BoxGeometry(1.0,.9,WT*.7);
  const positions=[];
  for(let x=-WALL+1.5;x<=WALL-1.5;x+=2.6){
    positions.push([x,-WALL,0]);
    if(Math.abs(x)>5) positions.push([x,WALL,0]);
  }
  for(let z=-WALL+1.5;z<=WALL-1.5;z+=2.6){
    positions.push([-WALL,z,Math.PI/2]);
    positions.push([ WALL,z,Math.PI/2]);
  }
  const inst=new THREE.InstancedMesh(merlonGeo, matStone, positions.length);
  const dummy=new THREE.Object3D();
  positions.forEach(([px,pz,ry],i)=>{
    dummy.position.set(px, WH+.45, pz);
    dummy.rotation.set(0,ry,0);
    dummy.updateMatrix();
    inst.setMatrixAt(i,dummy.matrix);
  });
  inst.castShadow=true; inst.receiveShadow=true;
  scene.add(inst);

  // corner towers
  for(const [tx,tz] of [[-WALL,-WALL],[WALL,-WALL],[-WALL,WALL],[WALL,WALL]]){
    const towerTex=clonedTex(stoneTex,4,3);
    scene.add(mesh(new THREE.CylinderGeometry(3,3.3,8.5,12),
      new THREE.MeshStandardMaterial({map:towerTex,roughness:.95}), tx,4.25,tz));
    scene.add(mesh(new THREE.ConeGeometry(3.7,3.2,12), roofMats[1], tx,10.1,tz));
    scene.add(mesh(new THREE.CylinderGeometry(.04,.04,2.4,5), matIron, tx,12.8,tz));
    const flag=mesh(new THREE.PlaneGeometry(1.7,.85),
      new THREE.MeshBasicMaterial({color:0x6e2a24, side:THREE.DoubleSide}),
      tx+.85,13.4,tz, {cast:false});
    scene.add(flag);
    flutterFlags.push({m:flag, phase:R(0,9), ax:'z'});
    addCollider(tx,tz,3.4,3.4,11);
  }

  // gatehouse
  for(const sgn of [-1,1]){
    const gt=mesh(uvBox(new THREE.BoxGeometry(3.4,9,3.4),0.2), matStone, sgn*4.2,4.5,WALL);
    scene.add(gt);
    scene.add(mesh(new THREE.ConeGeometry(2.6,2.6,4), roofMats[1], sgn*4.2,10.3,WALL,{ry:Math.PI/4}));
    addCollider(sgn*4.2, WALL, 1.95, 1.95, 9.2);
  }
  const lintel=mesh(uvBox(new THREE.BoxGeometry(12,2.4,3.4),0.2), matStone, 0,7,WALL);
  scene.add(lintel);
  // raised portcullis teeth
  const port=mesh(new THREE.PlaneGeometry(5.4,1.6),
    new THREE.MeshStandardMaterial({color:0x1f1b17, roughness:.6, metalness:.6, side:THREE.DoubleSide}),
    0,5.1,WALL, {cast:false});
  scene.add(port);
  // heraldic banner draped on the outer face, above the arch
  const ban=mesh(new THREE.PlaneGeometry(1.9,2.5),
    new THREE.MeshBasicMaterial({color:0x55211c, side:THREE.DoubleSide}),
    0,6.6,WALL+1.78, {cast:false});
  scene.add(ban);
  flutterFlags.push({m:ban, phase:3, ax:'x'});
  scene.add(mesh(new THREE.CircleGeometry(.48,16),
    new THREE.MeshBasicMaterial({color:0x9a7d38}),
    0,6.7,WALL+1.82, {cast:false}));
}

/* ============================ market square ============================ */
export const WELL={x:3, z:1.5};
{
  const g=new THREE.Group();
  const wellTex=clonedTex(stoneTex,3,1);
  g.add(mesh(new THREE.CylinderGeometry(1.2,1.3,1.1,12),
    new THREE.MeshStandardMaterial({map:wellTex,roughness:.95}), 0,.55,0));
  g.add(mesh(new THREE.CircleGeometry(.95,12),
    new THREE.MeshStandardMaterial({color:0x06080c, roughness:.2}), 0,1.11,0, {rx:-Math.PI/2, cast:false}));
  for(const sgn of [-1,1])
    g.add(mesh(new THREE.CylinderGeometry(.07,.07,2.1,6), matDarkWood, sgn*1.05,1.6,0));
  g.add(mesh(prismGeo(3.3,1.0,2.3,0.6), roofMats[3], 0,2.6,0));
  g.add(mesh(new THREE.CylinderGeometry(.045,.045,2.0,6), matDarkWood, 0,2.45,0, {rz:Math.PI/2}));
  g.add(mesh(new THREE.CylinderGeometry(.015,.015,.8,4), matIron, 0,2.0,0));
  g.add(mesh(new THREE.CylinderGeometry(.16,.13,.24,8), matPlank, 0,1.58,0));
  g.position.set(WELL.x,0,WELL.z);
  scene.add(g);
  addCollider(WELL.x,WELL.z,1.55,1.55,1.3);
}
function addStall(x,z,ry,mat){
  const g=new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(2.6,.9,1.5), matPlank, 0,.45,0));
  for(const [px,pz] of [[-1.2,-.65],[1.2,-.65],[-1.2,.65],[1.2,.65]])
    g.add(mesh(new THREE.CylinderGeometry(.05,.05,2.4,6), matDarkWood, px,1.2,pz));
  const canopy=mesh(new THREE.PlaneGeometry(3.1,2.3), mat, 0,2.5,.1, {rx:-Math.PI/2+0.32, cast:true});
  g.add(canopy);
  // wares
  for(let i=0;i<7;i++){
    const c=pick([0xb5402e,0xd07b2a,0x8a9a3a,0xc8b44a]);
    g.add(mesh(new THREE.SphereGeometry(.1,8,6),
      new THREE.MeshStandardMaterial({color:c, roughness:.7}), R(-1,1),.97,R(-.5,.5)));
  }
  g.add(mesh(new THREE.BoxGeometry(.6,.35,.45), matPlank, R(-.9,.9),1.08,R(-.3,.3), {ry:R(0,1)}));
  g.position.set(x,0,z); g.rotation.y=ry;
  scene.add(g);
  addCollider(x,z,1.8,1.8,2.3);
}
addStall(-6.5,-2.5, 1.15, stripeMats[0]);
addStall( 6.5,-5.0,-0.95, stripeMats[1]);
addStall(-5.0, 6.5, 2.65, stripeMats[2]);

/* ============================ trees & props ============================ */
function addTree(x,z,s=1,cypress=false){
  const g=new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(.16*s,.24*s,1.6*s,7), matDarkWood, 0,.8*s,0));
  if(cypress){
    g.add(mesh(new THREE.ConeGeometry(.85*s,3.6*s,8), matFoliage2, 0,3.0*s,0));
  }else{
    g.add(mesh(new THREE.SphereGeometry(1.5*s,9,7), matFoliage, 0,2.5*s,0));
    g.add(mesh(new THREE.SphereGeometry(1.05*s,8,6), matFoliage2, .9*s,2.1*s,.3*s));
    g.add(mesh(new THREE.SphereGeometry(.95*s,8,6), matFoliage, -.8*s,2.2*s,-.4*s));
  }
  g.position.set(x,0,z); g.rotation.y=R(0,6);
  scene.add(g);
  addCollider(x,z,.5,.5,3.4);
}
const treeSpots=[[22,23],[-23,22],[23,-22],[-22,-23],[34,-13],[-34,12],[13,33],[-14,34],
  [30,30],[-31,-29],[32,-31],[-33,30],[-26,-14,1.2],[27,14,.9]];
for(const [tx,tz,ts] of treeSpots) addTree(tx,tz,ts||R(.85,1.25));
addTree(11,-31,.9,true); addTree(4.5,-33,.8,true);          // churchyard cypress
addTree(7,52,1.1); addTree(-8,59,1.3); addTree(9,74,1.2); addTree(-7,84,1.0); // along the road

function addBarrel(x,z,y=0){
  const b=mesh(new THREE.CylinderGeometry(.4,.34,.85,10),
    new THREE.MeshStandardMaterial({map:clonedTex(plankTex,2,1),roughness:.9}), x,.43+y,z);
  scene.add(b);
  if(y===0) addCollider(x,z,.5,.5,.95);
}
addBarrel(14.8,-5.4); addBarrel(15.6,-4.7); addBarrel(15.2,-5.1,.86);
addBarrel(5.6,40.4); addBarrel(-7.7,-0.6);
function addCrate(x,z,ry){
  scene.add(mesh(new THREE.BoxGeometry(.72,.72,.72), matPlank, x,.36,z,{ry}));
  addCollider(x,z,.5,.5,.8);
}
addCrate(14,-4.5,.4); addCrate(-7.4,5.9,.9); addCrate(6.2,39.3,.2);

{ // hay cart
  const g=new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(2.5,.5,1.5), matPlank, 0,.85,0));
  for(const sgn of [-1,1]){
    g.add(mesh(new THREE.CylinderGeometry(.55,.55,.12,12), matDarkWood, 0,.55,sgn*.82,{rx:Math.PI/2}));
    g.add(mesh(new THREE.CylinderGeometry(.1,.1,.2,8), matIron, 0,.55,sgn*.9,{rx:Math.PI/2}));
    g.add(mesh(new THREE.BoxGeometry(1.4,.09,.09), matDarkWood, -1.8,.7,sgn*.5,{rz:.12}));
  }
  const hay=mesh(new THREE.SphereGeometry(1,10,7),
    new THREE.MeshStandardMaterial({map:thatchTex,roughness:1}), 0,1.35,0);
  hay.scale.set(1.25,.6,.78);
  g.add(hay);
  g.position.set(-6.8,0,17); g.rotation.y=.35;
  scene.add(g);
  addCollider(-6.8,17,1.9,1.5,1.8);
}

{ // notice board near gate
  const g=new THREE.Group();
  for(const sgn of [-1,1]) g.add(mesh(new THREE.CylinderGeometry(.07,.07,2.1,6), matDarkWood, sgn*.8,1.05,0));
  g.add(mesh(new THREE.BoxGeometry(1.8,1.1,.08), matPlank, 0,1.55,0));
  g.add(mesh(prismGeo(2.0,.4,.3,1), roofMats[0], 0,2.12,0));
  const pm=new THREE.MeshStandardMaterial({map:parchTex,roughness:1});
  g.add(mesh(new THREE.PlaneGeometry(.5,.66), pm, -.4,1.55,.05,{ry:0,cast:false}));
  g.add(mesh(new THREE.PlaneGeometry(.44,.56), pm, .35,1.5,.05,{ry:0,cast:false}));
  g.position.set(4.2,0,37.5); g.rotation.y=-.4;
  scene.add(g);
  addCollider(4.2,37.5,1.0,.45,2.3);
}

function addBench(x,z,ry){
  const g=new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(1.7,.09,.45), matPlank, 0,.48,0));
  for(const sgn of [-1,1]) g.add(mesh(new THREE.BoxGeometry(.12,.48,.4), matDarkWood, sgn*.7,.24,0));
  g.position.set(x,0,z); g.rotation.y=ry;
  scene.add(g);
  addCollider(x,z,.9,.4,.55);
}
addBench(3,4.0,0.2); addBench(13.9,-4.8,Math.PI);

{ // signpost outside the gate
  const g=new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(.08,.1,2.6,7), matDarkWood, 0,1.3,0));
  const bm=new THREE.MeshStandardMaterial({map:signTex('Aldermoor ½ fur.'), roughness:.85});
  g.add(mesh(new THREE.BoxGeometry(1.5,.42,.06), bm, .5,2.2,0,{ry:-.5}));
  g.position.set(4,0,52);
  scene.add(g);
  addCollider(4,52,.3,.3,2.5);
}

/* ============================ street bunting ============================ */
{
  const cols=[0x6e2a24,0x9a7d38,0x323a52,0x39523c];
  const flagMats=cols.map(c=>new THREE.MeshBasicMaterial({color:c, side:THREE.DoubleSide}));
  function strand(x1,x2,z,y,sag){
    const pts=[];
    for(let i=0;i<=24;i++){
      const t=i/24;
      pts.push(new THREE.Vector3(x1+(x2-x1)*t, y-Math.sin(t*Math.PI)*sag, z));
    }
    scene.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({color:0x14100a})));
    const nf=9;
    for(let i=0;i<nf;i++){
      const t=(i+.5)/nf;
      const fx=x1+(x2-x1)*t, fy=y-Math.sin(t*Math.PI)*sag;
      const tri=new THREE.BufferGeometry();
      tri.setAttribute('position', new THREE.Float32BufferAttribute(
        [-.16,0,0,  .16,0,0,  0,-.44,0], 3));
      tri.computeVertexNormals();
      const f=new THREE.Mesh(tri, flagMats[i%4]);
      f.position.set(fx,fy,z);
      scene.add(f);
      flutterFlags.push({m:f, phase:i*.7+z, ax:'x'});
    }
  }
  strand(-5.6,5.6,16,4.5,.8);
  strand(-5.6,5.6,25,4.4,.7);
}

/* ============================ torch placement ============================ */
addTorch(-5.5,-5.5); addTorch(5.5,-5.5); addTorch(-5.5,5.5); addTorch(5.5,5.5);
addTorch(-3.8,40.2); addTorch(3.8,40.2);
addTorch(-3.4,45.5); addTorch(3.4,45.5);
addTorch(-3,-17.6); addTorch(3,-17.6);
addTorch(10.4,-4.4);
addTorch(-4.5,22); addTorch(4.5,22);

/* ============================ fireflies ============================ */
let fireflyGeo, fireflyBase, fireflyPhase;
{
  const n=90;
  fireflyBase=new Float32Array(n*3); fireflyPhase=new Float32Array(n);
  const pos=new Float32Array(n*3);
  for(let i=0;i<n;i++){
    const a=R(0,Math.PI*2), r=R(13,37);
    fireflyBase[i*3]=Math.cos(a)*r;
    fireflyBase[i*3+1]=R(.5,2.6);
    fireflyBase[i*3+2]=Math.sin(a)*r;
    fireflyPhase[i]=R(0,9);
  }
  fireflyGeo=new THREE.BufferGeometry();
  fireflyGeo.setAttribute('position', new THREE.BufferAttribute(pos,3));
  const pts=new THREE.Points(fireflyGeo, new THREE.PointsMaterial({
    map:glowTex, color:0xd4e06e, size:.3, sizeAttenuation:true, transparent:true,
    opacity:.75, blending:THREE.AdditiveBlending, depthWrite:false}));
  pts.frustumCulled=false;
  scene.add(pts);
}

/* ============================ chimney smoke ============================ */
const smokeWorld=new THREE.Vector3();
for(const em of smokeEmitters){
  em.obj.updateMatrixWorld(true);
  em.pos=em.obj.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0,.8,0));
  for(let i=0;i<6;i++){
    const sp=new THREE.Sprite(new THREE.SpriteMaterial({
      map:smokeTex, transparent:true, opacity:0, depthWrite:false}));
    sp.scale.setScalar(.8);
    scene.add(sp);
    em.sprites.push({sp, t0:i/6});
  }
}

/* ============================ per-frame ambient animation ============================ */
// torch flicker, sign sway, flag flutter, drifting fireflies and chimney smoke.
export function updateAmbient(time){
  // torch flicker
  for(const t of torches){
    const n=Math.sin(time*11+t.phase)*.5 + Math.sin(time*23+t.phase*2.7)*.3 + Math.sin(time*7+t.phase*5)*.2;
    t.light.intensity=t.base*(.82+.18*n);
    t.flame.scale.set(.6+.08*n, .95+.13*n, 1);
    t.flame.position.y=2.75+.03*n;
  }
  // sign sway & flag flutter
  for(const s of swaySigns){
    s.pivot.rotation.z=Math.sin(time*.9+s.phase)*.07+Math.sin(time*1.7+s.phase)*.03;
  }
  for(const f of flutterFlags){
    const v=Math.sin(time*2.2+f.phase)*.16+Math.sin(time*3.7+f.phase*2)*.06;
    if(f.ax==='x') f.m.rotation.x=v; else f.m.rotation.z=v*.8;
  }
  // fireflies
  {
    const pos=fireflyGeo.attributes.position.array;
    for(let i=0;i<fireflyPhase.length;i++){
      const p=fireflyPhase[i];
      pos[i*3]  =fireflyBase[i*3]  +Math.sin(time*.6+p)*1.3;
      pos[i*3+1]=fireflyBase[i*3+1]+Math.sin(time*.9+p*2)*.5;
      pos[i*3+2]=fireflyBase[i*3+2]+Math.cos(time*.5+p)*1.3;
    }
    fireflyGeo.attributes.position.needsUpdate=true;
  }
  // chimney smoke
  for(const em of smokeEmitters){
    for(const s of em.sprites){
      const t=((time*.11)+s.t0)%1;
      s.sp.position.set(
        em.pos.x + Math.sin(t*5+em.phase)*.35 + t*2.2,
        em.pos.y + t*6,
        em.pos.z + Math.cos(t*4+em.phase)*.25);
      s.sp.scale.setScalar(.7+t*2.8);
      s.sp.material.opacity = Math.min(t*6,1)*(1-t)*.26;
    }
  }
}
