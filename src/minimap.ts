/* ============================ live minimap & tactical map ============================ */
// Two views built on top of one live top-down voxel plate (visitor.renderTopDown):
//
//   • Corner radar (#minimap): heading-up, player-centred, tucked beneath #presence.
//     Shows live voxel destruction, current zone name, storey badge on multi-storey
//     maps, rotating north marker, FOV wedge and transient gunfire/blast pings.
//   • Tactical overlay (#tacticalMap, toggled with M): full-arena top-down view with
//     deduplicated zone callout labels, player heading, live pings and storey switcher
//     on mp_kantoor.
//
// The offscreen plate is rendered right before the eye camera draws in main.ts so
// the shared drawing buffer never flickers, and geometry changes are coalesced so
// heavy firefights never stall the render loop.
import { camera } from './core';
import { player, introVisible, frozen, dead, chatOpen, onMenuShown } from './controls';
import { currentMapName, mapLabel, ZONES, onMapChange } from './world';
import { onGeometryChange } from './voxel';
import { renderTopDown, type VisitorFrame } from './visitor';

/* ---- storey slicing for multi-storey indoor maps ---- */
interface StoreyDef {
  id: string;
  label: string;
  sliceY?: number;
  minY?: number;
  maxY?: number;
}

const KANTOOR_STOREYS: StoreyDef[] = [
  { id: 'bg',  label: 'BG',  sliceY: 3.75, maxY: 4.0 },
  { id: '1e',  label: '1e',  sliceY: 8.5,  minY: 4.0, maxY: 9.5 },
  { id: 'dak', label: 'Dak', minY: 9.5 },
];

function storeysFor(mapName: string): StoreyDef[] | null {
  return mapName === 'kantoor' ? KANTOOR_STOREYS : null;
}

function storeyIndexForFeet(storeys: StoreyDef[], feet: number): number {
  for (let i = 0; i < storeys.length; i++) {
    const s = storeys[i];
    if (s.minY !== undefined && feet < s.minY) continue;
    if (s.maxY !== undefined && feet >= s.maxY) continue;
    return i;
  }
  return 0;
}

/* ---- DOM refs ---- */
const radarWrap = document.getElementById('minimap') as HTMLElement | null;
const radarCanvas = document.getElementById('minimapCanvas') as HTMLCanvasElement | null;
const radarCtx = radarCanvas?.getContext('2d') ?? null;
const radarZoneEl = document.getElementById('minimapZone') as HTMLElement | null;
const radarFloorEl = document.getElementById('minimapFloor') as HTMLElement | null;

const tacWrap = document.getElementById('tacticalMap') as HTMLElement | null;
const tacCanvas = document.getElementById('tacticalCanvas') as HTMLCanvasElement | null;
const tacCtx = tacCanvas?.getContext('2d') ?? null;
const tacTitleEl = document.getElementById('tacticalTitle') as HTMLElement | null;
const tacZoneEl = document.getElementById('tacticalZone') as HTMLElement | null;
const tacFloorEl = document.getElementById('tacticalFloor') as HTMLElement | null;

/* ---- offscreen voxel plate state ---- */
const plateCanvas = document.createElement('canvas');
const PLATE_SIZE = 576;
const REBAKE_INTERVAL = 1.25; // seconds between live destruction refreshes

let frame: VisitorFrame | null = null;
let dirty = true;
let dirtyAge = REBAKE_INTERVAL; // immediate bake on first visible frame
let bakedMap = '';
let bakedStorey = -1;
let tacticalOpen = false;
let lastZoneText = '';
let lastFloorText = '';

/* ---- transient radar pings (enemy gunfire & explosions) ---- */
interface Ping {
  x: number;
  z: number;
  kind: 'shot' | 'boom';
  born: number;
  life: number;
}
const pings: Ping[] = [];
const MAX_PINGS = 28;

