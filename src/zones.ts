/* ============================ zones & toasts ============================ */
// Dust2 location callouts that raise a fleeting toast as you enter them.
// `announce` is also used by the net layer for join/leave/kill messages.
// Order matters: the first matching circle wins, so specific spots come first.
import { player, introVisible } from './controls';

const zones=[
  {x:-66,z:30, r:6,  name:'Long Doors'},
  {x:-2, z:0,  r:6,  name:'Mid Doors'},
  {x:12, z:-20,r:6,  name:'B Doors'},
  {x:4,  z:16, r:9,  name:'Catwalk'},
  {x:-69,z:24, r:8,  name:'Outside Long'},
  {x:-40,z:40, r:16, name:'Long A'},
  {x:13, z:44, r:14, name:'Bombsite A'},
  {x:32, z:35, r:7,  name:'A Ramp'},
  {x:-57,z:-21,r:14, name:'Upper Tunnels'},
  {x:-29,z:-34,r:12, name:'Lower Tunnels'},
  {x:2,  z:-36,r:13, name:'Bombsite B'},
  {x:55, z:35, r:14, name:'CT to A'},
  {x:45, z:-18,r:14, name:'CT to B'},
  {x:-20,z:0,  r:14, name:'Mid'},
  {x:30, z:0,  r:12, name:'CT Mid'},
  {x:-70,z:12, r:9,  name:'T Upper'},
  {x:-105,z:0, r:15, name:'T Spawn'},
  {x:95, z:2,  r:17, name:'CT Spawn'},
];
const toast=document.getElementById('toast');
const toastText=document.getElementById('toastText');
let curZone=null, toastTimer=0;

export function announce(text){
  toastText.textContent=text;
  toast.classList.add('show');
  toastTimer=3.0;
}
function zoneAt(){
  for(const z of zones){
    const dx=player.x-z.x, dz=player.z-z.z;
    if(dx*dx+dz*dz < z.r*z.r) return z.name;
  }
  return null;
}
/* adopt the current zone without calling it out — a respawn teleport must not
   stamp its location toast over the "Felled by …" message */
export function syncZone(){ curZone=zoneAt(); }
function checkZones(){
  const found=zoneAt();
  if(found && found!==curZone) announce(found);
  curZone=found;
}

/* per-frame: fade the toast out and, while playing, watch for zone changes */
export function update(dt){
  if(toastTimer>0){ toastTimer-=dt; if(toastTimer<=0) toast.classList.remove('show'); }
  if(!introVisible) checkZones();
}
