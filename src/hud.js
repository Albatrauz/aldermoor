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

/* ---- end-of-round overview screen + restart countdown ---- */
const overviewEl=document.getElementById('overview');
const ovWinnerEl=document.getElementById('ovWinner');
const ovCapEl=document.getElementById('ovCap');
const ovRowsEl=document.getElementById('ovRows');
const ovCountEl=document.getElementById('ovCount');
let countTimer=null;

function paintCount(s){
  ovCountEl.textContent = s>0 ? `The next contest begins in ${s}…` : 'Returning to the town…';
}
/* raise the overview with the final tally; m: {winnerId, winnerName, cap, restartIn, standings} */
export function showOverview(m){
  ovWinnerEl.textContent=m.winnerName||'Nobody';
  ovCapEl.textContent=m.cap;
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
