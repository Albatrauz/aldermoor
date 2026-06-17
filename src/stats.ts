/* ============================ leaderboard & career ============================ */
// Reactive reads from Convex: the public top-kills board on the intro screen,
// and the signed-in player's own lifetime career line. Both stream over the
// ConvexClient WebSocket via onUpdate, so they refresh the instant a match is
// recorded — no polling, no reload. Guest-only (no Convex) → this is inert.
import { convex, api, hasConvex } from './convex';
import { getSession, onAuthChange } from './auth';
import { WEAPONS } from './weapons';

const lbEl      = document.getElementById('leaderboard');
const lbRowsEl  = document.getElementById('lbRows');
const lbCountEl = document.getElementById('lbCount');
const careerEl  = document.getElementById('careerPanel');

/* usernames are player-chosen — never let them into innerHTML raw */
const esc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kd = (k, d) => (k / Math.max(1, d)).toFixed(2);

/* roman numerals for the board ranks (the algorithm repeats X, so any n works) */
function toRoman(n) {
  const map: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of map) { while (n >= v) { out += s; n -= v; } }
  return out;
}

// the two reactive streams land independently; cache the latest of each so a
// re-render (board → standing, session → me-highlight) always has both halves
let lastRows = [];
let lastCareer = null;

function renderBoard() {
  if (!lbEl || !lbRowsEl) return;
  lbEl.classList.add('show');
  if (lbCountEl) {
    lbCountEl.textContent = lastRows.length
      ? `${lastRows.length} ${lastRows.length === 1 ? 'soul' : 'souls'} registered` : '';
  }
  if (!lastRows.length) {
    lbRowsEl.innerHTML = '<div class="lb-empty">No champions yet — be the first.</div>';
    return;
  }
  const meId = getSession()?.userId;
  lbRowsEl.innerHTML = lastRows.map((r, i) => {
    const me = meId && r.userId === meId ? ' me' : '';
    return `<div class="lb-row${me}">` +
      `<span class="lb-rank">${toRoman(i + 1)}</span>` +
      `<span class="lb-name">${esc(r.username)}</span>` +
      `<span class="lb-kills">${r.kills}</span>` +
      `<span class="lb-kd">${kd(r.kills, r.deaths)}</span>` +
      `<span class="lb-wins">${r.wins}</span>` +
      `<span class="lb-heads">${r.headshots}</span></div>`;
  }).join('');
}

function renderDossier() {
  if (!careerEl) return;
  const session = getSession();
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
    ? `rank ${toRoman(idx + 1)} of ${lastRows.length} on the sand`
    : (s.matchesPlayed ? 'beyond the ranked' : 'unranked recruit');

  const stat = (v, label, gold?) =>
    `<div class="fs-stat${gold ? ' gold' : ''}"><b>${v}</b><span>${label}</span></div>`;

  // per-weapon kills + headshots, labelled from the weapon table
  const wk = s.weaponKills || [], wh = s.weaponHeadshots || [];
  const arms = WEAPONS.map((w, i) =>
    `<span class="fs-arm">${esc(w.name)} <b>${wk[i] || 0}</b>` +
    `<span class="hs">${wh[i] || 0} hs</span></span>`).join('');

  careerEl.innerHTML =
    `<div class="fs-doss-head"><div>` +
      `<div class="fs-doss-eyebrow">Field dossier</div>` +
      `<div class="fs-doss-name">${esc(name)}</div></div>` +
      `<div class="fs-doss-standing">${standing}</div></div>` +
    `<div class="fs-statgrid">` +
      stat(s.kills, 'Kills') + stat(s.deaths, 'Deaths') + stat(kd(s.kills, s.deaths), 'K / D', true) +
      stat(s.wins, 'Wins') + stat(s.matchesPlayed, 'Matches') + stat(s.headshots, 'Heads') +
    `</div>` +
    `<div class="fs-arms"><span class="fs-arms-label">Arms</span>` +
      `<div class="fs-arms-list">${arms}</div></div>`;
}

// (re)subscribe to our own career whenever the session changes
let unsubMine = null;
function watchMine(session) {
  if (unsubMine) { unsubMine(); unsubMine = null; }
  if (!session?.userId) { lastCareer = null; renderDossier(); return; }
  unsubMine = convex.onUpdate(api.stats.myStats, { userId: session.userId }, (s) => {
    lastCareer = s;
    renderDossier();
  });
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
