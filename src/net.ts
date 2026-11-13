/* ============================ multiplayer ============================ */
// The WebSocket link to the little node server. Sends a throttled snapshot of
// the local player and routes inbound messages to the villager, hud, zone and
// combat layers. `net`/`myId`/`myName` are exported as live bindings.
import { EYE } from './core';
import { addRemote, dropRemote, renameRemote, remotes, setRemoteWeapon } from './villagers';
import { scoresMap, setHp, renderScores, showXpAward, MAX_HP } from './hud';
import { announce } from './zones';

import { remoteShoot, handleHitFx, handleFell, handleOver, handleRestart, enterField, handleLobby, resetFieldState, weaponIdx } from './combat';

import { player, vel, keys, introVisible } from './controls';
import { getToken, getSession, onAuthChange } from './auth';
import { setMap, mapLabel, mapBlurb, onMapChange, currentMapName } from './world';
import { replayShots } from './voxel';
import { handleNade, handleBoom } from './grenades';
import { showChatMessage, bindChatSend } from './chat';

// Keep the lobby's map nameplate in step with whatever map is live.
const introTitleEl=document.getElementById('introMapTitle');
const introSubEl=document.getElementById('introMapSub');
function showMapPlate(name){
  if(introTitleEl) introTitleEl.textContent=mapLabel(name);
  if(introSubEl) introSubEl.textContent=mapBlurb(name);
}
onMapChange(showMapPlate);
// The first map was built before this listener existed (and may not be the one
// index.html's static plate describes), so fill the plate in once now.
showMapPlate(currentMapName);

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
const nameInputEl=document.getElementById('nameInput') as HTMLInputElement | null;
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
  // step out of the lobby and onto the field: a fresh life + a spawn to the server
  enterField();
});

/* send a JSON message if the socket is open; says whether it went */
export function sendNet(obj){
  if(!(net && net.readyState===1)) return false;
  net.send(JSON.stringify(obj));
  return true;
}
bindChatSend(text => sendNet({ t: 'chat', text }));

function updatePresence(){
  presenceEl.classList.toggle('offline', !net);
  if(!net){ presenceEl.textContent='Reconnecting…'; return; }
  const n=remotes.size+1;
  presenceEl.textContent=`${myName} · ${n} ${n===1?'player':'players'} online`;
}

function connect(){
  if(location.protocol==='file:'){ presenceEl.classList.add('offline'); presenceEl.textContent='Offline — playing solo'; return; }
  let ws;
  // A signed-in player hands the server their session token, which the server
  // trades for a trusted, fixed username. A guest hands their remembered free
  // name (or nothing, and the server picks one). Token wins when both exist.
  const tok=getToken();
  connectedToken=tok;
  const q = tok ? '?token='+encodeURIComponent(tok)
                : (desiredName ? '?name='+encodeURIComponent(desiredName) : '');
  try{ ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws'+q); }
  catch{ presenceEl.classList.add('offline'); presenceEl.textContent='Offline — playing solo'; return; }
  curWs=ws;
  ws.onopen=()=>{ netRetry=1000; };
  ws.onmessage=e=>{
    let m; try{ m=JSON.parse(e.data); }catch{ return; }
    if(m.t==='welcome'){
      myId=m.id; myName=m.name; net=ws;
      // Build the map the server has live right now — from scratch if ours has
      // been shot at, because the round's shots are about to be replayed onto it
      // and they only add up to the right holes on an undamaged map.
      if(m.map) setMap(m.map, true);
      if(Array.isArray(m.shots)) replayShots(m.shots);
      resetFieldState();                 // a fresh socket starts as a lobby spectator
      scoresMap.clear();
      scoresMap.set(myId,{name:myName, score:m.score||0, deaths:m.deaths||0, lvl:m.lvl||0});
      for(const p of m.players){ addRemote(p); scoresMap.set(p.id,{name:p.name, score:p.score||0, deaths:p.deaths||0, lvl:p.lvl||0}); }
      setHp(MAX_HP); renderScores();
      updatePresence();
      announce(`Welcome, ${myName}`);
      // a name typed before the socket finished opening → apply it now as a
      // rename (guests only — a signed-in player's username is fixed)
      if(!getSession() && desiredName && desiredName!==myName) sendNet({t:'name', name:desiredName});
      // a fresh socket lands in the lobby; but if we reconnected while already on
      // the field (e.g. the server bounced), retake it so we're a combatant again
      if(!introVisible) enterField();
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
      scoresMap.set(m.id,{name:m.name, score:m.score||0, deaths:m.deaths||0, lvl:m.lvl||0});
      renderScores();
      updatePresence();
      announce(`${m.name} joined the game`);
    }else if(m.t==='look'){
      // someone's level (or title) changed — us included; keep the tally's badge current
      const s=scoresMap.get(m.id);
      if(s){ s.lvl=m.lvl||0; renderScores(); }
    }else if(m.t==='xp'){
      // what the round just paid us: onto the round-over screen if it is still
      // up, else a passing word (the dossier in the lobby has the full account)
      if(!showXpAward(m)) announce(m.level>m.levelBefore ? `Level up — you reached level ${m.level}` : `+${m.gained} XP`);
    }else if(m.t==='leave'){
      dropRemote(m.id);
      scoresMap.delete(m.id);
      renderScores();
      updatePresence();
      announce(`${m.name} left the game`);
    }else if(m.t==='shoot'){
      remoteShoot(m);
    }else if(m.t==='nade'){
      handleNade(m);
    }else if(m.t==='boom'){
      handleBoom(m);
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
    }else if(m.t==='lobby'){
      if(m.map) setMap(m.map, true);     // the new round rotates the map — swap it in, undamaged, before the menu
      handleLobby();                     // round over — back to the menu + leaderboard, safe
    }else if(m.t==='denied'){
      // tried to take the field while a contest was wrapping up — bounce to the menu
      handleLobby();
      announce(m.restartIn>0 ? `A round is finishing — try again in ${m.restartIn}s` : 'A round is finishing — one moment…');
    }else if(m.t==='chat'){
      showChatMessage({ name: m.name, text: m.text, self: m.id===myId });
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
  if(net && net.readyState===1 && !introVisible){   // only stream state while on the field
    net.send(JSON.stringify({t:'state',
      x:+player.x.toFixed(2), y:+player.y.toFixed(2), z:+player.z.toFixed(2),
      yaw:+player.yaw.toFixed(3),
      m:Math.hypot(vel.x,vel.z)>.4?1:0,
      r:(keys.has('ShiftLeft')||keys.has('ShiftRight'))?1:0,
      w:weaponIdx}));
  }
}, 80);
