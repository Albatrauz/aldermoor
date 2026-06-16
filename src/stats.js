/* ============================ leaderboard & career ============================ */
// Reactive reads from Convex: the public top-kills board on the intro screen,
// and the signed-in player's own lifetime career line. Both stream over the
// ConvexClient WebSocket via onUpdate, so they refresh the instant a match is
// recorded — no polling, no reload. Guest-only (no Convex) → this is inert.
import { convex, api, hasConvex } from './convex.js';
import { getSession, onAuthChange } from './auth.js';
import { WEAPONS } from './weapons.js';

const lbEl     = document.getElementById('leaderboard');
const lbRowsEl = document.getElementById('lbRows');
const careerEl = document.getElementById('careerPanel');

/* usernames are player-chosen — never let them into innerHTML raw */
const esc = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kd = (k, d) => (k / Math.max(1, d)).toFixed(2);

let lastRows = [];

function renderLeaderboard(rows) {
  if (!lbEl || !lbRowsEl) return;
  if (rows) lastRows = rows;
  lbEl.classList.add('show');
  if (!lastRows.length) {
    lbRowsEl.innerHTML = '<div class="lb-empty">No champions yet — be the first.</div>';
    return;
  }
  const meId = getSession()?.userId;
  lbRowsEl.innerHTML = lastRows.map((r, i) => {
    const me = meId && r.userId === meId ? ' me' : '';
    return `<div class="lb-row${me}"><span class="lb-rank">${i + 1}</span>` +
      `<span class="lb-name">${esc(r.username)}</span>` +
      `<span class="lb-kills">${r.kills}</span></div>`;
  }).join('');
}

function renderCareer(s) {
  if (!careerEl) return;
  if (!s) { careerEl.innerHTML = ''; return; }
  const stat = (v, label) => `<div class="stat"><b>${v}</b><span>${label}</span></div>`;
  // per-weapon breakdown (kills + headshots), labelled from the weapon table
  const wk = s.weaponKills || [], wh = s.weaponHeadshots || [];
  const arms = WEAPONS.map((w, i) =>
    `<div class="arm"><span class="arm-name">${esc(w.name)}</span>` +
    `<b>${wk[i] || 0}</b><span class="arm-hs">${wh[i] || 0} hs</span></div>`).join('');
  careerEl.innerHTML =
    stat(s.kills, 'kills') + stat(s.deaths, 'deaths') + stat(kd(s.kills, s.deaths), 'K/D') +
    stat(s.wins, 'wins') + stat(s.matchesPlayed, 'matches') + stat(s.headshots, 'heads') +
    `<div class="career-arms">${arms}</div>`;
}

// (re)subscribe to our own career whenever the session changes
let unsubMine = null;
function watchMine(session) {
  if (unsubMine) { unsubMine(); unsubMine = null; }
  if (!session?.userId) { renderCareer(null); return; }
  unsubMine = convex.onUpdate(api.stats.myStats, { userId: session.userId }, renderCareer);
}

if (hasConvex) {
  convex.onUpdate(api.stats.leaderboard, { limit: 10 }, renderLeaderboard);
  watchMine(getSession());
  onAuthChange((session) => {
    watchMine(session);
    renderLeaderboard(); // re-highlight "me" with the new session
  });
}
