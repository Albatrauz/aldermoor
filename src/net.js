/* ============================ multiplayer ============================ */
// The WebSocket link to the little node server. Sends a throttled snapshot of
// the local player and routes inbound messages to the villager, hud, zone and
// combat layers. `net`/`myId`/`myName` are exported as live bindings.
import { EYE } from './core.js';
import { addRemote, dropRemote, remotes } from './villagers.js';
import { scoresMap, setHp, renderScores } from './hud.js';
import { announce } from './zones.js';
import { remoteShoot, handleHitFx, handleFell, handleOver, handleRestart } from './combat.js';
import { player, vel, keys } from './controls.js';

const presenceEl=document.getElementById('presence');
export let net=null, myId=null, myName=null;
let netRetry=1000;

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
  try{ ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws'); }
  catch{ presenceEl.textContent='⚜ offline — wandering alone'; return; }
  ws.onopen=()=>{ netRetry=1000; };
  ws.onmessage=e=>{
    let m; try{ m=JSON.parse(e.data); }catch{ return; }
    if(m.t==='welcome'){
      myId=m.id; myName=m.name; net=ws;
      scoresMap.clear();
      scoresMap.set(myId,{name:myName, score:m.score||0});
      for(const p of m.players){ addRemote(p); scoresMap.set(p.id,{name:p.name, score:p.score||0}); }
      setHp(3); renderScores();
      updatePresence();
      announce(`Welcome, ${myName}`);
      if(m.over) handleOver(m.over);   // a round was already decided — show the overview
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
