/* ============================ leaderboard & career ============================ */
// Reactive reads from Convex: the public top-kills board on the intro screen,
// and the signed-in player's own dossier — lifetime career, level and XP, and
// the honours (titles, tunics, …) their level has unlocked, which they equip
// here. All of it streams over the ConvexClient WebSocket via onUpdate, so it
// refreshes the instant a match is recorded — no polling, no reload.
// Guest-only (no Convex) → this is inert.
import { convex, api, hasConvex } from './convex';
import { getSession, getToken, onAuthChange } from './auth';
import { sendNet } from './net';
import { WEAPONS } from './weapons';

const lbEl      = document.getElementById('leaderboard');
const lbRowsEl  = document.getElementById('lbRows');
const lbCountEl = document.getElementById('lbCount');
const careerEl  = document.getElementById('careerPanel');

/* usernames are player-chosen — never let them into innerHTML raw */
const esc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kd = (k, d) => (k / Math.max(1, d)).toFixed(2);
const num = (n) => Math.round(n || 0).toLocaleString('en-US');
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

// the two reactive streams land independently; cache the latest of each so a
// re-render (board → standing, session → me-highlight) always has both halves
let lastRows = [];
let lastCareer = null;
let lastProg = null;      // progression.mine: level, XP, slots and their items
let earnOpen = false;     // the "how XP is earned" fold survives a re-render
let gearError = '';

function renderBoard() {
  if (!lbEl || !lbRowsEl) return;
  lbEl.classList.add('show');
  if (lbCountEl) {
    lbCountEl.textContent = lastRows.length
      ? `${lastRows.length} ${lastRows.length === 1 ? 'player' : 'players'}` : '';
  }
  if (!lastRows.length) {
    lbRowsEl.innerHTML = '<div class="lb-empty">No players yet — be the first.</div>';
    return;
  }
  const meId = getSession()?.userId;
  lbRowsEl.innerHTML = lastRows.map((r, i) => {
    const me = meId && r.userId === meId ? ' me' : '';
    return `<div class="lb-row${me}">` +
      `<span class="lb-rank">${String(i + 1).padStart(2, '0')}</span>` +
      `<span class="lb-name">${r.level ? `<i class="lvl">${r.level}</i>` : ''}${esc(r.username)}</span>` +
      `<span class="lb-kills">${r.kills}</span>` +
      `<span class="lb-kd">${kd(r.kills, r.deaths)}</span>` +
      `<span class="lb-wins">${r.wins}</span>` +
      `<span class="lb-heads">${r.headshots}</span></div>`;
  }).join('');
}

function renderDossier() {
  if (!careerEl) return;
  const session = getSession() || debugSession;
  if (!session) { careerEl.innerHTML = ''; return; } // sealed panel shows via CSS

  // a fresh account has a zeroed stats row; fall back to zeros if it hasn't
  // streamed in yet so the dossier never flashes empty after sign-in
  const s = lastCareer || {
    username: session.username, kills: 0, deaths: 0, headshots: 0,
    wins: 0, matchesPlayed: 0, weaponKills: [], weaponHeadshots: [],
  };
  const name = s.username || session.username;

  // standing: our rank within the loaded board, else an unranked recruit
  const idx = lastRows.findIndex((r) => r.userId === session.userId);
  const standing = idx >= 0
    ? `Rank <b>#${idx + 1}</b> of ${lastRows.length}`
    : (s.matchesPlayed ? 'Outside the top ranks' : 'Unranked');

  const stat = (v, label, gold?) =>
    `<div class="fs-stat${gold ? ' gold' : ''}"><b>${v}</b><span>${label}</span></div>`;

  // per-weapon kills + headshots, labelled from the weapon table; the server
  // tallies grenade kills in the slot after the guns
  const wk = s.weaponKills || [], wh = s.weaponHeadshots || [];
  const arms = WEAPONS.map((w, i) =>
    `<span class="fs-arm">${esc(w.name)} <b>${wk[i] || 0}</b>` +
    `<span class="hs">${wh[i] || 0} hs</span></span>`).join('') +
    `<span class="fs-arm">Grenade <b>${wk[WEAPONS.length] || 0}</b></span>`;

  const p = lastProg;   // null until it streams in (or against an older backend)
  careerEl.innerHTML =
    `<div class="fs-doss-head"><div class="fs-doss-id">` +
      (p ? `<div class="fs-lvl" aria-label="Level ${p.level}"><span>Level</span><b>${p.level}</b></div>` : '') +
      `<div><div class="fs-doss-eyebrow">Your stats${p?.title ? ` · ${esc(p.title)}` : ''}</div>` +
      `<div class="fs-doss-name">${esc(name)}</div></div></div>` +
      `<div class="fs-doss-standing">${standing}</div></div>` +
    (p ? xpBlock(p) : '') +
    `<div class="fs-statgrid">` +
      stat(s.kills, 'Kills') + stat(s.deaths, 'Deaths') + stat(kd(s.kills, s.deaths), 'K / D', true) +
      stat(s.wins, 'Wins') + stat(s.matchesPlayed, 'Matches') + stat(s.headshots, 'Headshots') +
    `</div>` +
    `<div class="fs-arms"><span class="fs-arms-label">Weapons</span>` +
      `<div class="fs-arms-list">${arms}</div></div>` +
    (p ? honoursBlock(p) : '');

  // <details> forgets it was open when the markup is replaced
  const earn = careerEl.querySelector('.fs-earn') as HTMLDetailsElement | null;
  earn?.addEventListener('toggle', () => { earnOpen = earn.open; });
}

