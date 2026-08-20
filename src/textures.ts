/* ============================ canvas textures ============================ */
// Every surface in town is painted procedurally onto a 2D canvas and uploaded
// as a CanvasTexture. `mr` (texture-only randomness) keeps each bake lively.
import * as THREE from 'three';
import { mr, renderer } from './core';

// The ground tiles a single canvas 40x34 times across a 320x260 plane, which is
// the exact case trilinear filtering handles worst: at the grazing angles a
// first-person camera spends all its time at, the far half of the floor turns
// into a shimmering mess as mip levels fight. Anisotropic filtering is the fix,
// and on any GPU that runs this game it is effectively free.
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();

function makeTex(size, fn){
  const c = document.createElement('canvas'); c.width = c.height = size;
  fn(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = MAX_ANISO;
  return t;
}
function speckle(g, s, n, alpha){
  for(let i=0;i<n;i++){
    g.globalAlpha = Math.random()*alpha;
    g.fillStyle = Math.random()<.5 ? '#000' : '#fff';
    g.fillRect(Math.random()*s, Math.random()*s, 2, 2);
  }
  g.globalAlpha = 1;
}

/* --- leftovers from the market town ---
   The town itself is gone, but the weapon models still wear its timber. */
export const plankTex = makeTex(256,(g,s)=>{
  g.fillStyle='#4a3424'; g.fillRect(0,0,s,s);
  for(let i=0;i<6;i++){
    const x=i*s/6, v=mr(-12,12);
    g.fillStyle=`rgb(${74+v|0},${52+v|0},${36+v|0})`;
    g.fillRect(x+1,0,s/6-2,s);
    g.strokeStyle='rgba(20,12,6,.6)'; g.lineWidth=2;
    g.beginPath(); g.moveTo(x,0); g.lineTo(x,s); g.stroke();
  }
  for(let i=0;i<70;i++){ // grain
    g.strokeStyle=`rgba(${mr(20,40)|0},${mr(14,28)|0},${mr(8,18)|0},.45)`;
    g.lineWidth=1;
    const x=mr(0,s), y=mr(0,s);
    g.beginPath(); g.moveTo(x,y); g.lineTo(x+mr(-3,3), y+mr(10,46)); g.stroke();
  }
});

/* --- effect sprites --- */
export const glowTex = makeTex(128,(g,s)=>{
  const r=g.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);
  r.addColorStop(0,'rgba(255,255,255,1)');
  r.addColorStop(.35,'rgba(255,255,255,.5)');
  r.addColorStop(1,'rgba(255,255,255,0)');
  g.fillStyle=r; g.fillRect(0,0,s,s);
});
export const flameTex = makeTex(128,(g,s)=>{
  const r=g.createRadialGradient(s/2,s*.62,0,s/2,s*.62,s*.5);
  r.addColorStop(0,'rgba(255,244,200,1)');
  r.addColorStop(.3,'rgba(255,180,70,.9)');
  r.addColorStop(.65,'rgba(255,100,20,.4)');
  r.addColorStop(1,'rgba(255,60,0,0)');
  g.fillStyle=r; g.fillRect(0,0,s,s);
});
export const smokeTex = makeTex(128,(g,s)=>{
  const r=g.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);
  r.addColorStop(0,'rgba(190,185,180,.85)');
  r.addColorStop(.6,'rgba(170,165,160,.30)');
  r.addColorStop(1,'rgba(160,155,150,0)');
  g.fillStyle=r; g.fillRect(0,0,s,s);
});

