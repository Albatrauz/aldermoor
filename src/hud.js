/* ============================ heads-up display ============================ */
// The on-screen tally of scores, the heart pips, and the brief hit/hurt flourishes.
// Holds the local player's health and the shared score table.
import { myId } from './net.js';

const scoresEl=document.getElementById('scores');
const scoreRowsEl=document.getElementById('scoreRows');
const heartsEl=document.getElementById('hearts');

export const scoresMap=new Map();
let hp=3;

/* set local health and repaint the hearts in one go */
export function setHp(n){ hp=n; updateHearts(); }
function updateHearts(){
  heartsEl.innerHTML='❤ '.repeat(hp)+
    (hp<3?`<span class="lost">${'❤ '.repeat(3-hp)}</span>`:'');
}
export function renderScores(){
  if(myId===null){ scoresEl.style.display='none'; return; }
  scoresEl.style.display='block';
  const rows=[...scoresMap.entries()]
    .sort((a,b)=>b[1].score-a[1].score || a[1].name.localeCompare(b[1].name));
  scoreRowsEl.innerHTML=rows.map(([id,s])=>
    `<div class="sc-row${id===myId?' me':''}"><span>${s.name}</span><span>${s.score}</span></div>`).join('');
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
