/* ============================ heads-up display ============================ */
// The on-screen tally of scores, the heart pips, and the brief hit/hurt flourishes.
// Holds the local player's health and the shared score table.
import { myId } from './net';
import { introVisible } from './controls';
import { mapLabel } from './world';

const scoresEl=document.getElementById('scores');
const scoreRowsEl=document.getElementById('scoreRows');
const healthFillEl=document.getElementById('healthFill');
const healthEl=document.getElementById('health');
const ammoEl=document.getElementById('ammo');
const killEl=document.getElementById('killscreen');
const killByEl=document.getElementById('killByName');
const killByLeadEl=document.getElementById('killByLead');
const killCountEl=document.getElementById('killCount');
const ksDamageEl=document.getElementById('ksDamage');

export const MAX_HP=100;          // a full bar — shared with combat & net
export const scoresMap=new Map();
let hp=MAX_HP;

/* names are player-chosen now — never let them into innerHTML raw */
const esc=s=>String(s).replace(/[&<>"']/g,
  c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* set local health and repaint the bar — width plus a gold→crimson tint as it ebbs */
export function setHp(n){
  hp=Math.max(0, Math.min(MAX_HP, n));
  const f=hp/MAX_HP;
  healthFillEl.style.width=(f*100)+'%';
  healthFillEl.style.background=`hsl(${42*f}, 68%, ${34+18*f}%)`;  // 42°gold→0°red
  healthEl.classList.toggle('low', f<=.3);
}
setHp(MAX_HP);                     // start the bar full, even before we connect
/* ammo display: pips for small mags (handgonne), numeric + spare for larger (AK-47) */
export function setAmmo(n, max, reloading, spare=Infinity, weapon=null){
  if(reloading){
    ammoEl.innerHTML=`<span class="ramming">${weapon?.reloadLabel ?? 'reloading…'}</span>`;
    return;
  }
  if(max<=10){
    ammoEl.innerHTML='● '.repeat(n)+(n<max?`<span class="spent">${'○ '.repeat(max-n)}</span>`:'');
  }else{
    ammoEl.innerHTML=`${n}`+(isFinite(spare)?`<span class="spare"> / ${spare}</span>`:'');
  }
}
const nadesEl=document.getElementById('nades');
export function setNades(n, max){
  nadesEl.innerHTML='✹ '.repeat(n)+(n<max?`<span class="spent">${'✹ '.repeat(max-n)}</span>`:'');
}

/* the fuse ring round the crosshair: `left` is the fraction of the fuse still to burn */
const nadeRingEl=document.getElementById('nadeRing');
const nadeFillEl=nadeRingEl.querySelector('.fill') as SVGCircleElement;
const RING_C=2*Math.PI*20;
nadeFillEl.style.strokeDasharray=String(RING_C);
export function setNadeRing(left: number | null){
  if(left===null){ nadeRingEl.classList.remove('on','urgent'); return; }
  nadeRingEl.classList.add('on');
  nadeRingEl.classList.toggle('urgent', left<.3);
  nadeFillEl.style.strokeDashoffset=(RING_C*left).toFixed(2);
  nadeFillEl.style.stroke=`hsl(${42*left}, ${55+30*(1-left)}%, ${86-36*(1-left)}%)`;
}

export function renderScores(){
  if(myId===null){ scoresEl.style.display='none'; return; }
  scoresEl.style.display='block';
  const rows=[...scoresMap.entries()]
    .sort((a,b)=>b[1].score-a[1].score || a[1].name.localeCompare(b[1].name));
  scoreRowsEl.innerHTML=rows.map(([id,s])=>
    `<div class="sc-row${id===myId?' me':''}"><span>${esc(s.name)}</span><span>${s.score}</span></div>`).join('');
  refreshScoreboard();   // keep a held-open Tab board in step with the live tally
}
export function hurtFlash(){
  const el=document.getElementById('hurt');
  el.classList.add('on');
  setTimeout(()=>el.classList.remove('on'),130);
}
export function hitmark(){
  const el=document.getElementById('hitmark');
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
}

/* ---- end-of-round overview screen + restart countdown ---- */
const overviewEl=document.getElementById('overview');
const ovWinnerEl=document.getElementById('ovWinner');
const ovCapEl=document.getElementById('ovCap');
const ovRowsEl=document.getElementById('ovRows');
const ovCountEl=document.getElementById('ovCount');
const ovNextEl=document.getElementById('ovNext');
let countTimer=null;

function paintCount(s){
  ovCountEl.textContent = s>0 ? `The next contest begins in ${s}…` : 'Returning to the town…';
}
/* raise the overview with the final tally; m: {winnerId, winnerName, cap, restartIn, standings, nextMap} */
export function showOverview(m){
  ovWinnerEl.textContent=m.winnerName||'Nobody';
  ovCapEl.textContent=m.cap;
  if(ovNextEl) ovNextEl.textContent=m.nextMap ? `Next field · ${mapLabel(m.nextMap)}` : '';
  ovRowsEl.innerHTML=(m.standings||[]).map((s,i)=>{
    const cls=(s.id===m.winnerId?' win':'')+(s.id===myId?' me':'');
    const rank=s.id===m.winnerId?'♛':i+1;
    return `<div class="ov-row${cls}"><span class="ov-rank">${rank}</span>`+
      `<span class="ov-name">${s.name}</span><span class="ov-score">${s.score}</span></div>`;
  }).join('');
  let secs=Math.max(0, Math.round(m.restartIn ?? 20));
  paintCount(secs);
  clearInterval(countTimer);
  countTimer=setInterval(()=>{
    secs=Math.max(0, secs-1);
    paintCount(secs);
    if(secs<=0) clearInterval(countTimer);
  }, 1000);
  overviewEl.classList.add('show');
}
export function hideOverview(){
  clearInterval(countTimer); countTimer=null;
  overviewEl.classList.remove('show');
}
/* the death overlay: name the slayer, tally the wounds, seed the respawn countdown */
export function showKillscreen(killerName, count, dmg, head, killerId, self=false){
  killByLeadEl.textContent=self ? 'undone by' : 'by the hand of';
  killByEl.textContent=self ? 'your own grenade' : killerName;
  killCountEl.textContent=count;
  renderDamage(dmg, head, killerId);
  killEl.classList.add('on');
}
/* the life's-end breakdown: who dealt how much, best first, with a share bar each */
function renderDamage(dmg, head, killerId){
  if(!Array.isArray(dmg) || !dmg.length){ ksDamageEl.innerHTML=''; return; }
  const max=Math.max(...dmg.map(d=>d.dmg), 1);
  const rows=dmg.map(d=>{
    const pct=Math.max(4, Math.round(d.dmg/max*100));
    const slayer=d.id===killerId ? ' killer' : '';
    const name=d.id===myId ? 'Your own grenade' : d.name;   // the only way to wound yourself
    return `<div class="dmg-row${slayer}"><span class="dmg-name">${esc(name)}</span>`+
      `<span class="dmg-bar"><i style="width:${pct}%"></i></span>`+
      `<span class="dmg-val">${Math.round(d.dmg)}</span></div>`;
  }).join('');
  ksDamageEl.innerHTML=`<div class="dmg-title">Wounds you suffered`+
    `${head?` · <span class="dmg-head">a ball to the head</span>`:''}</div>${rows}`;
}
/* repaint the ticking numeral (only on change — it's called every frame) */
export function setKillCount(n){
  if(killCountEl.textContent!==String(n)) killCountEl.textContent=n;
}
export function hideKillscreen(){ killEl.classList.remove('on'); }

/* ---- the Tab scoreboard: the full roll of kills & deaths, held open while Tab is down ---- */
const scoreboardEl=document.getElementById('scoreboard');
const sbRowsEl=document.getElementById('sbRows');
let scoreboardOpen=false;

/* paint the board from the shared tally: kills, and the deaths we now track
   beside them — best record first (most kills, then fewest deaths, then name) */
function renderScoreboard(){
  const rows=[...scoresMap.entries()].sort((a,b)=>
    b[1].score-a[1].score || (a[1].deaths||0)-(b[1].deaths||0) || a[1].name.localeCompare(b[1].name));
  sbRowsEl.innerHTML=rows.map(([id,s])=>
    `<div class="sb-row${id===myId?' me':''}"><span class="sb-name">${esc(s.name)}</span>`+
    `<span class="sb-num">${s.score||0}</span><span class="sb-num">${s.deaths||0}</span></div>`).join('');
}
/* called from renderScores so an open board stays live as kills/deaths land */
function refreshScoreboard(){ if(scoreboardOpen) renderScoreboard(); }

function openScoreboard(){
  if(scoreboardOpen) return;
  scoreboardOpen=true;
  renderScoreboard();
  scoreboardEl.classList.add('show');
}
function closeScoreboard(){
  if(!scoreboardOpen) return;
  scoreboardOpen=false;
  scoreboardEl.classList.remove('show');
}
// hold Tab to read the room; release to dismiss it. We only claim Tab once in the
// fight (so the menu keeps its normal focus-walk), and preventDefault stops a held
// Tab from tabbing focus off the canvas while the board is up.
addEventListener('keydown',e=>{
  if(e.code!=='Tab' || myId===null || introVisible) return;
  e.preventDefault();
  openScoreboard();
});
addEventListener('keyup',e=>{
  if(e.code!=='Tab' || !scoreboardOpen) return;
  e.preventDefault();
  closeScoreboard();
});
// alt-tabbing away never delivers the keyup — don't leave the board stranded open
addEventListener('blur', closeScoreboard);
