/* ============================ aim down sights ============================ */
// Holding the right mouse button raises the gun to the eye. The state lives here,
// in a module of its own, because two sides need it and neither may import the
// other: combat.ts owns the gun (it decides whether aiming is allowed and eases
// the raise in), controls.ts owns the camera and the feet (it zooms the view,
// scales the mouse and slows the walk by how far the raise has got).
//
//   held  — the right button is down (raw input)
//   t     — how far the gun is raised, 0 = at the hip, 1 = at the eye, eased
//   fov   — the view angle the active weapon zooms to at t = 1
//   speed — walk-speed multiplier at t = 1
export const HIP_FOV = 70;

export const aim = { held: false, t: 0, fov: HIP_FOV, speed: 1 };

/* The field of view at the current raise. */
export const aimFov = () => HIP_FOV + (aim.fov - HIP_FOV) * aim.t;

/* Mouse sensitivity at the current raise, matched to the zoom: the view turns
   by the same fraction of the screen per count of mouse movement, so a sight
   picture doesn't suddenly feel twitchy (zoomed in) or sluggish. */
const tanHalf = (deg: number) => Math.tan(deg * Math.PI / 360);
export const aimSens = () => tanHalf(aimFov()) / tanHalf(HIP_FOV);
