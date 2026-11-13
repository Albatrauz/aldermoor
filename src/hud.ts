/* ============================ heads-up display ============================ */
// The on-screen tally of scores, the heart pips, and the brief hit/hurt flourishes.
// Holds the local player's health and the shared score table.
import { myId } from './net';
import { introVisible, chatOpen } from './controls';
import { mapLabel } from './world';
import { getSession } from './auth';
import { hasConvex } from './convex';

const scoresEl=document.getElementById('scores');
const scoreRowsEl=document.getElementById('scoreRows');
const healthFillEl=document.getElementById('healthFill');
const healthEl=document.getElementById('health');
const hpNumEl=document.getElementById('hpNum');
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
/* a signed-in player's level, as a small badge before their name (guests have none) */
const lvlBadge=lvl=>lvl>0?`<i class="lvl">${lvl|0}</i>`:'';
const num=n=>Math.round(n||0).toLocaleString('en-US');

/* set local health and repaint the bar — RB-Media cyan while healthy, warning red when low */
export function setHp(n){
  hp=Math.max(0, Math.min(MAX_HP, n));
  const f=hp/MAX_HP;
  healthFillEl.style.width=(f*100)+'%';
  if(hpNumEl) hpNumEl.textContent=String(Math.ceil(hp));
  healthEl.classList.toggle('mid', f<=.6 && f>.3);
  healthEl.classList.toggle('low', f<=.3);
}
setHp(MAX_HP);                     // start the bar full, even before we connect
/* ammo display: weapon label over a big round count — pips for small mags (handgonne),
   numeric + spare for larger (AK-47) */
const pips=(n,max)=>'<span class="pips">'+
  '<i class="pip"></i>'.repeat(n)+'<i class="pip spent"></i>'.repeat(Math.max(0,max-n))+'</span>';
