/* ============================ heads-up display ============================ */
// The on-screen tally of scores, the heart pips, and the brief hit/hurt flourishes.
// Holds the local player's health and the shared score table.
import { myId } from './net.js';

const scoresEl=document.getElementById('scores');
const scoreRowsEl=document.getElementById('scoreRows');
const heartsEl=document.getElementById('hearts');
const ammoEl=document.getElementById('ammo');
const killEl=document.getElementById('killscreen');
const killByEl=document.getElementById('killByName');
const killCountEl=document.getElementById('killCount');

export const scoresMap=new Map();
let hp=3;

/* names are player-chosen now — never let them into innerHTML raw */
const esc=s=>String(s).replace(/[&<>"']/g,
  c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* set local health and repaint the hearts in one go */
export function setHp(n){ hp=n; updateHearts(); }
function updateHearts(){
  heartsEl.innerHTML='❤ '.repeat(hp)+
    (hp<3?`<span class="lost">${'❤ '.repeat(3-hp)}</span>`:'');
}
/* shot pips for the handgonne; an italic note while ramming a fresh charge */
export function setAmmo(n, max, reloading){
  ammoEl.innerHTML=reloading
    ? '<span class="ramming">ramming powder…</span>'
    : '● '.repeat(n)+(n<max?`<span class="spent">${'○ '.repeat(max-n)}</span>`:'');
}
export function renderScores(){
  if(myId===null){ scoresEl.style.display='none'; return; }
  scoresEl.style.display='block';
  const rows=[...scoresMap.entries()]
    .sort((a,b)=>b[1].score-a[1].score || a[1].name.localeCompare(b[1].name));
  scoreRowsEl.innerHTML=rows.map(([id,s])=>
    `<div class="sc-row${id===myId?' me':''}"><span>${esc(s.name)}</span><span>${s.score}</span></div>`).join('');
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

/* the death overlay: name the slayer and seed the respawn countdown */
export function showKillscreen(killerName, count){
  killByEl.textContent=killerName;
  killCountEl.textContent=count;
  killEl.classList.add('on');
}
/* repaint the ticking numeral (only on change — it's called every frame) */
export function setKillCount(n){
  if(killCountEl.textContent!==String(n)) killCountEl.textContent=n;
}
export function hideKillscreen(){ killEl.classList.remove('on'); }
