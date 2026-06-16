/* ============================ accounts ============================ */
// Sign-up / sign-in against Convex, a remembered session token, and the intro
// screen's account panel. Only the *token* (never the password) travels to the
// game server on connect, so a signed-in player's username is server-trusted
// and fixed. Guests skip all of this and keep the free-text name field.
//
// We reuse the reactive ConvexClient from convex.js for the one-shot
// action/mutation/query calls here — no second client, no second URL.
import { convex, api, hasConvex } from './convex.js';

const TOKEN_KEY = 'aldermoor.token';

let token = '';
try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch { /* storage blocked */ }
let session = null;            // { userId, username } once verified, else null
const listeners = new Set();

export function getToken(){ return token; }
export function getSession(){ return session; }
/* subscribe to login/logout; returns an unsubscribe fn. Fires with the session. */
export function onAuthChange(fn){ listeners.add(fn); return ()=>listeners.delete(fn); }
function emit(){ for(const fn of listeners){ try{ fn(session); }catch{ /* ignore */ } } }

function setToken(t){
  token = t || '';
  try{ token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); }
  catch{ /* private mode — session just won't persist */ }
}

/* ---- intro panel elements ---- */
const introEl  = document.getElementById('intro');
const panel    = document.getElementById('authPanel');
const form     = document.getElementById('authForm');
const userEl   = document.getElementById('authUser');
const passEl   = document.getElementById('authPass');
const submitEl = document.getElementById('authSubmit');
const toggleEl = document.getElementById('authToggle');
const errEl    = document.getElementById('authError');
const meNameEl = document.getElementById('authMeName');
const logoutEl = document.getElementById('authLogout');

let mode = 'login';   // 'login' | 'signup'

function showError(msg){ if(errEl) errEl.textContent = msg || ''; }
function setBusy(b){ if(submitEl) submitEl.disabled = b; }

/* reflect the current session into the panel + intro screen */
function paint(){
  if(panel) panel.dataset.auth = hasConvex ? (session ? 'in' : 'out') : 'off';
  if(introEl){
    introEl.classList.toggle('signed-in', !!session);
    introEl.classList.toggle('no-accounts', !hasConvex);
  }
  if(session && meNameEl) meNameEl.textContent = session.username;
}

/* swap the form between logging in and forging a new name */
function setMode(m){
  mode = m;
  if(submitEl) submitEl.textContent = m==='signup' ? 'Take an oath' : 'Return to arms';
  if(toggleEl) toggleEl.textContent = m==='signup' ? 'Already sworn? Log in' : 'New here? Forge a name';
  if(passEl) passEl.autocomplete = m==='signup' ? 'new-password' : 'current-password';
  showError('');
}

/* Convex wraps thrown errors; pull out the readable message we threw server-side */
function prettyError(err){
  let m = err && err.message ? String(err.message) : 'Something went wrong.';
  m = m.replace(/^\[[^\]]*\]\s*/, '').replace(/^Uncaught\s+(Convex)?Error:\s*/i, '');
  const nl = m.indexOf('\n'); if(nl > 0) m = m.slice(0, nl);
  return m.trim() || 'Something went wrong.';
}

/* on load (and after a sign-in), confirm the token and learn our userId */
async function restore(){
  if(hasConvex && token){
    try{
      const s = await convex.query(api.auth.userByToken, { token });
      session = s || null;
      if(!s) setToken('');            // stale/expired — forget it
    }catch{ session = null; }
  }else{
    session = null;
  }
  paint();
  emit();
}

async function submit(e){
  e?.preventDefault?.();
  if(!hasConvex){ showError('Accounts are unavailable right now.'); return; }
  const username = (userEl?.value || '').trim();
  const password = passEl?.value || '';
  if(!username || !password){ showError('A name and a password, if you please.'); return; }
  setBusy(true); showError('');
  try{
    const res = await convex.action(mode==='signup' ? api.auth.signUp : api.auth.signIn,
      { username, password });
    setToken(res.token);
    if(passEl) passEl.value = '';
    await restore();                  // verify + fetch userId, then notify listeners
  }catch(err){
    showError(prettyError(err));
  }finally{
    setBusy(false);
  }
}

async function logout(){
  const t = token;
  setToken(''); session = null;
  paint(); emit();
  if(hasConvex && t){ try{ await convex.mutation(api.auth.signOut, { token: t }); }catch{ /* ignore */ } }
}

/* ---- wire the panel ---- */
form?.addEventListener('submit', submit);
toggleEl?.addEventListener('click', ()=> setMode(mode==='signup' ? 'login' : 'signup'));
logoutEl?.addEventListener('click', logout);
// typing in the auth fields must not leak into the game's key handlers
for(const el of [userEl, passEl]){
  el?.addEventListener('keydown', (e)=> e.stopPropagation());
}

setMode('login');
paint();      // immediate first paint (guest/off) before the async restore lands
restore();
