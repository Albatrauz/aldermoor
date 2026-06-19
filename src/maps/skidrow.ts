/* ============================ mp_aldermoor_skidrow — Skidrow ============================ */
// A cold, snow-dusted city block after Modern Warfare 2's Skidrow. Two big
// apartment buildings — tall facades carrying rows of windows — flank a central
// street that runs the long (X) axis between the two team spawns (west −X /
// east +X). Three parallel lanes: the back alley north (+Z), the street, and
// the back alley south (−Z); each apartment is enterable, linking street to
// alley through ground-floor doorways. 1 unit ≈ 1 metre.
import * as THREE from 'three';
import { mesh } from '../core';
import {
  matSnow, matSnowPath, matAsphalt, matBrick, matConcrete,
  matFacadeConcrete, matFacadeBrick, matFacadeWorn,
  matRoofTar, matSnowCap, matIron, matRust, matCrate,
  matDumpster, matCarBlue, matCarGrey, matCarRed, matContainerBlue,
} from '../materials';
import { createBuilder, type BuiltMap, type MapDef } from '../mapkit';

function build(): BuiltMap {
  const B = createBuilder({ wallMat: matConcrete, rampMat: matConcrete });
  const { add, block, solid, wallX, wallZ, lintel, ramp, addCollider } = B;

  /* ============================ ground ============================ */
  {
    add(mesh(new THREE.PlaneGeometry(360, 280), matSnow, 0, 0, 0, { rx: -Math.PI / 2, cast: false }));
    // ploughed asphalt down the central street, snow-trodden sidewalks beside it
    const road = mesh(new THREE.PlaneGeometry(152, 16), matAsphalt, 0, 0.015, 0, { rx: -Math.PI / 2, cast: false });
    add(road);
    const walk = (x: number, z: number, w: number, l: number, ry = 0) => {
      const p = mesh(new THREE.PlaneGeometry(w, l), matSnowPath, x, 0.03, z, { rx: -Math.PI / 2, cast: false });
      p.rotation.z = ry; add(p);
    };
    walk(0, 11, 152, 5);    // north sidewalk
    walk(0, -11, 152, 5);   // south sidewalk
    walk(-55, 0, 30, 30);   // west spawn yard
    walk(55, 0, 30, 30);    // east spawn yard
    walk(0, 49, 152, 8);    // north alley
    walk(0, -49, 152, 8);   // south alley
  }

  /* ============================ outer boundary ============================ */
  wallX(54, -76, 76, { h: 9, t: 2, mat: matBrick });
  wallX(-54, -76, 76, { h: 9, t: 2, mat: matBrick });
  wallZ(-76, -54, 54, { h: 9, t: 2, mat: matBrick });
  wallZ(76, -54, 54, { h: 9, t: 2, mat: matBrick });

  /* ============================ building helpers ============================ */
  // A window: a hoppable sill below, a head beam above, an open slit between to
  // peek and shoot through. `horiz` runs the opening along X (a wall at fixed z).
  const windowHole = (cx: number, cz: number, span: number, top: number, mat: THREE.Material, horiz = true) => {
    const sx = horiz ? span : 2, sz = horiz ? 2 : span;
    solid(cx, cz, sx, 1.0, sz, mat);                         // sill (waist-high, blocks the walk)
    block(cx, cz, sx, top - 2.6, sz, mat, 2.6);              // head (fills up to the facade top)
    addCollider(cx, cz, sx / 2, sz / 2, top, 2.6);
  };
  // A flat interior ceiling that seals the ground floor; the facade rises on
  // above it (just exterior skin). Headroom clears a jump; blocks shots over walls.
  const ceiling = (cx: number, cz: number, sx: number, sz: number, at = 4.6) => {
    block(cx, cz, sx, .7, sz, matRoofTar, at);
    addCollider(cx, cz, sx / 2, sz / 2, at + .7, at);
  };
  // Rooftop dressing (no colliders — it lives above the play volume): a snow-cap
  // slab, a setback penthouse, a water tank and a thin mast for the skyline.
  const rooftop = (cx: number, cz: number, sx: number, sz: number, roofY: number, capMat: THREE.Material) => {
    block(cx, cz, sx + .6, .4, sz + .6, matSnowCap, roofY);                 // snow on the parapet
    block(cx, cz, sx * .55, 5, sz * .55, capMat, roofY + .4);               // penthouse setback
    block(cx, cz, sx * .55 + .4, .3, sz * .55 + .4, matSnowCap, roofY + 5.4);
    add(mesh(new THREE.CylinderGeometry(2.2, 2.4, 4, 12), matRust, cx + sx * .28, roofY + 2.4, cz - sz * .22)); // water tank
    add(mesh(new THREE.BoxGeometry(.3, 8, .3), matIron, cx - sx * .3, roofY + 4, cz + sz * .25));               // aerial mast
  };

  /* ============================ NORTH apartment (concrete high-rise) ============================ */
  // footprint x∈[−34,34], z∈[14,44]; tall concrete facades carrying windows.
  {
    const H = 24, F = matFacadeConcrete;
    // south facade (faces the street): two doors + a window
    wallX(14, -34, 34, { h: H, t: 2, mat: F, gaps: [[-26, -20], [-4, 0], [10, 16]] });
    lintel(-23, 14, 6, 2, 4.0, H, F);                        // door arches
    lintel(13, 14, 6, 2, 4.0, H, F);
    windowHole(-2, 14, 4, H, F, true);                       // street-facing window
    // north facade (faces the back alley): two doors
    wallX(44, -34, 34, { h: H, t: 2, mat: F, gaps: [[-24, -18], [16, 22]] });
    lintel(-21, 44, 6, 2, 4.0, H, F);
    lintel(19, 44, 6, 2, 4.0, H, F);
    // end walls, each with a flanking door to the spawn yards
    wallZ(-34, 14, 44, { h: H, t: 2, mat: F, gaps: [[20, 26]] });
    lintel(-34, 23, 2, 6, 4.0, H, F);
    wallZ(34, 14, 44, { h: H, t: 2, mat: F, gaps: [[20, 26]] });
    lintel(34, 23, 2, 6, 4.0, H, F);
    ceiling(0, 29, 66, 30);
    rooftop(0, 29, 66, 30, H, matFacadeWorn);
    // interior: a partition with a doorway splits the hall, plus cover
    wallZ(0, 16, 42, { h: 4.6, t: .8, mat: matConcrete, gaps: [[26, 32]] });
    solid(-18, 22, 2, 3, 2, matConcrete);                    // pillars
    solid(18, 36, 2, 3, 2, matConcrete);
    solid(-26, 38, 1.8, 1.6, 1.8, matCrate);                 // stacked crates by the alley door
    solid(-24.2, 38, 1.8, .8, 1.8, matCrate);
    solid(24, 18, 1.8, .8, 1.8, matCrate);                   // cover by the street door
  }

  /* ============================ SOUTH apartment (brick walk-up) ============================ */
  // footprint x∈[−30,30], z∈[−44,−14]; brick facades, a touch lower than the north.
  {
    const H = 20, F = matFacadeBrick;
    wallX(-14, -30, 30, { h: H, t: 2, mat: F, gaps: [[-22, -16], [-2, 2], [12, 18]] });
    lintel(-19, -14, 6, 2, 4.0, H, F);
    lintel(15, -14, 6, 2, 4.0, H, F);
    windowHole(0, -14, 4, H, F, true);
    wallX(-44, -30, 30, { h: H, t: 2, mat: F, gaps: [[-18, -12], [12, 18]] });
    lintel(-15, -44, 6, 2, 4.0, H, F);
    lintel(15, -44, 6, 2, 4.0, H, F);
    wallZ(-30, -44, -14, { h: H, t: 2, mat: F, gaps: [[-38, -32]] });
    lintel(-30, -35, 2, 6, 4.0, H, F);
    wallZ(30, -44, -14, { h: H, t: 2, mat: F, gaps: [[-38, -32]] });
    lintel(30, -35, 2, 6, 4.0, H, F);
    ceiling(0, -29, 58, 30);
    rooftop(0, -29, 58, 30, H, matFacadeBrick);
    wallX(-29, -30, 30, { h: 4.6, t: .8, mat: matConcrete, gaps: [[-6, 2]] });
    solid(-16, -22, 2, 3, 2, matConcrete);
    solid(16, -36, 2, 3, 2, matConcrete);
    solid(22, -40, 1.8, 1.6, 1.8, matCrate);
    solid(20.2, -40, 1.8, .8, 1.8, matCrate);
  }

  /* ============================ street porch (a perch over the north door) ============================ */
  // An exterior stair climbs to a low porch roof you can hold the street from.
  {
    const top = 3.4;
    block(13, 9, 12, top, 6, matConcrete);                   // porch slab (z just south of the facade)
    addCollider(13, 9, 6, 3, top);
    ramp(4, 9, 5, 6, top, '+x', matConcrete);                // stair up from the west
    // a low parapet rail along the street edge of the porch
    solid(13, 6.4, 12, .9, .4, matConcrete, top);
  }

  /* ============================ central street cover ============================ */
  // a bus-length container broadside across mid, with a gap to weave through
  solid(-2, 2.5, 12, 3, 3, matContainerBlue);
  solid(2, -2.5, 10, 3, 3, matContainerBlue);
  block(-2, 2.5, 12.4, .3, 3.4, matSnowCap, 3);              // snow on the roofs
  block(2, -2.5, 10.4, .3, 3.4, matSnowCap, 3);
  // parked cars (body + cabin + wheels), scattered down the street as hard cover
  const car = (cx: number, cz: number, ry: number, body: THREE.Material) => {
    const g = new THREE.Group();
    g.position.set(cx, 0, cz); g.rotation.y = ry;
    const b1 = mesh(new THREE.BoxGeometry(4.4, 1.0, 1.9), body, 0, .55, 0); g.add(b1);
    const b2 = mesh(new THREE.BoxGeometry(2.3, .8, 1.7), body, -.3, 1.25, 0); g.add(b2);
    g.add(mesh(new THREE.BoxGeometry(4.6, .25, 2.0), matSnowCap, 0, 1.68, 0)); // snow on the roof
    for (const [wx, wz] of [[-1.5, -.95], [1.5, -.95], [-1.5, .95], [1.5, .95]])
      g.add(mesh(new THREE.CylinderGeometry(.34, .34, .25, 10), matIron, wx, .34, wz, { rx: Math.PI / 2 }));
    add(g);
    const hx = Math.abs(Math.cos(ry)) * 2.2 + Math.abs(Math.sin(ry)) * .95;
    const hz = Math.abs(Math.sin(ry)) * 2.2 + Math.abs(Math.cos(ry)) * .95;
    addCollider(cx, cz, hx, hz, 1.5);
  };
  car(-38, 4, .15, matCarRed);
  car(-30, -4.5, -.1, matCarGrey);
  car(34, 4.5, Math.PI - .1, matCarBlue);
  car(42, -3.8, .05, matCarGrey);
  // dumpsters tucked by the apartment doors
  const dumpster = (cx: number, cz: number) => {
    solid(cx, cz, 3, 1.7, 2, matDumpster);
    block(cx, cz, 3.1, .25, 2.1, matSnowCap, 1.7);
  };
  dumpster(-23, -9.5);
  dumpster(19, -9.5);
  dumpster(-21, 9.6);
  // concrete jersey barriers angled for cover near mid
  solid(-12, -1, .8, 1.1, 4, matConcrete);
  solid(12, 1, .8, 1.1, 4, matConcrete);

  /* ============================ west spawn yard ============================ */
  {
    // a little storefront kiosk to break sightlines, crates and a snowed-in van
    solid(-58, 16, 8, 5, 6, matFacadeWorn);                  // storefront block
    block(-58, 12.6, 8.2, .9, .8, matRust, 2.2);             // awning lip
    solid(-62, -18, 7, 3.2, 4, matRust);                     // box van
    block(-62, -18, 7.2, .3, 4.2, matSnowCap, 3.2);
    solid(-48, 0, 1.8, 1.6, 1.8, matCrate);
    solid(-46.2, 0, 1.8, .8, 1.8, matCrate);
    solid(-46, 1.8, 1.8, .8, 1.8, matCrate);
    solid(-68, 6, .9, 1.0, .9, matIron);                     // barrel
  }

  /* ============================ east spawn yard ============================ */
  {
    solid(58, -16, 8, 5, 6, matFacadeWorn);
    block(58, -12.6, 8.2, .9, .8, matRust, 2.2);
    solid(62, 18, 7, 3.2, 4, matRust);
    block(62, 18, 7.2, .3, 4.2, matSnowCap, 3.2);
    solid(48, 0, 1.8, 1.6, 1.8, matCrate);
    solid(46.2, 0, 1.8, .8, 1.8, matCrate);
    solid(46, -1.8, 1.8, .8, 1.8, matCrate);
    solid(68, -6, .9, 1.0, .9, matIron);
  }

  /* ============================ back alleys ============================ */
  // cover strung along the two flanking lanes behind the apartments
  dumpster(-40, 49);
  solid(8, 49, 1.8, 1.6, 1.8, matCrate);
  solid(9.8, 49, 1.8, .8, 1.8, matCrate);
  solid(40, 50, 6, 2.4, 2.2, matContainerBlue);
  dumpster(38, -49);
  solid(-8, -49, 1.8, 1.6, 1.8, matCrate);
  solid(-9.8, -49, 1.8, .8, 1.8, matCrate);
  solid(-40, -50, 6, 2.4, 2.2, matContainerBlue);

  /* ============================ city skyline beyond the walls (no colliders) ============================ */
  {
    const towers: [number, number, number, number, number, THREE.Material][] = [
      [-100, 90, 28, 38, 22, matFacadeConcrete], [-30, 96, 22, 30, 20, matFacadeBrick],
      [40, 100, 30, 46, 24, matFacadeWorn], [104, 84, 24, 34, 20, matFacadeConcrete],
      [-104, -88, 26, 34, 22, matFacadeBrick], [-20, -98, 24, 42, 20, matFacadeConcrete],
      [50, -94, 30, 36, 22, matFacadeWorn], [108, -80, 22, 30, 18, matFacadeBrick],
      [-130, 30, 22, 50, 20, matFacadeConcrete], [-130, -40, 24, 44, 18, matFacadeWorn],
      [132, 20, 26, 48, 22, matFacadeBrick], [132, -50, 22, 40, 18, matFacadeConcrete],
    ];
    for (const [x, z, w, h, d, m] of towers) {
      block(x, z, w, h, d, m);
      block(x, z, w + .8, .5, d + .8, matSnowCap, h);        // snow cap
    }
  }

  // Spawn spots, yaw facing into play (forward = (−sin yaw, −cos yaw)).
  const spawns = [
    { x: -66, z: 0, yaw: -Math.PI / 2 },     // west spawn → east down the street
    { x: -58, z: 22, yaw: -Math.PI / 2 },    // west yard, north flank
    { x: -58, z: -22, yaw: -Math.PI / 2 },   // west yard, south flank
    { x: 66, z: 0, yaw: Math.PI / 2 },       // east spawn → west
    { x: 58, z: 22, yaw: Math.PI / 2 },
    { x: 58, z: -22, yaw: Math.PI / 2 },
    { x: -16, z: 29, yaw: -Math.PI / 2 },    // inside north apartment
    { x: 22, z: 29, yaw: Math.PI / 2 },
    { x: -16, z: -29, yaw: -Math.PI / 2 },   // inside south apartment
    { x: 18, z: -29, yaw: Math.PI / 2 },
    { x: -30, z: 49, yaw: -Math.PI / 2 },    // north back alley
    { x: 30, z: 49, yaw: Math.PI / 2 },
    { x: -30, z: -49, yaw: -Math.PI / 2 },   // south back alley
    { x: 30, z: -49, yaw: Math.PI / 2 },
    { x: 0, z: 9, yaw: Math.PI / 2 },        // the street porch
  ];

  // Location callouts; specific spots first so they win the overlap test.
  const zones = [
    { x: 0, z: 9, r: 7, name: 'Porch' },
    { x: 0, z: 29, r: 18, name: 'North Apartments' },
    { x: 0, z: -29, r: 16, name: 'South Apartments' },
    { x: 0, z: 49, r: 10, name: 'North Alley' },
    { x: 0, z: -49, r: 10, name: 'South Alley' },
    { x: -58, z: 16, r: 8, name: 'Storefront' },
    { x: 58, z: -16, r: 8, name: 'Far Storefront' },
    { x: -60, z: 0, r: 18, name: 'West Spawn' },
    { x: 60, z: 0, r: 18, name: 'East Spawn' },
    { x: 0, z: 0, r: 22, name: 'The Street' },
  ];

  return { group: B.group, colliders: B.colliders, spawns, zones };
}

export const skidrow: MapDef = {
  name: 'skidrow',
  label: 'mp_skidrow',
  blurb: 'A snow-choked city block of tall apartments and a long, cover-strewn street.',
  menuCam: { x: -58, y: 11, z: 0, yaw: -Math.PI / 2, pitch: -.12 },
  env: {
    skyTop: 0x6c7884, skyMid: 0x97a2ac, skyLow: 0xc3cace,
    sunColor: 0xdce4ee, sunIntensity: 1.5, sunDir: [0.25, 0.9, 0.35],
    hemiSky: 0xaeb8c2, hemiGround: 0x55585c, hemiIntensity: 1.05,
    fillColor: 0xc2ccd6, fillIntensity: 0.35,
    fogColor: 0xb6bec6, fogDensity: 0.0045,
    exposure: 1.05,
    glowColor: 0xdfe6ee, glowOpacity: 0.0,
  },
  build,
};
