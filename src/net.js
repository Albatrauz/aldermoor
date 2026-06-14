/* ============================ multiplayer ============================ */
// The WebSocket link to the little node server. Sends a throttled snapshot of
// the local player and routes inbound messages to the villager, hud, zone and
// combat layers. `net`/`myId`/`myName` are exported as live bindings.
import { EYE } from './core.js';
import { addRemote, dropRemote, renameRemote, remotes } from './villagers.js';
import { scoresMap, setHp, renderScores, MAX_HP } from './hud.js';
import { announce } from './zones.js';

import { remoteShoot, handleHitFx, handleFell, handleOver, handleRestart, clearDeath } from './combat.js';

import { player, vel, keys } from './controls.js';

const presenceEl=document.getElementById('presence');
export let net=null, myId=null, myName=null;
let netRetry=1000;
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
  // "Name 2" handed out while a ghost of our own session held the original
  if(desiredName && desiredName!==myName) sendNet({t:'name', name:desiredName});
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
  // hand the remembered name to the server up front so a returning player keeps
  // their name from the first frame, rather than flashing a server-picked one
  try{ ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws'
    +(desiredName?'?name='+encodeURIComponent(desiredName):'')); }
  catch{ presenceEl.textContent='⚜ offline — wandering alone'; return; }
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
      // a name typed before the socket finished opening → apply it now as a rename
      if(desiredName && desiredName!==myName) sendNet({t:'name', name:desiredName});
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
      }
    }
  };
  ws.onclose=()=>{
    const had=net; net=null; myId=null;
    for(const id of [...remotes.keys()]) dropRemote(id);
    updatePresence();
    if(had!==undefined) setTimeout(connect, netRetry);
    netRetry=Math.min(netRetry*1.7, 10000);
  };
  ws.onerror=()=>ws.close();
}
connect();

setInterval(()=>{
  if(net && net.readyState===1){
    net.send(JSON.stringify({t:'state',
      x:+player.x.toFixed(2), y:+player.y.toFixed(2), z:+player.z.toFixed(2),
      yaw:+player.yaw.toFixed(3),
      m:Math.hypot(vel.x,vel.z)>.4?1:0,
      r:(keys.has('ShiftLeft')||keys.has('ShiftRight'))?1:0}));
  }
}, 80);
