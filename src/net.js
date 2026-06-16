/* ============================ multiplayer ============================ */
// The WebSocket link to the little node server. Sends a throttled snapshot of
// the local player and routes inbound messages to the villager, hud, zone and
// combat layers. `net`/`myId`/`myName` are exported as live bindings.
import { EYE } from './core.js';
import { addRemote, dropRemote, renameRemote, remotes, setRemoteWeapon } from './villagers.js';
import { scoresMap, setHp, renderScores, MAX_HP } from './hud.js';
import { announce } from './zones.js';

import { remoteShoot, handleHitFx, handleFell, handleOver, handleRestart, clearDeath, weaponIdx } from './combat.js';

import { player, vel, keys } from './controls.js';
import { getToken, getSession, onAuthChange } from './auth.js';

const presenceEl=document.getElementById('presence');
export let net=null, myId=null, myName=null;
let netRetry=1000;
// the socket we currently care about; a reconnect supersedes any earlier one
let curWs=null;
// the identity token the live connection was opened with — so an auth-change
// that doesn't actually change the token (e.g. the initial session restore)
// leaves the socket alone instead of needlessly re-handshaking
let connectedToken=null;
// a stride between two 80ms snapshots is well under a metre; anything past this
// is a respawn (or debug teleport), so we cut to it rather than glide across town
const WARP_DIST=6;

/* the player's chosen name: remembered across visits, offered to the server on
   connect, and re-sent as a rename when changed from the menu mid-session */
let desiredName='';
try{ desiredName=(localStorage.getItem('aldermoor.name')||'').trim().slice(0,20); }
catch{ /* storage blocked — boot without a remembered name */ }
const nameInputEl=document.getElementById('nameInput');
if(nameInputEl) nameInputEl.value=desiredName;
document.getElementById('enter').addEventListener('click',()=>{
  const n=(nameInputEl?.value||'').trim().slice(0,20);
  if(n!==desiredName){
    desiredName=n;
    try{ localStorage.setItem('aldermoor.name', desiredName); }catch{ /* private mode */ }
  }
  // compare against the *applied* name so re-entering it can reclaim a
  // "Name 2" handed out while a ghost of our own session held the original.
  // Signed-in players keep their account username — never offer a rename.
  if(!getSession() && desiredName && desiredName!==myName) sendNet({t:'name', name:desiredName});
});

/* send a JSON message if the socket is open */
export function sendNet(obj){
  if(net && net.readyState===1) net.send(JSON.stringify(obj));
}

function updatePresence(){
  if(!net){ presenceEl.textContent='⚜ the road is quiet — rejoining…'; return; }
  const n=remotes.size;
  presenceEl.textContent=`⚜ ${myName} · `+
    (n===0?'alone in town':n===1?'one fellow traveller':`${n} fellow travellers`);
}

