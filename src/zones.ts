/* ============================ zones & toasts ============================ */
// Per-map location callouts that raise a fleeting toast as you enter them. The
// live list comes from the active map (world.ZONES, refilled on a map switch).
// `announce` is also used by the net layer for join/leave/kill messages.
// Order matters: the first matching circle wins, so specific spots come first.
import { player, introVisible } from './controls';
import { ZONES as zones } from './world';

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