/* ============================ desert (Dust2) textures ============================ */
export const sandTex = makeTex(512,(g,s)=>{
  g.fillStyle='#c9a76e'; g.fillRect(0,0,s,s);
  for(let i=0;i<3000;i++){
    const v=mr(0,1);
    g.fillStyle=`rgba(${190+v*40|0},${158+v*34|0},${104+v*26|0},${mr(.12,.4)})`;
    g.fillRect(mr(0,s),mr(0,s),mr(2,5),mr(2,5));
  }
  g.strokeStyle='rgba(120,95,55,.15)'; g.lineWidth=3;   // wind ripples
  for(let i=0;i<22;i++){
    const y=mr(0,s);
    g.beginPath(); g.moveTo(0,y);
    for(let x=0;x<=s;x+=32) g.lineTo(x, y+Math.sin(x*.05+i)*6);
    g.stroke();
  }
  speckle(g,s,1500,.07);
});
export const sandPathTex = makeTex(256,(g,s)=>{
  g.fillStyle='#d8ba81'; g.fillRect(0,0,s,s);
  for(let i=0;i<900;i++){
    const v=mr(0,1);
    g.fillStyle=`rgba(${200+v*30|0},${172+v*26|0},${118+v*20|0},${mr(.15,.4)})`;
    g.fillRect(mr(0,s),mr(0,s),mr(2,4),mr(2,4));
  }
  speckle(g,s,900,.08);
});
function sandstoneMaker(base, courseH){
  return makeTex(256,(g,s)=>{
    g.fillStyle='#7a6342'; g.fillRect(0,0,s,s);
    // Even course count, height derived from it: courseH rarely divides s, and
    // a remainder either clips the last course or leaves a bare mortar band at
    // the seam. Even, because running bond alternates its offset per course.
    const rows=Math.max(2, 2*Math.round(s/courseH/2)), ch=s/rows;
    for(let y=0;y<rows;y++){
      let x=(y%2)*-20;
      while(x<s){
        const w=mr(40,72), v=base+mr(-12,12);
        g.fillStyle=`rgb(${v+26|0},${v|0},${v-34|0})`;
        g.fillRect(x+2, y*ch+2, Math.min(w,s-x)-3, ch-4);
        x+=w;
      }
    }
    speckle(g,s,1600,.10);
  });
}
export const sandstoneTex  = sandstoneMaker(168, 30);
export const sandstoneTex2 = sandstoneMaker(138, 40);
export const concreteTex = makeTex(256,(g,s)=>{
  g.fillStyle='#9a9489'; g.fillRect(0,0,s,s);
  for(let i=0;i<70;i++){
    g.fillStyle=`rgba(${mr(70,95)|0},${mr(66,90)|0},${mr(60,82)|0},${mr(.04,.09)})`;
    g.beginPath(); g.ellipse(mr(0,s),mr(0,s),mr(6,18),mr(4,13),mr(0,3),0,7); g.fill();
  }
  speckle(g,s,2400,.10);
});
// pale, sun-bleached crate planks (the medieval plankTex is far too dark for dust)
export const crateTex = makeTex(256,(g,s)=>{
  g.fillStyle='#ab8d5c'; g.fillRect(0,0,s,s);
  for(let i=0;i<6;i++){
    const x=i*s/6, v=mr(-14,14);
    g.fillStyle=`rgb(${176+v|0},${148+v|0},${102+v|0})`;
    g.fillRect(x+1,0,s/6-2,s);
    g.strokeStyle='rgba(70,52,28,.55)'; g.lineWidth=2;
    g.beginPath(); g.moveTo(x,0); g.lineTo(x,s); g.stroke();
  }
  g.strokeStyle='rgba(60,45,24,.7)'; g.lineWidth=5;   // edge battens
  g.strokeRect(4,4,s-8,s-8);
  for(let i=0;i<46;i++){
    g.strokeStyle=`rgba(${mr(90,120)|0},${mr(72,98)|0},${mr(44,66)|0},.4)`;
    g.lineWidth=1;
    const x=mr(0,s), y=mr(0,s);
    g.beginPath(); g.moveTo(x,y); g.lineTo(x+mr(-3,3), y+mr(10,40)); g.stroke();
  }
});

