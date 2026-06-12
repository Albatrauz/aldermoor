const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 4174;

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
    .map(([id, p]) => ({ id, name: p.name, color: p.color, score: p.score }))
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
    p.score = 0; p.hp = 3; p.alive = true;
    p.x = SPAWN.x; p.y = SPAWN.y; p.z = SPAWN.z; p.yaw = SPAWN.yaw;
    p.m = 0; p.r = 0;                                   // clear stale walk/run anim flags
    p.lastShot = 0; p.hitUsed = true; p.lastFell = now; // brief mercy after the reset
  }
  broadcast({ t: 'restart', spawn: SPAWN });
  console.log(`↻ new round — ${players.size} in town`);
}

// Mounts the multiplayer WebSocket game on an existing HTTP server. We route
// the upgrade ourselves (noServer) and only claim the `/ws` path, leaving every
// other upgrade — notably Vite's HMR socket on `/` in dev — untouched. Using
// `{ server, path }` instead would make ws abort non-matching upgrades with a
// 400, which kills HMR and sends Vite into a reload loop.
function attachGame(httpServer) {
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req, socket, head) => {
    if ((req.url || '').split('?')[0] !== '/ws') return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws, req) => {
    const id = nextId++;
    const wanted = cleanName(new URLSearchParams((req?.url || '').split('?')[1] || '').get('name') || '');
    const p = { ws, name: wanted ? uniqueName(wanted, id) : pickName(), color: COLORS[id % COLORS.length],
      x: -105, y: 1.65, z: 0, yaw: 0, m: 0, r: 0, alive: true,
      hp: 3, score: 0, lastShot: 0, hitUsed: true, lastFell: 0, lastRename: 0 };
    players.set(id, p);

    ws.send(JSON.stringify({
      t: 'welcome', id, name: p.name, color: p.color, score: p.score,
      players: [...players.entries()]
        .filter(([pid]) => pid !== id)
        .map(([pid, q]) => ({ id: pid, name: q.name, color: q.color, score: q.score, x: q.x, y: q.y, z: q.z, yaw: q.yaw })),
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
      } else if (msg.t === 'shoot') {
        if (phase !== 'play') return;                // the contest is decided
        const now = Date.now();
        if (now - p.lastShot < 450) return;          // handgonnes are slow to charge
        if (!Array.isArray(msg.o) || !Array.isArray(msg.d)) return;
        p.lastShot = now;
        p.hitUsed = false;
        broadcast({ t: 'shoot', id,
          o: msg.o.slice(0, 3).map(v => num(v, -200, 200, 0)),
          d: msg.d.slice(0, 3).map(v => num(v, -1, 1, 0)),
          l: num(msg.l, 0, 120, 70) }, id);
      } else if (msg.t === 'name') {
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
        const q = players.get(msg.target | 0);
        if (!q || q === p) return;
        if (now - q.lastFell < RESPAWN_MS + SPAWN_GRACE_MS) return;  // dead, or freshly risen
        const dx = p.x - q.x, dz = p.z - q.z;
        if (dx * dx + dz * dz > 75 * 75) return;          // out of range, impossible shot
        q.hp -= 1;
        if (q.hp > 0) {
          broadcast({ t: 'hitfx', shooter: id, target: msg.target | 0, hp: q.hp });
        } else {
          p.score += 1;
          q.hp = 3;
          q.lastFell = now;
          broadcast({ t: 'fell', shooter: id, sname: p.name, target: msg.target | 0, tname: q.name, score: p.score });
          console.log(`⚔ ${p.name} felled ${q.name} (${p.score})`);
          if (p.score >= KILL_CAP) endRound(id);          // first to the cap wins the round
        }
      }
    });
    ws.on('pong', () => { p.alive = true; });
    ws.on('close', () => {
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
      snap[id] = [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(3), p.m, p.r];
    broadcast({ t: 'snap', p: snap });
  }, 80);

  const pingTimer = setInterval(() => { // drop dead connections
    for (const [, p] of players) {
      if (!p.alive) { p.ws.terminate(); continue; }
      p.alive = false;
      try { p.ws.ping(); } catch { /* closing */ }
    }
  }, 15000);

  // Don't keep a Vite dev process alive on these timers.
  snapTimer.unref?.();
  pingTimer.unref?.();

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
