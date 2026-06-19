/* ============================ de_aldermoor — Dust2 ============================ */
// A pragmatic, recognizable reproduction of Counter-Strike's Dust2, built from
// the map toolkit's primitive idiom. Orientation: T spawn west (−X), CT spawn
// east (+X), Bombsite A north (+Z, raised), Bombsite B south (−Z, reached
// through covered tunnels). 1 unit ≈ 1 metre.
import * as THREE from 'three';
import { mesh } from '../core';
import {
  matSand, matSandPath, matSandstone, matSandstoneDark, matConcrete,
  matCrate, matIron, matContainerBlue, matCarRed, matSandbag, matMetalDoor,
} from '../materials';
import { createBuilder, type BuiltMap, type MapDef } from '../mapkit';

function build(): BuiltMap {
  const B = createBuilder({ wallMat: matSandstone, rampMat: matConcrete });
  const { add, block, solid, wallX, wallZ, lintel, ramp, addCollider } = B;
  const WH = B.WH, WT = B.WT;

  /* ============================ ground & worn paths ============================ */
  {
    const sand = mesh(new THREE.PlaneGeometry(320, 260), matSand, 0, 0, 0, { rx: -Math.PI / 2, cast: false });
    add(sand);
    const path = (x: number, z: number, w: number, l: number, ry = 0) => {
      const p = mesh(new THREE.PlaneGeometry(w, l), matSandPath, x, 0.02, z, { rx: -Math.PI / 2, cast: false });
      p.rotation.z = ry; add(p);
    };
    path(-12, 0, 6, 130, Math.PI / 2);    // mid: T upper → CT
    path(-36, 40.5, 6, 68, Math.PI / 2);  // long
    path(-70, 12, 6, 40, Math.PI / 2);    // T upper approach
    path(-57, -21.5, 5, 42, Math.PI / 2); // upper tunnels
    path(-29, -34, 5, 40, Math.PI / 2);   // lower tunnels
    path(-105, 0, 10, 36);                // T spawn
    path(95, 0, 12, 40);                  // CT spawn
    path(2, -34, 14, 22);                 // B plateau
  }

  /* ============================ outer boundary ============================ */
  wallX(94, -122, 122, { h: 7, t: 2, mat: matSandstoneDark });
  wallX(-94, -122, 122, { h: 7, t: 2, mat: matSandstoneDark });
  wallZ(-120, -94, 94, { h: 7, t: 2, mat: matSandstoneDark });
  wallZ(120, -94, 94, { h: 7, t: 2, mat: matSandstoneDark });

  /* ============================ T spawn (west plaza) ============================ */
  wallX(20, -120, -88);                                  // plaza north
  wallX(-20, -120, -88);                                 // plaza south
  wallZ(-88, -26, 20, { t: 2, gaps: [[-18, -8], [8, 18]] }); // east wall + split block between exits
  solid(-110, 8, 1.8, .8, 1.8, matCrate);
  solid(-112, -6, 1.8, 1.6, 1.8, matCrate);
  solid(-103, -12, .9, 1.0, .9, matCarRed);              // barrel-ish drum
  solid(-101.8, -11.2, .9, 1.0, .9, matIron);

  /* ============================ T upper (N exit → long & mid) ============================ */
  wallX(18, -88, -52, { gaps: [[-78, -60]] });           // north, opens to outside-long
  wallZ(-52, 5, 18);                                     // east end cap
  wallZ(-78, 18, 36);
  wallZ(-60, 18, 36);
  wallX(30, -78, -60, { gaps: [[-67.25, -64.75]] });     // LONG DOORS (2.5 gap)
  lintel(-66, 30, 2.5, WT, 3.0, 5);
  {
    const leaf = (x: number, z: number, ry: number) => { const m = mesh(new THREE.BoxGeometry(1.2, 2.8, .08), matMetalDoor, x, 1.4, z, { ry }); add(m); };
    leaf(-67.7, 30.5, .8);
    leaf(-64.3, 30.5, -.8);
  }
  solid(-76, 21, 1.8, .8, 1.8, matCrate);                // courtyard crate

  /* ============================ Long A ============================ */
  wallX(36, -78, -2, { gaps: [[-70, -60]] });            // long south (open over vestibule)
  wallX(45, -70, -2);                                    // long north
  wallZ(-70, 36, 45);                                    // long west cap
  solid(-58, 43.2, 6, 2.6, 2.4, matContainerBlue);       // blue container
  solid(-63.7, 43.2, 1.8, .8, 1.8, matCrate);            // flush risers
  solid(-61.9, 43.2, 1.8, 1.6, 1.8, matCrate);
  solid(-45, 43.6, .9, 1.0, .9, matIron);
  solid(-44, 42.7, .9, 1.0, .9, matCarRed);
  {
    const cx = -14, cz = 41;                             // the red car, foot of A ramp
    block(cx, cz, 4.4, 1.0, 1.9, matCarRed, .25);
    block(cx - .4, cz, 2.2, .8, 1.7, matCarRed, 1.0);
    for (const [wx, wz] of [[-1.5, -.95], [1.5, -.95], [-1.5, .95], [1.5, .95]]) {
      const w = mesh(new THREE.CylinderGeometry(.34, .34, .22, 10), matIron, cx + wx, .34, cz + wz, { rx: Math.PI / 2 });
      add(w);
    }
    addCollider(cx, cz, 2.2, .95, 1.6);
  }
  ramp(-6, 40.5, 8, 9, 1.2, '+x', matSandstone);         // ramp up to A

  /* ============================ Bombsite A (raised +1.2) ============================ */
  block(13, 44, 30, 1.2, 26, matConcrete);
  addCollider(13, 44, 15, 13, 1.2);
  wallX(57, -2, 28);                                     // site north
  wallZ(-2, 31, 57, { gaps: [[36, 45]] });               // site west (open at long ramp)
  wallZ(28, 31, 57, { gaps: [[31, 39]] });               // site east (open to CT ramp)
  wallX(31, -2, 28, { gaps: [[0, 8]] });                 // site south (open to catwalk)
  solid(8, 48, 1.8, .8, 1.8, matCrate, 1.2);
  solid(9.8, 48, 1.8, 1.6, 1.8, matCrate, 1.2);
  solid(8, 49.8, 1.8, 1.6, 1.8, matCrate, 1.2);
  solid(2, 38, 4, 1.1, 2, matSandbag, 1.2);

  /* ============================ Catwalk / Short A ============================ */
  wallZ(0, 5, 31);
  wallZ(8, 5, 31);
  ramp(4, 12, 7.2, 6, 1.4, '+z', matConcrete);
  block(4, 23, 7.2, 1.4, 16, matConcrete);
  addCollider(4, 23, 3.6, 8, 1.4);

  /* ============================ Mid ============================ */
  wallX(5, -88, 80, { gaps: [[-57, -52], [0, 8]] });     // north (T-upper entrance, catwalk)
  wallX(-5, -57, 80, { gaps: [[5, 11]] });               // south (mid→B passage)
  wallZ(-57, -5, 5);                                     // mid west cap
  wallZ(-2, -5, 5, { gaps: [[-1.25, 1.25]] });           // MID DOORS at x=−2
  lintel(-2, 0, WT, 2.5, 3.0, 5);
  {
    const leaf = (x: number, z: number, ry: number) => { const m = mesh(new THREE.BoxGeometry(.08, 2.8, 1.2), matMetalDoor, x, 1.4, z, { ry }); add(m); };
    leaf(-2.5, 1.7, .8);
    leaf(-2.5, -1.7, -.8);
  }
  solid(-8, 0, 3, 1.5, 3, matCrate);                     // xbox crate
  solid(-10.8, 1.2, 1.5, .7, 1.5, matCrate);             // step-up crate
  solid(14, 3.4, 3, 1.2, 2.4, matSandbag);               // CT-mid choke
  solid(14, -3.4, 3, 1.2, 2.4, matSandbag);

  /* ============================ Mid → B passage ============================ */
  wallZ(5, -22, -5);
  wallZ(11, -14, -5);

  /* ============================ Tunnels (T → B) ============================ */
  wallX(-8, -88, -75);                                   // pocket north
  wallZ(-75, -17, -8);                                   // pocket east (tunnel mouth below)
  wallX(-26, -88, -47);                                  // pocket/upper south
  wallX(-17, -75, -39);                                  // upper north
  wallZ(-39, -30, -17);                                  // dogleg east (above lower opening)
  wallZ(-47, -38, -26);                                  // dogleg west
  wallX(-30, -39, -12);                                  // lower north
  wallX(-38, -47, -12);                                  // lower south
  solid(-60, -19, 1.6, .8, 1.6, matCrate);
  solid(-30, -32, 1.6, .8, 1.6, matCrate);
  solid(-43, -35.8, .9, 1.0, .9, matIron);
  const ceil = (cx: number, cz: number, sx: number, sz: number) => {
    block(cx, cz, sx, .7, sz, matSandstoneDark, 3.8);
    addCollider(cx, cz, sx / 2, sz / 2, 4.5, 3.8);
  };
  ceil(-57, -21.5, 36, 9);                               // upper
  ceil(-43, -27.5, 8, 21);                               // dogleg
  ceil(-29.5, -34, 35, 8);                               // lower

  /* ============================ Bombsite B ============================ */
  wallX(-47, -12, 16);                                   // south
  wallZ(-12, -47, -22, { gaps: [[-38, -30]] });          // west (tunnel doorway)
  lintel(-12, -34, WT, 8, 3.0, 5);
  wallZ(16, -47, -22, { gaps: [[-31, -25]] });           // east, with the B WINDOW
  solid(16, -28, WT, 1.2, 6, matSandstone);              // window sill (hoppable)
  block(16, -28, WT, 2.6, 6, matSandstone, 2.4);         // window head
  addCollider(16, -28, WT / 2, 3, 5, 2.4);
  block(11, -43, 10, 1.6, 8, matConcrete);               // back plat (raised 1.6)
  addCollider(11, -43, 5, 4, 1.6);
  ramp(11, -36.6, 8, 4.8, 1.6, '-z', matConcrete);
  solid(-2, -40, 1.8, .8, 1.8, matCrate);
  solid(-.2, -40, 1.8, 1.6, 1.8, matCrate);
  solid(-2, -38.2, 1.8, 1.6, 1.8, matCrate);
  solid(-6, -24.5, 4, 1.2, 2, matSandbag);

  /* ============================ B doors corridor (CT → B) ============================ */
  wallX(-14, 5, 80, { gaps: [[5, 11]] });                // north (mid→B drops in)
  wallX(-22, -12, 120, { gaps: [[8, 16], [30, 38]] });   // south: B doors + window-yard entry
  lintel(12, -22, 8, WT, 3.0, 5);                        // B doors arch
  wallX(-32, 16, 40);                                    // window yard
  wallZ(40, -32, -22);
  solid(24, -28, 1.8, .8, 1.8, matCrate);

  /* ============================ CT → A connector ============================ */
  wallX(39, 28, 92);                                     // corridor north
  wallX(31, 28, 84);                                     // corridor south
  wallZ(84, 22, 31);                                     // leg west
  wallZ(92, 22, 39);                                     // leg east
  ramp(32, 35, 8, 8, 1.2, '-x', matSandstone);           // CT ramp up to A
  solid(50, 37.6, 1.8, .8, 1.8, matCrate);
  solid(60, 32.4, .9, 1.0, .9, matIron);

  /* ============================ CT spawn (east) ============================ */
  wallX(22, 80, 120, { gaps: [[84, 92]] });              // north (gate to A connector)
  wallZ(80, -22, 22, { gaps: [[-22, -14], [-5, 5]] });   // west (B corridor, mid)
  solid(95, 10, 3, 1, 3, matConcrete);
  solid(98, -8, 3, 1, 3, matConcrete);
  solid(108, 2, 2, .8, 2, matConcrete);

  /* ============================ skyline decoration (no colliders) ============================ */
  {
    const spots = [
      [-100, 104, 26, 12, 16], [-40, 102, 18, 16, 14], [30, 106, 30, 10, 20], [90, 103, 22, 14, 15],
      [-100, -104, 24, 14, 15], [-30, -103, 20, 11, 16], [45, -106, 28, 15, 18], [100, -102, 18, 10, 14],
      [128, 50, 16, 13, 22], [128, -40, 18, 16, 20], [-128, 55, 18, 12, 18], [-128, -50, 16, 15, 20],
    ];
    for (const [x, z, w, h, d] of spots) {
      block(x, z, w, h, d, matSandstoneDark);
      if (h > 13) {
        const dome = mesh(new THREE.SphereGeometry(Math.min(w, d) * .38, 14, 9, 0, Math.PI * 2, 0, Math.PI / 2),
          matConcrete, x, h, z);
        add(dome);
      }
    }
    for (const [x, z] of [[-115, 108], [70, -112], [132, 8]]) {
      add(mesh(new THREE.CylinderGeometry(1.6, 2.2, 26, 10), matSandstone, x, 13, z));
      add(mesh(new THREE.ConeGeometry(2.4, 5, 10), matSandstoneDark, x, 28.5, z));
    }
  }

  // Curated open-floor spots across the whole map. yaw faces into play
  // (forward = (−sin yaw, −cos yaw)). controls.ts snaps feet to the surface.
  const spawns = [
    { x: -105, z: 0, yaw: -Math.PI / 2 },    // T spawn → east
    { x: -70, z: 11.5, yaw: -Math.PI / 2 },  // T upper → east
    { x: -69, z: 24, yaw: Math.PI },         // outside long → north to the doors
    { x: -40, z: 40.5, yaw: -Math.PI / 2 },  // long A → east
    { x: 13, z: 44, yaw: Math.PI / 2 },      // bombsite A plat → west
    { x: 4, z: 7, yaw: Math.PI },            // catwalk foot → north
    { x: -20, z: 0, yaw: -Math.PI / 2 },     // mid → east
    { x: 22, z: 0, yaw: Math.PI / 2 },       // CT mid → west
    { x: -57, z: -21.5, yaw: -Math.PI / 2 }, // upper tunnels → east
    { x: -29, z: -34, yaw: -Math.PI / 2 },   // lower tunnels → east
    { x: 2, z: -33, yaw: -Math.PI / 2 },     // bombsite B → east
    { x: 30, z: -18, yaw: Math.PI / 2 },     // B doors corridor → west
    { x: 55, z: 35, yaw: Math.PI / 2 },      // CT→A connector → west
    { x: 95, z: 2, yaw: Math.PI / 2 },       // CT spawn → west
  ];

  // Location callouts that raise a fleeting toast as you enter them.
  const zones = [
    { x: -66, z: 30, r: 6, name: 'Long Doors' },
    { x: -2, z: 0, r: 6, name: 'Mid Doors' },
    { x: 12, z: -20, r: 6, name: 'B Doors' },
    { x: 4, z: 16, r: 9, name: 'Catwalk' },
    { x: -69, z: 24, r: 8, name: 'Outside Long' },
    { x: -40, z: 40, r: 16, name: 'Long A' },
    { x: 13, z: 44, r: 14, name: 'Bombsite A' },
    { x: 32, z: 35, r: 7, name: 'A Ramp' },
    { x: -57, z: -21, r: 14, name: 'Upper Tunnels' },
    { x: -29, z: -34, r: 12, name: 'Lower Tunnels' },
    { x: 2, z: -36, r: 13, name: 'Bombsite B' },
    { x: 55, z: 35, r: 14, name: 'CT to A' },
    { x: 45, z: -18, r: 14, name: 'CT to B' },
    { x: -20, z: 0, r: 14, name: 'Mid' },
    { x: 30, z: 0, r: 12, name: 'CT Mid' },
    { x: -70, z: 12, r: 9, name: 'T Upper' },
    { x: -105, z: 0, r: 15, name: 'T Spawn' },
    { x: 95, z: 2, r: 17, name: 'CT Spawn' },
  ];

  return { group: B.group, colliders: B.colliders, spawns, zones };
}

export const dust2: MapDef = {
  name: 'dust2',
  label: 'de_aldermoor',
  blurb: 'A sun-bleached desert stronghold of long lanes and dark tunnels.',
  menuCam: { x: -48, y: 12, z: 2, yaw: -Math.PI / 2, pitch: -.16 },
  env: {
    skyTop: 0x4a78b8, skyMid: 0x9fc0e0, skyLow: 0xe8d9b0,
    sunColor: 0xfff0d8, sunIntensity: 2.6, sunDir: [0.4, 0.85, 0.3],
    hemiSky: 0x9fc0e0, hemiGround: 0x8a7350, hemiIntensity: 0.9,
    fillColor: 0xb9c9de, fillIntensity: 0.4,
    fogColor: 0xcdbb94, fogDensity: 0.0025,
    exposure: 1.15,
    glowColor: 0xfff4dc, glowOpacity: 0.85,
  },
  build,
};