function connect(){
  if(location.protocol==='file:'){ presenceEl.textContent='⚜ offline — wandering alone'; return; }
  let ws;
  // A signed-in player hands the server their session token, which the server
  // trades for a trusted, fixed username. A guest hands their remembered free
  // name (or nothing, and the server picks one). Token wins when both exist.
  const tok=getToken();
  connectedToken=tok;
  const q = tok ? '?token='+encodeURIComponent(tok)
                : (desiredName ? '?name='+encodeURIComponent(desiredName) : '');
  try{ ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws'+q); }
  catch{ presenceEl.textContent='⚜ offline — wandering alone'; return; }
  curWs=ws;
  ws.onopen=()=>{ netRetry=1000; };
  ws.onmessage=e=>{
    let m; try{ m=JSON.parse(e.data); }catch{ return; }
    if(m.t==='welcome'){
      myId=m.id; myName=m.name; net=ws;
      scoresMap.clear();
      scoresMap.set(myId,{name:myName, score:m.score||0});
      for(const p of m.players){ addRemote(p); scoresMap.set(p.id,{name:p.name, score:p.score||0}); }
      setHp(MAX_HP); renderScores();
      updatePresence();
      announce(`Welcome, ${myName}`);
      // a name typed before the socket finished opening → apply it now as a
      // rename (guests only — a signed-in player's username is fixed)
      if(!getSession() && desiredName && desiredName!==myName) sendNet({t:'name', name:desiredName});
      if(m.over) handleOver(m.over);   // a round was already decided — show the overview
    }else if(m.t==='rename'){
      // the server's authoritative (deduped) name for someone — us included. Keep
      // myName, the live tally and the floating nametag all in lockstep with it.
      const s=scoresMap.get(m.id);
      if(s) s.name=m.name;
      if(m.id===myId) myName=m.name;
      renameRemote(m.id, m.name);
      renderScores();
      updatePresence();
    }else if(m.t==='join'){
      addRemote(m);
      scoresMap.set(m.id,{name:m.name, score:0});
      renderScores();
      updatePresence();
      announce(`${m.name} enters the gates`);
    }else if(m.t==='leave'){
      dropRemote(m.id);
      scoresMap.delete(m.id);
      renderScores();
      updatePresence();
      announce(`${m.name} departs`);
    }else if(m.t==='shoot'){
      remoteShoot(m);
    }else if(m.t==='hitfx'){
      handleHitFx(m);
    }else if(m.t==='hp'){
      setHp(m.hp);                       // the bar regenerating after a lull
    }else if(m.t==='fell'){
      handleFell(m);
    }else if(m.t==='over'){
      handleOver(m);
    }else if(m.t==='restart'){
      handleRestart(m);
    }else if(m.t==='snap'){
      for(const id of Object.keys(m.p)){
        if(+id===myId) continue;
        const v=remotes.get(+id); if(!v) continue;
        const s=m.p[id];
        v.tgt.x=s[0]; v.tgt.y=s[1]-EYE; v.tgt.z=s[2]; v.tgt.yaw=s[3]; v.tgt.m=s[4]; v.tgt.r=s[5];
        if(s[6]!==undefined) setRemoteWeapon(v, s[6]);
        // a leap this far is a respawn/teleport, not a stride — cut to it rather
        // than glide across town (the dead lie frozen; they cut to it as they rise)
        if(!v.deadT && Math.hypot(v.tgt.x-v.cur.x, v.tgt.z-v.cur.z)>WARP_DIST){
          v.cur.x=v.tgt.x; v.cur.y=v.tgt.y; v.cur.z=v.tgt.z; v.cur.yaw=v.tgt.yaw;
        }
      }
    }
  };
  ws.onclose=()=>{
    if(ws!==curWs) return;           // superseded by a reconnect — let it be
    net=null; myId=null; curWs=null;
    for(const id of [...remotes.keys()]) dropRemote(id);
    updatePresence();
    setTimeout(connect, netRetry);
    netRetry=Math.min(netRetry*1.7, 10000);
  };
  ws.onerror=()=>ws.close();
}
connect();

// Logging in or out re-handshakes the socket so the server picks up (or drops)
// our trusted identity — and so stats start/stop being attributed to us. A no-op
// when the token is unchanged (e.g. the initial session restore confirming it).
function reconnect(){
  if(getToken()===connectedToken) return;
  netRetry=1000;
  const old=curWs; curWs=null;       // mark any in-flight socket superseded
  if(old){ try{ old.close(); }catch{ /* already closing */ } }
  connect();
}
onAuthChange(reconnect);

setInterval(()=>{
  if(net && net.readyState===1){
    net.send(JSON.stringify({t:'state',
      x:+player.x.toFixed(2), y:+player.y.toFixed(2), z:+player.z.toFixed(2),
      yaw:+player.yaw.toFixed(3),
      m:Math.hypot(vel.x,vel.z)>.4?1:0,
      r:(keys.has('ShiftLeft')||keys.has('ShiftRight'))?1:0,
      w:weaponIdx}));
  }
}, 80);
