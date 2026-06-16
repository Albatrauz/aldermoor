const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 4174;

// ---- Convex persistence (optional) ----
// The live game runs entirely over WebSocket; Convex is touched only to verify
// a player's session token on join and to flush match results at round end.
// Every call is fire-and-forget — if Convex is unset or unreachable, the game
// runs guest-only and no stats are recorded.
let convex = null;
let convexApi = null;
const SERVER_SECRET = process.env.SERVER_SHARED_SECRET || '';
const ALLOW_GUESTS = process.env.ALLOW_GUESTS !== 'false';
try {
  if (process.env.CONVEX_URL) {
    const { ConvexHttpClient } = require('convex/browser');
    const { anyApi } = require('convex/server');
    convex = new ConvexHttpClient(process.env.CONVEX_URL);
    convexApi = anyApi;
    if (!SERVER_SECRET) console.warn('⚠ CONVEX_URL set but SERVER_SHARED_SECRET is empty — stat writes will be rejected.');
    console.log('✦ Convex enabled — accounts & stats on');
  } else {
    console.log('· CONVEX_URL not set — guest-only, no stats');
  }
} catch (e) {
  console.warn('· Convex client unavailable — guest-only:', e.message);
}

// Trade a session token for a trusted { userId, username }, or null.
async function identify(token) {
  if (!convex || !token) return null;
  try { return await convex.query(convexApi.auth.userByToken, { token }); }
  catch (e) { console.warn('token verify failed:', e.message); return null; }
}

// Persist a round's tally for every signed-in participant. Never throws.
function flushResults(results) {
  if (!convex || !SERVER_SECRET || !results.length) return;
  convex.mutation(convexApi.stats.recordMatch, { secret: SERVER_SECRET, results })
    // ConvexError carries its reason on `.data`; plain errors only have `.message`.
    .catch((e) => console.warn('recordMatch failed:', e.data ?? e.message));
}

// In production we serve Vite's build output; if it hasn't been built yet we
// fall back to the project root so the server still boots (with a hint).
const DIST = path.join(__dirname, 'dist');
const ROOT = fs.existsSync(path.join(DIST, 'index.html')) ? DIST : __dirname;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2',
};