/* ============================ urban (Skidrow) textures ============================ */
// A cold, snow-dusted city block. Snow underfoot, ploughed asphalt down the
// middle, brick and concrete apartment facades whose window grid is baked into a
// tiling texture so a tall block reads as a high-rise the moment it's raised.
export const snowTex = makeTex(512,(g,s)=>{
  g.fillStyle='#d9e0e8'; g.fillRect(0,0,s,s);
  for(let i=0;i<2600;i++){                                  // grain: cold blue-greys + sparkle
    const v=mr(0,1);
    g.fillStyle=`rgba(${210+v*45|0},${220+v*35|0},${232+v*23|0},${mr(.12,.45)})`;
    g.fillRect(mr(0,s),mr(0,s),mr(2,5),mr(2,5));
  }
  for(let i=0;i<28;i++){                                    // soft windblown drifts
    g.fillStyle=`rgba(255,255,255,${mr(.06,.18)})`;
    g.beginPath(); g.ellipse(mr(0,s),mr(0,s),mr(30,80),mr(14,40),mr(0,3),0,7); g.fill();
  }
  for(let i=0;i<40;i++){                                    // grey slush flecks
    g.fillStyle=`rgba(${mr(120,150)|0},${mr(128,158)|0},${mr(138,168)|0},${mr(.10,.28)})`;
    g.beginPath(); g.arc(mr(0,s),mr(0,s),mr(2,6),0,7); g.fill();
  }
});
export const snowPathTex = makeTex(256,(g,s)=>{             // trodden snow — greyer, scuffed
  g.fillStyle='#b9c2cc'; g.fillRect(0,0,s,s);
  speckle(g,s,1200,.12);
  g.strokeStyle='rgba(90,98,108,.20)'; g.lineWidth=5;       // footworn ruts
  g.beginPath(); g.moveTo(s*.34,0); g.lineTo(s*.30,s); g.stroke();
  g.beginPath(); g.moveTo(s*.66,0); g.lineTo(s*.70,s); g.stroke();
});
export const asphaltTex = makeTex(256,(g,s)=>{
  g.fillStyle='#33363b'; g.fillRect(0,0,s,s);
  speckle(g,s,2600,.16);
  for(let i=0;i<26;i++){                                    // aggregate grit
    g.fillStyle=`rgba(${mr(70,100)|0},${mr(72,102)|0},${mr(78,108)|0},${mr(.1,.3)})`;
    g.beginPath(); g.arc(mr(0,s),mr(0,s),mr(1.5,4),0,7); g.fill();
  }
  g.strokeStyle='rgba(20,20,22,.5)'; g.lineWidth=2;         // cracks
  for(let i=0;i<5;i++){
    let x=mr(0,s), y=mr(0,s); g.beginPath(); g.moveTo(x,y);
    for(let k=0;k<4;k++){ x+=mr(-40,40); y+=mr(-40,40); g.lineTo(x,y); } g.stroke();
  }
  g.fillStyle='rgba(228,210,120,.55)';                      // faded centre line
  for(let y=0;y<s;y+=64) g.fillRect(s/2-4,y+12,8,34);
});
function brickMaker(base, mortar, courseH){
  return makeTex(256,(g,s)=>{
    g.fillStyle=mortar; g.fillRect(0,0,s,s);
    const rows=Math.max(2, 2*Math.round(s/courseH/2)), ch=s/rows;   // see sandstoneMaker
    for(let y=0;y<rows;y++){
      let x=(y%2)*-22;
      while(x<s){
        const w=mr(40,52), v=mr(-16,16);
        g.fillStyle=`rgb(${base[0]+v|0},${base[1]+v*.6|0},${base[2]+v*.6|0})`;
        g.fillRect(x+2, y*ch+2, Math.min(w,s-x)-4, ch-4);
        x+=w;
      }
    }
    speckle(g,s,1400,.10);
  });
}
export const brickTex = brickMaker([138,68,52], '#3a322c', 22);
// A tiling apartment facade: concrete-or-brick wall carrying one window cell that
// wraps seamlessly, so uvBox tiling turns a tall block into rows of windows.
function facadeMaker(wall, frame, glassTop, glassLow){
  return makeTex(256,(g,s)=>{
    g.fillStyle=wall; g.fillRect(0,0,s,s);
    speckle(g,s,700,.06);
    // concrete floor band along the bottom edge (reads as a slab between storeys)
    g.fillStyle='rgba(0,0,0,.16)'; g.fillRect(0,s-10,s,10);
    g.fillStyle='rgba(255,255,255,.05)'; g.fillRect(0,s-12,s,2);
    const mL=s*.22, mT=s*.16, w=s-2*mL, h=s-2*mT;           // one centred window
    g.fillStyle=frame; g.fillRect(mL-6,mT-6,w+12,h+12);     // frame / reveal
    const grd=g.createLinearGradient(0,mT,0,mT+h);
    grd.addColorStop(0,glassTop); grd.addColorStop(1,glassLow);
    g.fillStyle=grd; g.fillRect(mL,mT,w,h);
    g.strokeStyle='rgba(255,255,255,.10)'; g.lineWidth=2;   // mullions
    g.beginPath(); g.moveTo(mL+w/2,mT); g.lineTo(mL+w/2,mT+h); g.stroke();
    g.beginPath(); g.moveTo(mL,mT+h/2); g.lineTo(mL+w,mT+h/2); g.stroke();
    g.fillStyle='rgba(255,255,255,.06)';                    // a faint glint
    g.beginPath(); g.moveTo(mL+4,mT+4); g.lineTo(mL+w*.4,mT+4); g.lineTo(mL+4,mT+h*.4); g.fill();
  });
}
export const facadeConcreteTex = facadeMaker('#8b8d90', '#5a5c5f', '#39424d', '#212a33');
export const facadeBrickTex     = facadeMaker('#7c4438', '#43352c', '#39424d', '#202831');
export const facadeWornTex      = facadeMaker('#9a958c', '#6b6660', '#3c4650', '#242c34');

/* A bullet chip: a dark irregular crater with a bright rim and a few hairline
   cracks. Deliberately neutral rather than tinted, so one texture reads correctly
   on sandstone, snow, asphalt and steel alike. Clamped, not repeating — this one
   is used on a decal quad, and RepeatWrapping would wrap the soft edge. */