export function pingMinimap(x: number, z: number, kind: 'shot' | 'boom') {
  const now = performance.now();
  // Coalesce rapid full-auto shots from nearly the same spot so an AK burst pulses cleanly.
  if (kind === 'shot') {
    for (let i = pings.length - 1; i >= 0; i--) {
      const p = pings[i];
      if (p.kind === 'shot' && now - p.born < 220 && Math.hypot(p.x - x, p.z - z) < 2.5) {
        p.x = x; p.z = z; p.born = now;
        return;
      }
    }
  }
  pings.push({ x, z, kind, born: now, life: kind === 'boom' ? 3200 : 2000 });
  if (pings.length > MAX_PINGS) pings.shift();
}

/* ---- deduplicated zone labels for the tactical map ---- */
interface ZoneLabel {
  name: string;
  x: number;
  z: number;
  minY?: number;
  maxY?: number;
}
let zoneLabels: ZoneLabel[] = [];

function rebuildZoneLabels() {
  // Multi-circle rooms (especially on mp_kantoor) share a name + storey span;
  // average their centres so each room gets one crisp callout on the full map.
  const groups = new Map<string, { name: string; sx: number; sz: number; n: number; minY?: number; maxY?: number }>();
  for (const z of ZONES) {
    const key = `${z.name}|${z.minY ?? ''}|${z.maxY ?? ''}`;
    const g = groups.get(key);
    if (g) { g.sx += z.x; g.sz += z.z; g.n++; }
    else groups.set(key, { name: z.name, sx: z.x, sz: z.z, n: 1, minY: z.minY, maxY: z.maxY });
  }
  zoneLabels = [];
  for (const g of groups.values()) {
    zoneLabels.push({ name: g.name, x: g.sx / g.n, z: g.sz / g.n, minY: g.minY, maxY: g.maxY });
  }
}
rebuildZoneLabels();

function currentZoneName(): string {
  for (const z of ZONES) {
    if (z.minY !== undefined && player.feet < z.minY) continue;
    if (z.maxY !== undefined && player.feet >= z.maxY) continue;
    const dx = player.x - z.x, dz = player.z - z.z;
    if (dx * dx + dz * dz < z.r * z.r) return z.name;
  }
  return '';
}

/* ---- coordinate helpers (world XZ ↔ plate pixels) ---- */
function worldToPlate(x: number, z: number, f: VisitorFrame) {
  const minX = f.cx - f.spanX / 2;
  const minZ = f.cz - f.spanZ / 2;
  return {
    px: ((x - minX) / f.spanX) * plateCanvas.width,
    py: ((z - minZ) / f.spanZ) * plateCanvas.height,
  };
}

/* ---- plate lifecycle ---- */
export function refreshMinimap(immediate = false) {
  dirty = true;
  if (immediate) dirtyAge = REBAKE_INTERVAL;
}

onMapChange(() => {
  pings.length = 0;
  rebuildZoneLabels();
  bakedMap = '';
  bakedStorey = -1;
  refreshMinimap(true);
});

onGeometryChange(() => {
  dirty = true;
});

/* ---- tactical overlay toggle (M) ---- */
export function setTacticalMap(open: boolean) {
  if (open && (introVisible || frozen || chatOpen)) return;
  if (tacticalOpen === open) return;
  tacticalOpen = open;
  tacWrap?.classList.toggle('show', tacticalOpen);
  if (tacticalOpen && tacTitleEl) tacTitleEl.textContent = mapLabel();
}

export function toggleTacticalMap() {
  setTacticalMap(!tacticalOpen);
}

onMenuShown(() => setTacticalMap(false));

addEventListener('keydown', (e) => {
  if (e.repeat || chatOpen || introVisible || frozen) return;
  if (e.code === 'KeyM') {
    e.preventDefault();
    toggleTacticalMap();
  }
});

addEventListener('blur', () => setTacticalMap(false));

/* ---- sizing hi-DPI canvases cleanly ---- */
function syncCanvasSize(canvas: HTMLCanvasElement, cssW: number, cssH: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { w, h, dpr };
}