function serveStatic(req, res) {
  const url = (req.url === '/' ? '/index.html' : req.url).split('?')[0];
  const file = path.join(ROOT, path.normalize(url));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

const FIRST = ['Calvin', 'Desmond', 'Kenan', 'Youri', 'Michael', 'Bart', 'Jordy', 'David',
  'Vicky', 'Rick', 'Kishan', 'Mart', 'Sjoerd', 'Mike', 'Maud', 'Leofric'];
const TRADE = ['the Cooper', 'the Miller', 'the Weaver', 'the Smith', 'the Baker', 'the Fletcher',
  'the Tanner', 'the Carter', 'the Brewer', 'the Mason', 'the Shepherd', 'the Chandler'];
const COLORS = [0x7a3b2e, 0x3f5d43, 0x3c4668, 0x8a6d2f, 0x6b3a5c, 0x4a6b6e, 0x935b25, 0x5c5340];

const KILL_CAP = 10;          // first to this many kills wins the round
const RESTART_DELAY = 20000;  // overview screen lingers this long, then a fresh round
const MAX_HP = 100;           // a full health bar
const BODY_DMG = [25, 12];    // body damage per weapon: [handgonne, ak47] — headshots always fell outright
const REGEN_DELAY = 5000;     // unharmed this long and the bar begins to refill
const REGEN_TICK_MS = 500;    // …topped up this often
const REGEN_PER_TICK = 8;     // …by this much each step (≈16 hp/s, ~6s from the brink)
const SPAWN = { x: 0, y: 1.65, z: 38.5, yaw: 0 };
// The felled lie dead this long on the client (its killscreen countdown), then
// rise with a brief grace. Hits inside the whole window are ignored, so a corpse
// can't be re-felled — that would hand out a phantom kill and reset the count.
const RESPAWN_MS = 4000;
const SPAWN_GRACE_MS = 1500;

let nextId = 1;
const players = new Map();

// Round state. `phase` is 'play' while the contest is on and 'over' while the
// overview screen is up; `overInfo` carries the decided standings (so late
// joiners can be shown the same screen) and `restartTimer` fires the reset.
let phase = 'play';
let overInfo = null;
let restartTimer = null;

function pickName() {
  for (let i = 0; i < 50; i++) {
    const n = FIRST[Math.floor(Math.random() * FIRST.length)] + ' ' +
              TRADE[Math.floor(Math.random() * TRADE.length)];
    if (![...players.values()].some(p => p.name === n)) return n;
  }
  return 'Stranger nº' + nextId;
}

// player-chosen names: letters/digits/spaces and a little punctuation, ≤20 chars
function cleanName(v) {
  if (typeof v !== 'string') return '';
  return v.replace(/[^\p{L}\p{N} _.'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20);
}
function uniqueName(n, selfId) {
  let name = n;
  for (let i = 2; [...players.entries()].some(([pid, p]) => pid !== selfId && p.name === name); i++)
    name = `${n} ${i}`;
  return name;
}

function broadcast(msg, exceptId) {
  const s = JSON.stringify(msg);
  for (const [id, p] of players)
    if (id !== exceptId && p.ws.readyState === 1) p.ws.send(s);
}

const num = (v, lo, hi, dflt) =>
  (typeof v === 'number' && isFinite(v)) ? Math.max(lo, Math.min(hi, v)) : dflt;

// The final tally, best score first, as plain rows the overview screen renders.
function standings() {
  return [...players.entries()]
    .map(([id, p]) => ({ id, name: p.name, color: p.color, score: p.score, deaths: p.deaths }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

// Someone hit the cap: freeze scoring, show everyone the overview, and arm the
// reset. Idempotent-ish — only acts while a contest is actually running.
function endRound(winnerId) {
  if (phase !== 'play') return;
  phase = 'over';
  const winner = players.get(winnerId);
  overInfo = {
    winnerId, winnerName: winner ? winner.name : 'Nobody',
    cap: KILL_CAP, standings: standings(), endsAt: Date.now() + RESTART_DELAY,
  };
  broadcast({ t: 'over', winnerId: overInfo.winnerId, winnerName: overInfo.winnerName,
    cap: KILL_CAP, restartIn: RESTART_DELAY / 1000, standings: overInfo.standings });
  console.log(`★ ${overInfo.winnerName} wins with ${KILL_CAP} — next round in ${RESTART_DELAY / 1000}s`);

  // Persist the round for every signed-in player BEFORE resetRound wipes scores.
  const results = [];
  for (const [, q] of players) {
    if (!q.authUserId || q.bot || q.flushed) continue;
    q.flushed = true;
    results.push({ userId: q.authUserId, username: q.username,
      roundKills: q.roundKills, roundDeaths: q.deaths, headshots: q.roundHeadshots,
      weaponKills: q.roundWeaponKills, weaponHeadshots: q.roundWeaponHeadshots,
      won: !!winner && q.authUserId === winner.authUserId });
  }
  flushResults(results);

  restartTimer = setTimeout(resetRound, RESTART_DELAY);
  restartTimer.unref?.();
}

// Wipe the slate for a fresh contest and send everyone back to the gates.
function resetRound() {
  restartTimer = null;
  phase = 'play';
  overInfo = null;
  const now = Date.now();
  for (const [, p] of players) {
    p.score = 0; p.deaths = 0; p.hp = MAX_HP; p.alive = true;
    p.roundKills = 0; p.roundHeadshots = 0; p.flushed = false;  // fresh round, fresh tally (deaths via p.deaths)
    p.roundWeaponKills = BODY_DMG.map(() => 0); p.roundWeaponHeadshots = BODY_DMG.map(() => 0);
    p.x = SPAWN.x; p.y = SPAWN.y; p.z = SPAWN.z; p.yaw = SPAWN.yaw;
    p.m = 0; p.r = 0;                                   // clear stale walk/run anim flags
    p.lastShot = 0; p.hitUsed = true; p.lastFell = now; // brief mercy after the reset
    p.lastDamaged = 0; p.dmgFrom.clear();              // fresh life, no wounds tallied
  }
  for (const [, p] of players) if (p.bot) placeBot(p); // re-scatter dummies, don't clump at SPAWN
  broadcast({ t: 'restart', spawn: SPAWN });
  console.log(`↻ new round — ${players.size} in town`);
}

/* ============================ dev-only practice dummies ============================ */
// Standing bots so a lone developer can test the shoot mechanics, the health
// system and the round loop without a second player. They are real `players`
// entries (the server is authoritative for combat), so the existing client
// renders, raycasts and scores them with no client changes. Reached only via
// attachGame's `opts.bots` — production (`attachGame(server)`) never passes it,
// so dummies can never appear outside `npm run dev`.

// Curated open-floor spots mirroring world.js SPAWNS. `y` is eye height baked per
// spot (the server has no colliders) so a dummy stands right even on the raised
// bombsite-A platform (+1.2).
const BOT_SPOTS = [
  { x: -105, z: 0,     y: 1.65, yaw: -Math.PI / 2 }, // T spawn
  { x: -70,  z: 11.5,  y: 1.65, yaw: -Math.PI / 2 }, // T upper
  { x: -69,  z: 24,    y: 1.65, yaw: Math.PI },      // outside long
  { x: -40,  z: 40.5,  y: 1.65, yaw: -Math.PI / 2 }, // long A
  { x: 13,   z: 44,    y: 2.85, yaw: Math.PI / 2 },  // bombsite A platform (+1.2)
  { x: -20,  z: 0,     y: 1.65, yaw: -Math.PI / 2 }, // mid
  { x: 22,   z: 0,     y: 1.65, yaw: Math.PI / 2 },  // CT mid
  { x: -57,  z: -21.5, y: 1.65, yaw: -Math.PI / 2 }, // upper tunnels
  { x: -29,  z: -34,   y: 1.65, yaw: -Math.PI / 2 }, // lower tunnels
  { x: 2,    z: -33,   y: 1.65, yaw: -Math.PI / 2 }, // bombsite B
  { x: 30,   z: -18,   y: 1.65, yaw: Math.PI / 2 },  // B doors corridor
  { x: 55,   z: 35,    y: 1.65, yaw: Math.PI / 2 },  // CT→A connector
  { x: 95,   z: 2,     y: 1.65, yaw: Math.PI / 2 },  // CT spawn
];
const BOT_RANGE = 40;        // how far a dummy will return fire
const BOT_HEADSHOT = 0.12;   // chance its ball finds the head (a one-shot)
const BOT_FIRE_CD = 4000;    // base delay between a dummy's volleys (ms)
const BOT_FIRE_JITTER = 3000;// …plus up to this much random spread → ~4–7s apart

// Drop a dummy onto a random spot with a little jitter, fresh-faced for a new life.
function placeBot(p) {
  const s = BOT_SPOTS[Math.floor(Math.random() * BOT_SPOTS.length)];
  p.x = s.x + Math.random() * 3 - 1.5;
  p.z = s.z + Math.random() * 3 - 1.5;
  p.y = s.y;
  p.yaw = s.yaw + (Math.random() * 1.2 - 0.6);
  p.hp = MAX_HP;
  p.dmgFrom.clear();
  p.lastDamaged = 0;
  p.lastFell = Date.now();   // a breath of grace so it isn't re-felled on arrival
}

// Stand up `n` dummies and announce them. The stub socket's no-op send() lets the
// existing broadcast/regen loops treat a bot like any other player.
function spawnBots(n) {
  for (let k = 1; k <= n; k++) {
    const id = nextId++;
    const ws = { readyState: 1, send() {} };
    const p = { ws, name: `Dummy ${k}`, color: COLORS[id % COLORS.length],
      authUserId: null, username: null,
      x: 0, y: 1.65, z: 0, yaw: 0, m: 0, r: 0, alive: true,
      hp: MAX_HP, score: 0, deaths: 0, lastShot: 0, hitUsed: true, lastFell: 0, lastRename: 0,
      lastDamaged: 0, dmgFrom: new Map(), weapon: 0, bot: true, nextShot: 0,
      roundKills: 0, roundHeadshots: 0,
      roundWeaponKills: BODY_DMG.map(() => 0), roundWeaponHeadshots: BODY_DMG.map(() => 0), flushed: false };
    placeBot(p);
    p.nextShot = Date.now() + Math.floor(Math.random() * BOT_FIRE_CD);  // stagger first volleys
    players.set(id, p);
    broadcast({ t: 'join', id, name: p.name, color: p.color, x: p.x, y: p.y, z: p.z, yaw: p.yaw });
    console.log(`+ ${p.name} (#${id}) [bot] — ${players.size} in town`);
  }
}

// Apply one ball's worth of damage shooter→target: the felled/range guards, the
// wound tally, and the hitfx-or-fell broadcast. Shared by real players' `hit`
// messages and dev bots' return fire.
function resolveHit(shooterId, targetId, head, w = 0) {
  const p = players.get(shooterId);
  const q = players.get(targetId);
  if (!p || !q || q === p) return;
  const now = Date.now();
  if (now - q.lastFell < RESPAWN_MS + SPAWN_GRACE_MS) return;   // dead, or freshly risen
  const dx = p.x - q.x, dz = p.z - q.z;
  if (dx * dx + dz * dz > 75 * 75) return;                      // out of range, impossible shot

  const dealt = head ? q.hp : Math.min(BODY_DMG[w] ?? BODY_DMG[0], q.hp); // a ball to the head fells outright
  q.hp -= dealt;
  q.lastDamaged = now;                                          // holds off the bar's regen
  // tally the wound against the shooter for this life's death summary
  const rec = q.dmgFrom.get(shooterId) || { name: p.name, dmg: 0 };
  rec.name = p.name; rec.dmg += dealt;                          // keep the latest name on file
  q.dmgFrom.set(shooterId, rec);

  if (q.hp > 0) {
    broadcast({ t: 'hitfx', shooter: shooterId, target: targetId, hp: q.hp });
  } else {
    p.score += 1;
    q.deaths += 1;                                              // round deaths (scoreboard + stat flush)
    p.roundKills += 1;                                          // per-round tallies for the stat flush
    if (head) p.roundHeadshots += 1;
    p.roundWeaponKills[w] = (p.roundWeaponKills[w] || 0) + 1;   // …split by the weapon that felled them
    if (head) p.roundWeaponHeadshots[w] = (p.roundWeaponHeadshots[w] || 0) + 1;
    // who chipped them down, this life — best first, for the killscreen
    const dmg = [...q.dmgFrom.entries()]
      .map(([aid, r]) => ({ id: aid, name: r.name, dmg: r.dmg }))
      .sort((a, b) => b.dmg - a.dmg);
    q.hp = MAX_HP;
    q.lastFell = now;
    q.dmgFrom.clear();                                          // next life starts unwounded
    broadcast({ t: 'fell', shooter: shooterId, sname: p.name, target: targetId,
      tname: q.name, score: p.score, tdeaths: q.deaths, head, dmg });
    console.log(`⚔ ${p.name} felled ${q.name}${head ? ' (headshot)' : ''} (${p.score})`);
    if (q.bot) placeBot(q);                                     // re-scatter the dummy for the next pass
    if (p.score >= KILL_CAP) endRound(shooterId);              // first to the cap wins the round
  }
}

// Mounts the multiplayer WebSocket game on an existing HTTP server. We route
// the upgrade ourselves (noServer) and only claim the `/ws` path, leaving every
// other upgrade — notably Vite's HMR socket on `/` in dev — untouched. Using
// `{ server, path }` instead would make ws abort non-matching upgrades with a
// 400, which kills HMR and sends Vite into a reload loop.
function attachGame(httpServer, opts = {}) {
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req, socket, head) => {
    if ((req.url || '').split('?')[0] !== '/ws') return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', async (ws, req) => {
    const id = nextId++;
    const qs = new URLSearchParams((req?.url || '').split('?')[1] || '');
    const token = qs.get('token') || '';
    const wanted = cleanName(qs.get('name') || '');

    // A token (if any) is traded for a trusted account identity. A guest keeps
    // their free-typed name. If guests are barred, an unverified socket is shut.
    const auth = await identify(token);
    if (ws.readyState !== 1) return;                  // bailed during the lookup
    if (!auth && !ALLOW_GUESTS) { try { ws.close(4001, 'sign in to play'); } catch { /* gone */ } return; }

    const p = { ws,
      name: auth ? uniqueName(auth.username, id) : (wanted ? uniqueName(wanted, id) : pickName()),
      color: COLORS[id % COLORS.length],
      authUserId: auth ? auth.userId : null,          // null = guest (never scored to an account)
      username: auth ? auth.username : null,
      x: -105, y: 1.65, z: 0, yaw: 0, m: 0, r: 0, alive: true,
      hp: MAX_HP, score: 0, deaths: 0, lastShot: 0, hitUsed: true, lastFell: 0, lastRename: 0,
      lastDamaged: 0, dmgFrom: new Map(), weapon: 0,  // dmgFrom: attackerId → {name, dmg} this life
      roundKills: 0, roundHeadshots: 0,               // per-round, for stat flush (deaths via p.deaths)
      roundWeaponKills: BODY_DMG.map(() => 0), roundWeaponHeadshots: BODY_DMG.map(() => 0), flushed: false };
    players.set(id, p);

    ws.send(JSON.stringify({
      t: 'welcome', id, name: p.name, color: p.color, score: p.score, deaths: p.deaths,
      players: [...players.entries()]
        .filter(([pid]) => pid !== id)
        .map(([pid, q]) => ({ id: pid, name: q.name, color: q.color, score: q.score, deaths: q.deaths, x: q.x, y: q.y, z: q.z, yaw: q.yaw })),
      // Drop a late joiner straight into the overview if a round just ended.
      over: phase === 'over' && overInfo ? {
        winnerId: overInfo.winnerId, winnerName: overInfo.winnerName, cap: overInfo.cap,
        restartIn: Math.max(0, Math.ceil((overInfo.endsAt - Date.now()) / 1000)),
        standings: overInfo.standings,
      } : null,
    }));
    broadcast({ t: 'join', id, name: p.name, color: p.color, x: p.x, y: p.y, z: p.z, yaw: p.yaw }, id);
    console.log(`+ ${p.name} (#${id}) — ${players.size} in town`);

    ws.on('message', (buf) => {
      let msg; try { msg = JSON.parse(buf); } catch { return; }
      if (msg.t === 'state') {
        p.x = num(msg.x, -120, 120, p.x);
        p.y = num(msg.y, 0, 30, p.y);
        p.z = num(msg.z, -120, 120, p.z);
        p.yaw = num(msg.yaw, -1e4, 1e4, p.yaw);
        p.m = msg.m ? 1 : 0;
        p.r = msg.r ? 1 : 0;
        p.weapon = msg.w === 1 ? 1 : 0;
      } else if (msg.t === 'shoot') {
        if (phase !== 'play') return;                // the contest is decided
        const now = Date.now();
        const sw = msg.w === 1 ? 1 : 0;
        const minInterval = sw === 1 ? 90 : 450;    // ak47 ~10 rps, handgonne ~2 rps
        if (now - p.lastShot < minInterval) return;
        if (!Array.isArray(msg.o) || !Array.isArray(msg.d)) return;
        p.lastShot = now;
        p.hitUsed = false;
        broadcast({ t: 'shoot', id, w: sw,
          o: msg.o.slice(0, 3).map(v => num(v, -200, 200, 0)),
          d: msg.d.slice(0, 3).map(v => num(v, -1, 1, 0)),
          l: num(msg.l, 0, 120, 70) }, id);
      } else if (msg.t === 'name') {
        if (p.authUserId) return;                          // signed-in players keep their fixed account name
        const now = Date.now();
        if (now - p.lastRename < 1000) return;             // no rename spam
        const clean = cleanName(msg.name);
        if (!clean) return;
        const next = uniqueName(clean, id);                // dedupe BEFORE the no-op check,
        if (next === p.name) return;                       // or we rebroadcast "X is now X"
        p.lastRename = now;
        const old = p.name;
        p.name = next;
        broadcast({ t: 'rename', id, name: p.name });      // everyone, sender included
        console.log(`✎ ${old} is now ${p.name}`);
      } else if (msg.t === 'hit') {
        if (phase !== 'play') return;                     // no scoring once it's over
        const now = Date.now();
        if (p.hitUsed || now - p.lastShot > 400) return;  // one hit per shot, right after it
        p.hitUsed = true;
        resolveHit(id, msg.target | 0, msg.head === true, msg.w === 1 ? 1 : 0);
      }
    });
    ws.on('pong', () => { p.alive = true; });
    ws.on('close', () => {
      // a signed-in player who bails mid-round still has their partial tally counted
      if (p.authUserId && !p.flushed && (p.roundKills || p.deaths)) {
        p.flushed = true;
        flushResults([{ userId: p.authUserId, username: p.username,
          roundKills: p.roundKills, roundDeaths: p.deaths, headshots: p.roundHeadshots,
          weaponKills: p.roundWeaponKills, weaponHeadshots: p.roundWeaponHeadshots, won: false }]);
      }
      players.delete(id);
      broadcast({ t: 'leave', id, name: p.name });
      console.log(`- ${p.name} (#${id}) — ${players.size} in town`);
    });
    ws.on('error', () => ws.terminate());
  });

  const snapTimer = setInterval(() => { // position snapshots
    if (!players.size) return;
    const snap = {};
    for (const [id, p] of players)
      snap[id] = [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(3), p.m, p.r, p.weapon];
    broadcast({ t: 'snap', p: snap });
  }, 80);

  const pingTimer = setInterval(() => { // drop dead connections
    for (const [, p] of players) {
      if (p.bot) continue;                 // dummies have no socket to keep alive
      if (!p.alive) { p.ws.terminate(); continue; }
      p.alive = false;
      try { p.ws.ping(); } catch { /* closing */ }
    }
  }, 15000);

  // Health regen: once a player has gone unharmed for REGEN_DELAY, top their bar
  // back up in small steps. Only the player themselves needs to hear about it.
  const regenTimer = setInterval(() => {
    if (phase !== 'play') return;
    const now = Date.now();
    for (const [, p] of players) {
      if (p.hp >= MAX_HP) continue;
      if (now - p.lastDamaged < REGEN_DELAY) continue;   // still smarting
      if (now - p.lastFell < RESPAWN_MS) continue;        // lying felled
      p.hp = Math.min(MAX_HP, p.hp + REGEN_PER_TICK);
      if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: 'hp', hp: p.hp }));
    }
  }, REGEN_TICK_MS);

  // Dev dummies return fire so a lone developer can test taking damage and dying.
  // No colliders server-side, so targeting is range-gated, not true line-of-sight —
  // acceptable for a dev harness. Only armed when bots were actually requested.
  let botFireTimer = null;
  if (opts.bots > 0) {
    spawnBots(opts.bots);
    botFireTimer = setInterval(() => {
      if (phase !== 'play') return;
      const now = Date.now();
      for (const [bid, b] of players) {
        if (!b.bot || now < b.nextShot) continue;
        // nearest human in range, skipping the freshly felled
        let targetId = null, target = null, best = BOT_RANGE * BOT_RANGE;
        for (const [qid, q] of players) {
          if (q.bot || q === b) continue;
          if (now - q.lastFell < RESPAWN_MS + SPAWN_GRACE_MS) continue;
          const dx = b.x - q.x, dz = b.z - q.z, d2 = dx * dx + dz * dz;
          if (d2 < best) { best = d2; target = q; targetId = qid; }
        }
        if (!target) continue;
        // aim in place (no walking) and let a ball fly
        let dx = target.x - b.x, dy = target.y - b.y, dz = target.z - b.z;
        const len = Math.hypot(dx, dy, dz) || 1;
        dx /= len; dy /= len; dz /= len;
        b.yaw = Math.atan2(-(target.x - b.x), -(target.z - b.z));   // face the target
        broadcast({ t: 'shoot', id: bid,
          o: [+b.x.toFixed(2), +b.y.toFixed(2), +b.z.toFixed(2)],
          d: [+dx.toFixed(3), +dy.toFixed(3), +dz.toFixed(3)],
          l: +Math.min(len, 120).toFixed(1) });
        resolveHit(bid, targetId, Math.random() < BOT_HEADSHOT);
        b.nextShot = now + BOT_FIRE_CD + Math.random() * BOT_FIRE_JITTER;  // stagger the next volley
      }
    }, 600);
  }

  // Don't keep a Vite dev process alive on these timers.
  snapTimer.unref?.();
  pingTimer.unref?.();
  regenTimer.unref?.();
  botFireTimer?.unref?.();

  return wss;
}

module.exports = { attachGame };

// Run directly (`node server.js` / `npm start`): the standalone production
// server that serves the build and hosts the game on one port.
if (require.main === module) {
  if (ROOT === __dirname)
    console.warn('⚠ No build found — run `npm run build` first, or use `npm run dev` for development.');
  const server = http.createServer(serveStatic);
  attachGame(server);
  server.listen(PORT, () => console.log(`Aldermoor is open at http://localhost:${PORT}`));
}
