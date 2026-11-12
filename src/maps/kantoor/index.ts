/* ============================ mp_kantoor — the office ============================ */
// A replica of a real two-storey office on an industrial estate, built from its
// floor plans and a set of photographs. The shell (structure.ts) is generated
// from the vectorised plans; the rest is dressing laid over it.
// Orientation: the entrance and the street are south (+Z), the yard north (−Z),
// the slanted facade west (−X). Horizontal distances are 2.5× life size.
import * as THREE from 'three';
import { matKPaver, matKBrick } from '../../materials';
import { createBuilder, type BuiltMap, type MapDef, type Spawn } from '../../mapkit';
import { createKit } from './kit';
import { buildStructure } from './structure';
import { buildGrounds } from './grounds';
import { buildFacade } from './facade';
import { buildScoreboard } from './scoreboard';
import { buildGroundWest } from './interior_ground_west';
import { buildGroundEast } from './interior_ground_east';
import { buildUpperWest } from './interior_upper_west';
import { buildUpperEast } from './interior_upper_east';
import { buildZones } from './callouts';

// Places to come back to life indoors, on the ground floor (a spawn carries no
// height: the game stands a player on the lowest floor under the point).
const INDOOR_SPAWNS: Spawn[] = [
  { x: 3, z: 26, yaw: 0 },                 // atrium, at the foot of the stair
  { x: 1.5, z: -10.5, yaw: 0 },            // corridor to the kantine
  { x: 15, z: -8.5, yaw: -Math.PI / 2 },   // east corridor
  { x: -4, z: -27.5, yaw: Math.PI / 2 },   // kantine
  { x: -3, z: -13.5, yaw: Math.PI / 2 },   // west office
  { x: -15.5, z: 14.5, yaw: -Math.PI / 2 },// meeting room 1
  { x: -12.5, z: 24.5, yaw: -Math.PI / 2 },// lounge
  { x: 13, z: 27, yaw: Math.PI / 2 },      // receptie
  { x: 12.5, z: -11, yaw: Math.PI },       // magazijn
  { x: 25, z: -23.5, yaw: Math.PI },       // open office
  { x: 24, z: 4, yaw: Math.PI / 2 },       // south-east office
];

function build(): BuiltMap {
  const B = createBuilder({ wallMat: matKBrick, rampMat: matKPaver });
  const k = createKit(B);

  // Order is layering: later boxes overwrite earlier ones where they overlap.
  // The grounds go down first (and bring the four boundary walls), the shell
  // stands on them, the facade dresses the shell, the furniture fills it.
  const grounds = buildGrounds(k);
  buildStructure(k);
  buildFacade(k);
  buildScoreboard(k);
  buildGroundWest(k);
  buildGroundEast(k);
  buildUpperWest(k);
  buildUpperEast(k);

  const spawns = [...grounds.spawns, ...INDOOR_SPAWNS];
  return { group: B.group, decals: B.decals, colliders: B.colliders, spawns, zones: buildZones(), bounds: B.bounds() };
}

export const kantoor: MapDef = {
  name: 'kantoor',
  label: 'mp_kantoor',
  blurb: 'Two floors of offices round a stair hall, and the car park outside.',
  menuCam: { x: -30, y: 16, z: 62, yaw: -.45, pitch: -.2 },
  env: {
    // A bright Dutch winter day: a pale, hazy blue with broken cloud. Higher
    // turbidity and low rayleigh keep the blue from soaking into everything —
    // the building is white and grey, and a saturated sky dyes it.
    sky: {
      turbidity: 6, rayleigh: 0.75,
      mieCoefficient: 0.006, mieDirectionalG: 0.8,
      cloudCoverage: 0.44, cloudDensity: 0.6,
      cloudScale: 0.006, cloudSpeed: 0.0001, cloudElevation: 0.45,
    },
    // Low and from the south-west, so the street front is the lit face.
    sunDir: [-0.35, 0.7, 0.6],
    sunColor: 0xfff0dc, sunIntensity: 2.2,
    // Most of this map is indoors, where the only light is ambient scaled by how
    // much sky a voxel sees. Too little and the offices are caves; too much and
    // the white walls bleach. The warm ground bounce is what keeps them white
    // rather than blue.
    environmentIntensity: 0.7,
    interiorMin: 0.5,              // office lighting: the rooms deep in the plan are not caves
    shadowIntensity: 0.75,
    hemiSky: 0xf0ece4, hemiGround: 0xc4b8a4, hemiIntensity: 0.7,
    fillColor: 0xd8d2c8, fillIntensity: 0.15,
    fogColor: 0xc9cfd6, fogDensity: 0.0018,
    fogHeight: 8, fogHeightFalloff: 0.1,
    exposure: 0.55,
    toneMapping: THREE.AgXToneMapping,
    groundSurface: 'stone',
    glowColor: 0xfff4dc, glowOpacity: 0.0,
    lanterns: false,
  },
  build,
};