export const impactTex = (() => {
  const t = makeTex(64, (g, s) => {
    g.clearRect(0, 0, s, s);
    const c = s / 2;
    // soft outer smudge — kept light: a bullet leaves a mark, not a hole
    const outer = g.createRadialGradient(c, c, 0, c, c, c);
    outer.addColorStop(0, 'rgba(20,16,11,.50)');
    outer.addColorStop(.40, 'rgba(26,21,15,.24)');
    outer.addColorStop(1, 'rgba(30,25,18,0)');
    g.fillStyle = outer; g.fillRect(0, 0, s, s);
    // irregular core, so it never reads as a perfect circle
    g.fillStyle = 'rgba(16,12,9,.72)';
    g.beginPath();
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r = c * (0.20 + mr(0, .10));
      const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath(); g.fill();
    // a bright lip on one side reads as freshly exposed material
    g.strokeStyle = 'rgba(255,246,230,.30)'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(c, c, c * .26, -2.2, .5); g.stroke();
    // hairline cracks
    g.strokeStyle = 'rgba(14,11,8,.55)'; g.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const a = mr(0, Math.PI * 2), r0 = c * .22, r1 = c * mr(.42, .72);
      g.beginPath();
      g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
      g.lineTo(c + Math.cos(a + mr(-.2, .2)) * r1, c + Math.sin(a + mr(-.2, .2)) * r1);
      g.stroke();
    }
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
})();

/* ============================ derived normal maps ============================ */
// Every surface here is a flat painted canvas, so sandstone courses, brickwork
// and crate planks are lines rather than relief — the sun sweeps across them and
// nothing changes. There is no three helper for this, so we derive a tangent-space
// normal map from each texture's own luminance with a Sobel filter: bright reads
// as high, dark as low, which is exactly how these textures were painted.
//
// Two things that are easy to get wrong:
//   - A normal map is a vector, not a colour. It must NOT be tagged sRGB, or the
//     transfer curve bends the vectors and the lighting goes subtly wrong.
//   - The source tiles, so the Sobel has to wrap at the edges. Clamping instead
//     leaves a visible seam on every repeat.
const normalCache = new Map<THREE.Texture, THREE.DataTexture>();

export function normalFromTex(tex: THREE.Texture, strength = 2.0) {
  const hit = normalCache.get(tex);
  if (hit) return hit;

  const src = tex.image as HTMLCanvasElement;
  // Cap the working size: relief finer than this is invisible at play distance
  // and the Sobel is the one genuinely slow thing we do at boot.
  const s = Math.min(src.width, 256);
  const work = document.createElement('canvas');
  work.width = work.height = s;
  const wg = work.getContext('2d');
  wg.drawImage(src, 0, 0, s, s);
  const px = wg.getImageData(0, 0, s, s).data;

  const h = new Float32Array(s * s);
  for (let i = 0; i < s * s; i++) {
    h[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
  }
  const at = (x: number, y: number) => h[(((y % s) + s) % s) * s + (((x % s) + s) % s)];

  const out = new Uint8Array(s * s * 4);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1))
               - (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1));
      const dy = (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1))
               - (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1));
      // n = (-h_u, -h_v, 1). dx is already the negated u-gradient (left minus
      // right), but dy comes out of a y-down canvas, so it needs the flip.
      let nx = dx * strength, ny = -dy * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const i = (y * s + x) * 4;
      out[i]     = (nx * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * 0.5 + 0.5) * 255;
      out[i + 2] = (nz * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }

  const t = new THREE.DataTexture(out, s, s, THREE.RGBAFormat);
  // DataTexture defaults to flipY:false while the CanvasTexture albedo is
  // flipY:true. Leave it and the relief samples the mirrored row: every
  // mortar joint gets its groove somewhere other than on the joint.
  t.flipY = true;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = MAX_ANISO;
  t.needsUpdate = true;
  normalCache.set(tex, t);
  return t;
}

/* A normal map that tiles in step with an albedo clone. three gives each texture
   slot its own UV transform, so a normal map left at repeat 1x1 over a floor
   tiled 40x34 would smear one enormous bump across the whole map. */
export function normalFor(tex: THREE.Texture, rx = 1, ry = 1) {
  const n = normalFromTex(tex);
  if (rx === 1 && ry === 1) return n;
  const c = n.clone();
  c.needsUpdate = true;
  c.repeat.set(rx, ry);
  return c;
}

/* clone a texture with its own repeat — used by materials and the town builder */
export function clonedTex(t, rx, ry){ const c=t.clone(); c.needsUpdate=true; c.repeat.set(rx,ry); return c; }