/* the level bar: progress to the next level, lifetime XP, the next reward */
function xpBlock(p) {
  const pct = p.atCap ? 100 : Math.min(100, (p.into / p.need) * 100);
  const next = p.next
    ? `Next reward · <b>${esc(p.next.name)}</b> at level ${p.next.level}`
    : 'All rewards unlocked';
  return `<div class="fs-xp">` +
    `<div class="fs-xp-line"><span>Level ${p.level}</span>` +
      `<span class="fs-xp-num">${p.atCap ? 'Max level — ' + p.maxLevel
        : `<b>${num(p.into)}</b> / ${num(p.need)} XP`}</span>` +
      `<span>${p.atCap ? '' : 'Level ' + (p.level + 1)}</span></div>` +
    `<div class="xp-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" ` +
      `aria-valuenow="${Math.round(pct)}"><i style="width:${pct.toFixed(1)}%"></i></div>` +
    `<div class="fs-xp-foot"><span>${num(p.xp)} XP in all</span><span>${next}</span></div></div>`;
}

/* everything the player can wear, slot by slot: owned items are buttons (the worn
   one lit), the rest of the level track is shown locked with the level it needs */
function honoursBlock(p) {
  const slots = p.slots.map((slot) => {
    const items = slot.items.map((it) => {
      const cls = (it.owned ? ' owned' : ' locked') + (slot.worn === it.id ? ' worn' : '');
      const swatch = it.color != null ? `<i class="sw" style="background:${hex(it.color)}"></i>` : '';
      const tag = it.owned ? (it.level == null ? '<small>granted</small>' : '')
        : `<small>Lv ${it.level}</small>`;
      return `<button type="button" class="fs-item${cls}" data-slot="${esc(slot.id)}" data-item="${esc(it.id)}"` +
        `${it.owned ? '' : ' disabled'} aria-pressed="${slot.worn === it.id}">${swatch}${esc(it.name)}${tag}</button>`;
    }).join('');
    return `<div class="fs-slot"><div class="fs-slot-head"><span class="fs-arms-label">${esc(slot.label)}</span>` +
      `<span class="fs-slot-blurb">${esc(slot.blurb)}</span></div><div class="fs-items">${items}</div></div>`;
  }).join('');
  const earn = p.sources.map((src) =>
    `<li><span>${esc(src.label)}</span><b>+${num(src.xp)}</b></li>`).join('');
  return `<div class="fs-honours"><div class="fs-honours-title">Rewards</div>${slots}` +
    `<div class="fs-gear-err" role="alert">${esc(gearError)}</div>` +
    `<details class="fs-earn"${earnOpen ? ' open' : ''}><summary>How XP is earned</summary>` +
      `<ul>${earn}</ul><p>XP is tallied when a round ends, for signed-in players only.</p></details></div>`;
}

/* Equip an owned item — or, clicking the one explicitly equipped, take it off
   again and fall back to the slot's default. Convex checks ownership; the
   reactive query repaints the dossier. Then the game server is nudged to re-read
   our look, a moment after the last click so a run of changes is one nudge. */
let nudge = 0;
careerEl?.addEventListener('click', async (e) => {
  const btn = (e.target as HTMLElement).closest?.('.fs-item.owned') as HTMLElement | null;
  if (!btn || !lastProg) return;
  const slotId = btn.dataset.slot, itemId = btn.dataset.item;
  const slot = lastProg.slots.find((sl) => sl.id === slotId);
  if (!slot) return;
  gearError = '';
  try {
    await convex.mutation(api.progression.equip,
      { token: getToken(), slot: slotId, itemId: slot.equipped === itemId ? null : itemId });
    clearTimeout(nudge);
    nudge = window.setTimeout(() => sendNet({ t: 'loadout' }), 1200);
  } catch (err) {
    gearError = String(err?.data ?? 'That could not be changed just now.');
    renderDossier();
  }
});

/* Debug hook (window.__town.dossier): paint the dossier from handed-in data, so
   its level block and honours can be checked with no backend behind them.
   `prog` has the shape of progression.mine, `career` that of stats.myStats. */
let debugSession: { userId: string; username: string } | null = null;
export function debugDossier(prog, career = null, username = 'Wat the Cooper') {
  debugSession = { userId: '', username };
  lastProg = prog; lastCareer = career;
  const intro = document.getElementById('intro');
  intro?.classList.add('signed-in');
  intro?.classList.remove('no-accounts');
  renderDossier();
}

// (re)subscribe to our own career whenever the session changes
let unsubMine = null;
function watchMine(session) {
  if (unsubMine) { unsubMine(); unsubMine = null; }
  if (!session?.userId) { lastCareer = null; lastProg = null; gearError = ''; renderDossier(); return; }
  const unsubCareer = convex.onUpdate(api.stats.myStats, { userId: session.userId }, (s) => {
    lastCareer = s;
    renderDossier();
  });
  // A backend deployed before levels existed has no such query: the dossier then
  // simply renders without its level block rather than failing.
  const unsubProg = convex.onUpdate(api.progression.mine, { userId: session.userId }, (p) => {
    lastProg = p;
    renderDossier();
  }, () => { lastProg = null; renderDossier(); });
  unsubMine = () => { unsubCareer(); unsubProg(); };
}

if (hasConvex) {
  convex.onUpdate(api.stats.leaderboard, { limit: 10 }, (rows) => {
    lastRows = rows || [];
    renderBoard();
    renderDossier(); // board feeds our "standing" line
  });
  watchMine(getSession());
  onAuthChange((session) => {
    watchMine(session);
    renderBoard();   // re-highlight "me" with the new session
    renderDossier(); // refresh name / standing
  });
}