/* ---- drawing helpers ---- */
function drawPlayerMarker(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, fovDeg: number, scale: number) {
  const halfFov = (fovDeg * Math.PI) / 360;
  const coneLen = 30 * scale;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // Soft cyan FOV cone
  const grad = ctx.createRadialGradient(0, 0, 2 * scale, 0, 0, coneLen);
  grad.addColorStop(0, 'rgba(0, 190, 235, 0.36)');
  grad.addColorStop(1, 'rgba(0, 190, 235, 0.0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, coneLen, -halfFov, halfFov);
  ctx.closePath();
  ctx.fill();

  // Crisp directional chevron pointing along +X (angle = 0)
  ctx.fillStyle = '#00beeb';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.lineWidth = 1.6 * scale;
  ctx.beginPath();
  ctx.moveTo(7.5 * scale, 0);
  ctx.lineTo(-4.8 * scale, -4.8 * scale);
  ctx.lineTo(-2.4 * scale, 0);
  ctx.lineTo(-4.8 * scale, 4.8 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

function drawPing(ctx: CanvasRenderingContext2D, x: number, y: number, p: Ping, now: number, scale: number) {
  const t = (now - p.born) / p.life;
  if (t >= 1) return;
  const alpha = Math.pow(1 - t, 1.35);
  const isBoom = p.kind === 'boom';
  const color = isBoom ? `rgba(255, 168, 56, ${alpha.toFixed(3)})` : `rgba(255, 77, 94, ${alpha.toFixed(3)})`;
  const ringR = (isBoom ? 7 + t * 22 : 4 + t * 13) * scale;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = (isBoom ? 2.2 : 1.5) * scale;
  ctx.beginPath();
  ctx.arc(x, y, ringR, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = isBoom ? `rgba(255, 108, 64, ${alpha.toFixed(3)})` : color;
  ctx.beginPath();
  ctx.arc(x, y, (isBoom ? 3.8 : 2.8) * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/* ---- corner heading-up radar ---- */
function drawRadar(now: number, f: VisitorFrame) {
  if (!radarCanvas || !radarCtx) return;
  const rect = radarCanvas.getBoundingClientRect();
  const cssSize = rect.width || 184;
  const { w, h, dpr } = syncCanvasSize(radarCanvas, cssSize, cssSize);
  const ctx = radarCtx;
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#090c10';
  ctx.fillRect(0, 0, w, h);

  // Zoomed local radius around player (metres visible from centre to edge)
  const viewRadiusM = Math.min(46, Math.max(26, Math.min(f.spanX, f.spanZ) * 0.34));
  const pxPerMetre = r / viewRadiusM;
  const platePxPerMetre = plateCanvas.width / f.spanX;
  const imgScale = pxPerMetre / platePxPerMetre;

  const { px: playerPx, py: playerPy } = worldToPlate(player.x, player.z, f);
  // True un-mirrored top-down (+X right, −Z up): rotating by +player.yaw puts
  // the player's forward vector (−sin yaw, −cos yaw) straight UP (0, −1).
  const rot = player.yaw;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.scale(imgScale, imgScale);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(plateCanvas, -playerPx, -playerPy);
  ctx.restore();

  // Subtle range rings for spatial scale
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = dpr;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Pings (rotated into radar frame; clamped to the rim if just outside view)
  const cosR = Math.cos(rot), sinR = Math.sin(rot);
  for (const p of pings) {
    const dx = (p.x - player.x) * pxPerMetre;
    const dz = (p.z - player.z) * pxPerMetre;
    let rx = dx * cosR - dz * sinR;
    let ry = dx * sinR + dz * cosR;
    const dist = Math.hypot(rx, ry);
    const maxD = r - 7 * dpr;
    if (dist > maxD) {
      // Only edge-clamp nearby off-radar pings (within 2.2× radar radius)
      if (dist > r * 2.2) continue;
      rx = (rx / dist) * maxD;
      ry = (ry / dist) * maxD;
    }
    drawPing(ctx, cx + rx, cy + ry, p, now, dpr);
  }

  // Player marker always centred, facing straight up (−π/2)
  drawPlayerMarker(ctx, cx, cy, -Math.PI / 2, camera.fov, dpr);

  // Rotating North indicator (−Z in world = (0, −1) on plate → rotated by +yaw = (sin yaw, −cos yaw))
  const nx = Math.sin(rot), ny = -Math.cos(rot);
  const edge = r - 13 * dpr;
  const bx = cx + nx * edge;
  const by = cy + ny * edge;
  ctx.save();
  ctx.fillStyle = 'rgba(10, 10, 10, 0.85)';
  ctx.strokeStyle = 'rgba(0, 190, 235, 0.65)';
  ctx.lineWidth = 1.2 * dpr;
  ctx.beginPath();
  ctx.arc(bx, by, 8.5 * dpr, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#00beeb';
  ctx.font = `700 ${Math.round(9 * dpr)}px Montserrat, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', bx, by + 0.5 * dpr);
  ctx.restore();
}

/* ---- full tactical map overlay (M) ---- */
function drawTactical(now: number, f: VisitorFrame, storey: StoreyDef | null) {
  if (!tacCanvas || !tacCtx) return;
  const box = tacCanvas.parentElement?.getBoundingClientRect();
  const maxW = Math.min((box?.width || 720), window.innerWidth - 96);
  const maxH = Math.min(window.innerHeight - 190, 640);
  const aspect = f.spanX / f.spanZ;
  let cssW = maxW;
  let cssH = cssW / aspect;
  if (cssH > maxH) { cssH = maxH; cssW = cssH * aspect; }

  tacCanvas.style.width = `${Math.round(cssW)}px`;
  tacCanvas.style.height = `${Math.round(cssH)}px`;
  const { w, h, dpr } = syncCanvasSize(tacCanvas, cssW, cssH);
  const ctx = tacCtx;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#090c10';
  ctx.fillRect(0, 0, w, h);

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(plateCanvas, 0, 0, w, h);

  const minX = f.cx - f.spanX / 2;
  const minZ = f.cz - f.spanZ / 2;
  const toCanvas = (wx: number, wz: number) => ({
    x: ((wx - minX) / f.spanX) * w,
    y: ((wz - minZ) / f.spanZ) * h,
  });

  // Zone callout pills (filtered to active storey on multi-storey maps)
  ctx.save();
  const fontSize = Math.round(9.5 * dpr);
  ctx.font = `600 ${fontSize}px Montserrat, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const placed: { x: number; y: number; hw: number; hh: number }[] = [];

  for (const z of zoneLabels) {
    if (storey) {
      if (storey.maxY !== undefined && z.minY !== undefined && z.minY >= storey.maxY) continue;
      if (storey.minY !== undefined && z.maxY !== undefined && z.maxY <= storey.minY) continue;
    }
    const pt = toCanvas(z.x, z.z);
    if (pt.x < 24 * dpr || pt.x > w - 24 * dpr || pt.y < 16 * dpr || pt.y > h - 16 * dpr) continue;

    const tw = ctx.measureText(z.name).width;
    const padX = 5 * dpr, padY = 2.5 * dpr;
    const hw = tw / 2 + padX, hh = fontSize / 2 + padY;

    // Skip overlapping labels so dense interior rooms stay legible
    let clash = false;
    for (const b of placed) {
      if (Math.abs(pt.x - b.x) < hw + b.hw + 2 * dpr && Math.abs(pt.y - b.y) < hh + b.hh + 1.5 * dpr) {
        clash = true;
        break;
      }
    }
    if (clash) continue;
    placed.push({ x: pt.x, y: pt.y, hw, hh });

    ctx.fillStyle = 'rgba(8, 10, 14, 0.72)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = dpr;
    const rx = pt.x - hw, ry = pt.y - hh, rw = hw * 2, rh = hh * 2, cr = 4 * dpr;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(rx, ry, rw, rh, cr);
    else ctx.rect(rx, ry, rw, rh);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillText(z.name, pt.x, pt.y + 0.5 * dpr);
  }
  ctx.restore();

  // Live pings
  for (const p of pings) {
    const pt = toCanvas(p.x, p.z);
    drawPing(ctx, pt.x, pt.y, p, now, dpr * 1.15);
  }

  // Player position + heading (−π/2 − player.yaw on static un-mirrored top-down plate)
  const me = toCanvas(player.x, player.z);
  drawPlayerMarker(ctx, me.x, me.y, -Math.PI / 2 - player.yaw, camera.fov, dpr * 1.15);

  // Subtle North compass badge in top-right of tactical canvas
  const nx = w - 22 * dpr, ny = 22 * dpr;
  ctx.save();
  ctx.fillStyle = 'rgba(10, 10, 10, 0.78)';
  ctx.strokeStyle = 'rgba(0, 190, 235, 0.55)';
  ctx.lineWidth = 1.2 * dpr;
  ctx.beginPath();
  ctx.arc(nx, ny, 12 * dpr, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#00beeb';
  ctx.font = `700 ${Math.round(10 * dpr)}px Montserrat, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', nx, ny + 0.5 * dpr);
  ctx.restore();
}

/* ============================ per frame ============================ */
// Called from main.ts right BEFORE renderer.render(scene, camera) so any plate
// re-bake shares the drawing buffer cleanly without ever flickering the screen.
export function updateMinimap(dt: number) {
  const inPlay = !introVisible && !frozen && !dead;
  if (!inPlay && tacticalOpen) setTacticalMap(false);
  const showRadar = inPlay && !tacticalOpen;
  if (radarWrap) radarWrap.classList.toggle('show', showRadar);
  if (!showRadar && !tacticalOpen) return;

  const now = performance.now();
  // Prune expired pings
  for (let i = pings.length - 1; i >= 0; i--) {
    if (now - pings[i].born >= pings[i].life) pings.splice(i, 1);
  }

  const storeys = storeysFor(currentMapName);
  const storeyIdx = storeys ? storeyIndexForFeet(storeys, player.feet) : -1;
  const storey = storeys && storeyIdx >= 0 ? storeys[storeyIdx] : null;

  // Immediate re-bake on map switch or storey transition; throttled after voxel damage.
  if (bakedMap !== currentMapName || bakedStorey !== storeyIdx) {
    dirty = true;
    dirtyAge = REBAKE_INTERVAL;
  }
  if (dirty) {
    dirtyAge += dt;
    if (dirtyAge >= REBAKE_INTERVAL) {
      const next = renderTopDown(plateCanvas, { size: PLATE_SIZE, sliceY: storey?.sliceY });
      if (next) {
        frame = next;
        bakedMap = currentMapName;
        bakedStorey = storeyIdx;
        dirty = false;
        dirtyAge = 0;
      }
    }
  }
  if (!frame) return;

  // Update zone & storey labels only when they change
  const zoneText = currentZoneName() || mapLabel();
  if (zoneText !== lastZoneText) {
    lastZoneText = zoneText;
    if (radarZoneEl) radarZoneEl.textContent = zoneText;
    if (tacZoneEl) tacZoneEl.textContent = zoneText;
  }
  const floorText = storey ? storey.label : '';
  if (floorText !== lastFloorText) {
    lastFloorText = floorText;
    if (radarFloorEl) {
      radarFloorEl.textContent = floorText;
      radarFloorEl.hidden = !floorText;
    }
    if (tacFloorEl) {
      tacFloorEl.textContent = floorText ? `Verdieping · ${floorText}` : '';
      tacFloorEl.hidden = !floorText;
    }
  }

  if (showRadar) drawRadar(now, frame);
  if (tacticalOpen) drawTactical(now, frame, storey);
}

export function minimapState() {
  return {
    ready: !!frame,
    map: bakedMap,
    storey: bakedStorey,
    tacticalOpen,
    pings: pings.length,
    zone: lastZoneText,
  };
}