export function setAmmo(n, max, reloading, spare=Infinity, weapon=null){
  const label=weapon?.name ? `<span class="ammo-label">${esc(weapon.name)}</span>` : '';
  if(reloading){
    ammoEl.innerHTML=label+`<span class="ramming">${weapon?.reloadLabel ?? 'reloading…'}</span>`;
    return;
  }
  if(max<=10){
    ammoEl.innerHTML=label+pips(n,max);
  }else{
    ammoEl.innerHTML=label+`<span class="ammo-num${n===0?' empty':''}">${n}</span>`+
      (isFinite(spare)?`<span class="spare">/ ${spare}</span>`:'');
  }
}
const nadesEl=document.getElementById('nades');
export function setNades(n, max){
  nadesEl.innerHTML='<span class="ammo-label">Grenades</span>'+pips(n,max);
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
/* A grenade going off next to you: a white-hot flash, and past a hard hit a dark vignette
   (plus a brief desaturation of the scene) that lingers. Restarts cleanly, keeps the stronger. */
let flashK=0, flashT=0, stunK=0, stunT=0, stunTO=0;
const calm=matchMedia('(prefers-reduced-motion: reduce)');
export function concuss(k:number){
  k=Math.max(0,Math.min(1,k)); if(k<.02) return;
  const fl=document.getElementById('flash'), st=document.getElementById('stun');
  const scene=document.getElementById('scene');
  const now=performance.now();
  // a still-bright earlier flash wins over a weaker new one
  const left=Math.max(0,1-(now-flashT)/(500+400*flashK));
  if(k>=flashK*left){
    flashK=k; flashT=now;
    const peak=Math.min(.85,.25+.6*k)*(calm.matches?.5:1);
    const fade=300+300*k;
    fl.style.transition='none'; fl.style.opacity=String(peak);
    void fl.offsetWidth;
    setTimeout(()=>{ if(flashT!==now) return;
      fl.style.transition=`opacity ${fade}ms ease-out`; fl.style.opacity='0'; },50+30*k);
  }
  if(k>.45){
    const sleft=Math.max(0,1-(now-stunT)/(1500+1500*stunK));
    if(k>=stunK*sleft){
      stunK=k; stunT=now;
      const dur=1500+1500*k, peak=Math.min(1,.4+.7*k)*(calm.matches?.6:1);
      st.style.transition='none'; st.style.opacity=String(peak);
      void st.offsetWidth;
      st.style.transition=`opacity ${dur}ms ease-in`; st.style.opacity='0';
      if(scene){
        scene.style.transition='filter 80ms';
        scene.classList.add('stunned');
        clearTimeout(stunTO);
        stunTO=window.setTimeout(()=>{
          scene.style.transition=`filter ${dur*.6}ms ease-out`;
          scene.classList.remove('stunned');
        },dur*.4);
      }
    }
  }
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
const ovXpEl=document.getElementById('ovXp');
let countTimer=null;

function paintCount(s){
  ovCountEl.textContent = s>0 ? `Next round in ${s}s` : 'Loading next round…';
}
/* raise the overview with the final tally; m: {winnerId, winnerName, cap, restartIn, standings, nextMap} */
export function showOverview(m){
  ovWinnerEl.textContent=m.winnerName||'Nobody';
  ovCapEl.textContent=m.cap;
  if(ovNextEl) ovNextEl.textContent=m.nextMap ? `Next map · ${mapLabel(m.nextMap)}` : '';
  ovRowsEl.innerHTML=(m.standings||[]).map((s,i)=>{
    const cls=(s.id===m.winnerId?' win':'')+(s.id===myId?' me':'');
    return `<div class="ov-row${cls}"><span class="ov-rank">${i+1}</span>`+
      `<span class="ov-name">${lvlBadge(s.lvl)}${esc(s.name)}</span><span class="ov-score">${s.score}</span></div>`;
  }).join('');
  // the round's XP lands a moment later (showXpAward); a guest is told why none will
  if(ovXpEl){
    ovXpEl.innerHTML = hasConvex && !getSession()
      ? '<div class="ov-xp-hint">Guests don’t earn XP — log in to level up.</div>' : '';
  }
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
/* What the round paid out, on the overview: the XP and where it came from, the
   level bar filling to its new mark, and anything the new level unlocked.
   a: {gained, parts:[{label,count,xp}], levelBefore, level, into, need, atCap, unlocked:[{name,slot}]}
   Says whether it was shown — the overview may already be gone. */
export function showXpAward(a){
  if(!ovXpEl || !overviewEl.classList.contains('show')) return false;
  const up=a.level>a.levelBefore;
  const pct=a.atCap ? 100 : Math.min(100, a.into/a.need*100);
  const parts=(a.parts||[]).map(p=>
    `<span>${esc(p.label)}${p.count>1?` ×${p.count}`:''} <b>+${num(p.xp)}</b></span>`).join('');
  const unlocked=(a.unlocked||[]).map(u=>
    `<div class="ov-xp-unlock">Unlocked · <b>${esc(u.name)}</b> <small>${esc(u.slot)}</small></div>`).join('');
  ovXpEl.innerHTML=
    `<div class="ov-xp-gain">+${num(a.gained)} XP</div>`+
    `<div class="ov-xp-parts">${parts}</div>`+
    `<div class="ov-xp-level"><span>Level ${a.level}</span>`+
      `<div class="xp-bar"><i style="width:0%"></i></div>`+
      `<span>${a.atCap?'Max level':num(a.into)+' / '+num(a.need)}</span></div>`+
    (up?`<div class="ov-xp-up">Level up — level ${a.level}</div>`:'')+unlocked;
  // from empty on a level-up, so the bar is seen to fill; the transition is CSS
  const fill=ovXpEl.querySelector('.xp-bar i') as HTMLElement;
  void fill.offsetWidth;
  fill.style.width=pct.toFixed(1)+'%';
  return true;
}
/* the death overlay: name the slayer, tally the wounds, seed the respawn countdown */
export function showKillscreen(killerName, count, dmg, head, killerId, self=false){
  killByLeadEl.textContent='by';
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
  ksDamageEl.innerHTML=`<div class="dmg-title">Damage taken`+
    `${head?` · <span class="dmg-head">headshot</span>`:''}</div>${rows}`;
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
    `<div class="sb-row${id===myId?' me':''}"><span class="sb-name">${lvlBadge(s.lvl)}${esc(s.name)}</span>`+
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
  if(e.code!=='Tab' || myId===null || introVisible || chatOpen) return;
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
