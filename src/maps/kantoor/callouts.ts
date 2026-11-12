/* ============================ kantoor — callouts ============================ */
// The names that flash up as you walk into a place. Rooms come from the plan;
// a zone is a circle, so a long room gets a row of them down its length. Each
// is tied to its storey, or the kantine would announce itself to someone
// standing in the office above it. The first circle that contains the player
// wins: halls first, then rooms from small to large, then the open ground.
import type { Zone } from '../../mapkit';
import { ROOMS } from './structure';
import { PLOT } from './plot';

const NAMES: Record<string, string> = {
  // ground floor
  entree: 'Entree', atrium: 'Atrium', corridor_N: 'Gang naar de kantine', corridor_E: 'Gang oost',
  kantine: 'Kantine', kantoor_W1: 'Kantoor west', kantoor_W2: 'Vergaderzaal 2', kantoor_SW: 'Vergaderzaal 1',
  ontvangstruimte: 'Ontvangstruimte', receptie: 'Receptie', achterruimte: 'Kopieerhoek',
  kantoor_N: 'Kantoor noord', magazijn: 'Magazijn', kantoor_NE: 'Kantoortuin beneden', kantoor_SE: 'Kantoor zuidoost',
  toilet_lobby: 'Toiletten', washroom_N: 'Toiletten', washroom_S: 'Toiletten',
  // upper floor
  R_NW: 'Kantoor noordwest', R_W1: 'Kantoor west 1', R_W2: 'Kantoor west 2', R_W3: 'Kantoor west 3',
  R_server: 'Serverruimte', R_bergS: 'Berging', R_SW: 'Hoekkantoor zuidwest', R_SWi: 'Kantoor zuid',
  R_SEi: 'Vergaderkamer zuid', R_SE: 'Hoekkantoor zuidoost', R_E: 'Kantoor oost', R_E2: 'Glazen vergaderbox',
  R_NE: 'Kantoortuin boven', R_bergN: 'Bergruimte', R_pantry: 'Pantry',
  R_wash1: 'Toiletten boven', R_wash2: 'Toiletten boven',
};

const HALLS = new Set(['entree', 'atrium', 'corridor_N', 'corridor_E', 'toilet_lobby']);

export function buildZones(): Zone[] {
  const zones: Zone[] = [], halls: Zone[] = [];
  for (const r of ROOMS) {
    const name = NAMES[r.id];
    if (!name) continue;
    const w = r.x1 - r.x0, d = r.z1 - r.z0, alongX = w >= d;
    // circulation is cut tight and listed first, so a room's circle never claims the corridor outside its door
    const hall = HALLS.has(r.id);
    const rad = Math.max(2.5, Math.min(w, d) / 2 * (hall ? .95 : 1.05)), len = Math.max(w, d);
    const n = Math.max(1, Math.round(len / (rad * 1.5)));
    const span = r.storey === 0 ? { maxY: 4 } : { minY: 4, maxY: 9.5 };
    for (let i = 0; i < n; i++) {
      const t = (i + .5) / n;
      (hall ? halls : zones).push({ x: alongX ? r.x0 + w * t : r.cx, z: alongX ? r.cz : r.z0 + d * t, r: rad, name, ...span });
    }
  }
  zones.sort((a, b) => a.r - b.r);
  zones.unshift(...halls);
  // The gallery round the stair void, upstairs; and the open ground, last of all.
  zones.push({ x: 3, z: 12, r: 14, name: 'Galerij', minY: 4, maxY: 9.5 });
  zones.push({ x: 5.5, z: -40, r: 6, name: 'Brandtrap' });
  zones.push({ x: 3, z: 37, r: 8, name: 'Voordeur', maxY: 4 });
  zones.push({ x: 41, z: 0, r: 30, name: 'Oprit oost', maxY: 4 });
  zones.push({ x: -40, z: 0, r: 30, name: 'Oprit west', maxY: 4 });
  zones.push({ x: 0, z: (PLOT.z0 - 35) / 2, r: 40, name: 'Parkeerplaats achter', maxY: 4 });
  zones.push({ x: 0, z: 64, r: 60, name: 'Straat', maxY: 4 });
  zones.push({ x: 0, z: 0, r: 50, name: 'Dak', minY: 9.5 });
  return zones;
}
