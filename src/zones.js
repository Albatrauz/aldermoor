/* ============================ zones & toasts ============================ */
// Named places around town that raise a fleeting parchment toast as you enter
// them. `announce` is also used by the net layer for join/leave/kill messages.
import { player, introVisible } from './controls.js';
import { WELL } from './world.js';

const zones=[
  {x:12,z:-8,r:7.5,name:'Ye Gilded Boar'},
  {x:0,z:-26,r:13,name:'Chapel of St. Alric'},
  {x:0,z:42,r:8,name:'The South Gate'},
  {x:WELL.x,z:WELL.z,r:11,name:'The Market Square'},
  {x:0,z:66,r:18,name:'The Weald Road'},
];
const toast=document.getElementById('toast');
const toastText=document.getElementById('toastText');
let curZone=null, toastTimer=0;

export function announce(text){
  toastText.textContent=text;
  toast.classList.add('show');
  toastTimer=3.0;
}
function checkZones(){
  let found=null;
  for(const z of zones){
    const dx=player.x-z.x, dz=player.z-z.z;
    if(dx*dx+dz*dz < z.r*z.r){ found=z.name; break; }
  }
  if(found && found!==curZone) announce(found);
  curZone=found;
}

/* per-frame: fade the toast out and, while playing, watch for zone changes */
export function update(dt){
  if(toastTimer>0){ toastTimer-=dt; if(toastTimer<=0) toast.classList.remove('show'); }
  if(!introVisible) checkZones();
}
