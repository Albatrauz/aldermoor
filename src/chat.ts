/* ============================ in-game chat ============================ */
// T opens a composer on the right. Typed keys go into that field: Enter sends,
// Esc puts the gun back in your hands. Lines the server relays — yours included —
// arrive on the left, centred as a stack, and fade once the fight needs the
// screen back. A heavy shadow keeps them readable on sand and in the tunnels.

import { canvas } from './core';
import { introVisible, chatOpen, setChatOpen, releaseMenuSuppress, keys, dragLook } from './controls';

const LIFE = 8000;
const FADE = 900;
const MAX_LINES = 8;
const SEND_GAP = 400;

const log = document.getElementById('chatLog') as HTMLDivElement;
const box = document.getElementById('chatBox') as HTMLDivElement;
const input = document.getElementById('chatInput') as HTMLInputElement;
const intro = document.getElementById('intro') as HTMLElement;

type Row = { el: HTMLDivElement; at: number };
const rows: Row[] = [];
let deliver: (text: string) => boolean = () => false;
let lastSent = 0;

export function bindChatSend(fn: (text: string) => boolean) { deliver = fn; }

function clean(v: string) {
  return v.replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/* a line the server (or a solo fallback) handed us. Kept as text, never HTML. */
export function showChatMessage(m: { name?: string; text?: string; self?: boolean }) {
  const text = clean(String(m.text ?? ''));
  if (!text) return;
  const row = document.createElement('div');
  row.className = 'chat-line' + (m.self ? ' self' : '');
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = String(m.name || 'Player');
  const what = document.createElement('span');
  what.className = 'what';
  what.textContent = text;
  row.append(who, document.createTextNode(' '), what);
  log.append(row);
  rows.push({ el: row, at: performance.now() });
  while (rows.length > MAX_LINES) rows.shift()?.el.remove();
}

function paint() {
  const now = performance.now();
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    const age = now - row.at;
    if (!chatOpen && age >= LIFE + FADE) {
      row.el.remove();
      rows.splice(i, 1);
      continue;
    }
    row.el.style.opacity = chatOpen || age <= LIFE
      ? '1'
      : String(Math.max(0, 1 - (age - LIFE) / FADE));
  }
}
setInterval(paint, 80);

function openChat() {
  if (chatOpen || introVisible) return;
  setChatOpen(true);
  keys.clear();
  box.classList.add('open');
  box.setAttribute('aria-hidden', 'false');
  // pointer lock would keep the mouse steering while typing, and Escape would
  // mean "leave the game" instead of "close the box"
  try { document.exitPointerLock(); } catch { /* already free */ }
  setTimeout(() => { if (chatOpen) input.focus({ preventScroll: true }); }, 0);
}

function closeChat(relock: boolean) {
  if (!chatOpen) return;
  setChatOpen(false);
  input.value = '';
  input.blur();
  box.classList.remove('open');
  box.setAttribute('aria-hidden', 'true');
  if (relock && !introVisible && !dragLook) {
    const pending = canvas.requestPointerLock?.();
    if (pending && typeof pending.catch === 'function') pending.catch(() => {});
  }
  // the unlock Escape just caused (or the one from opening the box) must land
  // before the menu is allowed to notice a missing pointer lock
  setTimeout(releaseMenuSuppress, 400);
}

function send() {
  const text = clean(input.value);
  if (!text) return;
  const now = performance.now();
  if (now - lastSent < SEND_GAP) return;
  lastSent = now;
  input.value = '';
  // no socket (solo file, or still reconnecting): show it locally so Enter did something
  if (!deliver(text)) showChatMessage({ name: 'You', text, self: true });
}

addEventListener('keydown', e => {
  if (!chatOpen || e.code !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  closeChat(true);
}, true);

addEventListener('keydown', e => {
  if (chatOpen || e.code !== 'KeyT' || e.repeat) return;
  if (e.metaKey || e.ctrlKey || e.altKey || introVisible) return;
  const target = e.target;
  if (target instanceof HTMLElement && target.closest('input, textarea')) return;
  e.preventDefault();
  e.stopPropagation();
  openChat();
}, true);

input.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter') {
    e.preventDefault();
    send();
  } else if (e.code === 'Tab') {
    e.preventDefault();
  }
});
box.addEventListener('mousedown', e => e.stopPropagation());
box.addEventListener('mouseup', e => e.stopPropagation());
box.addEventListener('pointerdown', e => e.stopPropagation());

function syncMenu() {
  const menu = !intro.classList.contains('hidden');
  log.classList.toggle('away', menu);
  if (menu) closeChat(false);
}
new MutationObserver(syncMenu).observe(intro, { attributes: true, attributeFilter: ['class'] });
syncMenu();
