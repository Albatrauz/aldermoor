/* ============================ core setup ============================ */
// Renderer, scene, camera, the deterministic RNG used for town layout, and the
// low-level geometry helpers. Everything else builds on this foundation.
import * as THREE from 'three';

export const EYE = 1.65; // eye height of a standing villager

export const canvas = document.getElementById('scene');
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

export const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x584a63, 0.0105);

export const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 700);
camera.rotation.order = 'YXZ';

/* deterministic rng for layout */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const rand = mulberry32(1347);
const R = (lo,hi)=>lo+rand()*(hi-lo);
const pick = a=>a[Math.floor(rand()*a.length)];
const mr = (lo,hi)=>lo+Math.random()*(hi-lo); // texture-only randomness
export { rand, R, pick, mr };

/* ============================ geometry helpers ============================ */
export function uvBox(geo, scale){
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position;
  const uv = new Float32Array(p.count*2);
  const a=new THREE.Vector3(), b=new THREE.Vector3(), c=new THREE.Vector3();
  const e1=new THREE.Vector3(), e2=new THREE.Vector3(), n=new THREE.Vector3();
  for(let i=0;i<p.count;i+=3){
    a.fromBufferAttribute(p,i); b.fromBufferAttribute(p,i+1); c.fromBufferAttribute(p,i+2);
    n.copy(e1.copy(b).sub(a)).cross(e2.copy(c).sub(a));
    const ax=Math.abs(n.x), ay=Math.abs(n.y), az=Math.abs(n.z);
    for(let j=0;j<3;j++){
      const v=[a,b,c][j]; let u,w;
      if(ax>=ay&&ax>=az){u=v.z;w=v.y}
      else if(ay>=ax&&ay>=az){u=v.x;w=v.z}
      else {u=v.x;w=v.y}
      uv[(i+j)*2]=u*scale; uv[(i+j)*2+1]=w*scale;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv,2));
  return g;
}
export function prismGeo(w,h,d,uvScale=0.45){
  const hw=w/2, hd=d/2;
  const v=[
    -hw,0,hd,  hw,0,hd,  0,h,hd,
     hw,0,-hd, -hw,0,-hd, 0,h,-hd,
    -hw,0,-hd, -hw,0,hd, 0,h,hd,   -hw,0,-hd, 0,h,hd, 0,h,-hd,
     hw,0,hd,  hw,0,-hd, 0,h,-hd,   hw,0,hd, 0,h,-hd, 0,h,hd,
    -hw,0,-hd, hw,0,-hd, hw,0,hd,  -hw,0,-hd, hw,0,hd, -hw,0,hd
  ];
  const g=new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v,3));
  g.computeVertexNormals();
  return uvBox(g, uvScale);
}
export function mesh(geo, mat, x,y,z, opts={}){
  const m=new THREE.Mesh(geo,mat);
  m.position.set(x,y,z);
  if(opts.ry) m.rotation.y=opts.ry;
  if(opts.rx) m.rotation.x=opts.rx;
  if(opts.rz) m.rotation.z=opts.rz;
  m.castShadow = opts.cast!==false;
  m.receiveShadow = opts.receive!==false;
  return m;
}
