/* ============================ in-game chat ============================ */
// T opens a composer on the right. Typed keys go into that field: Enter sends
// and closes it, Esc closes it without sending. The mouse stays captured the
// whole time, so closing the box hands the gun straight back. Lines the server relays — yours included —
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
  who.textContent = String(m.name || 'Player') + ':';
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
  // pointer lock stays: keys reach the focused field regardless, and the look
  // handler already stands down while chatOpen
  setTimeout(() => { if (chatOpen) input.focus({ preventScroll: true }); }, 0);
}

function closeChat() {
  if (!chatOpen) return;
  setChatOpen(false);
  input.value = '';
  input.blur();
  box.classList.remove('open');
  box.setAttribute('aria-hidden', 'true');
  // Escape may have cost us the pointer lock; that unlock must land before the
  // menu is allowed to notice it. A click on the canvas takes the lock back.
  setTimeout(releaseMenuSuppress, 400);
}

/* true when the box may close: sent, or nothing worth sending */
function send(): boolean {
  const text = clean(input.value);
  if (!text) return true;
  const now = performance.now();
  if (now - lastSent < SEND_GAP) return false;
  lastSent = now;
  input.value = '';
  // no socket (solo file, or still reconnecting): show it locally so Enter did something
  if (!deliver(text)) showChatMessage({ name: 'You', text, self: true });
  return true;
}

addEventListener('keydown', e => {
  if (!chatOpen || e.code !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  closeChat();
}, true);

// Most browsers swallow the Escape that breaks pointer lock, so the keydown
// above never fires. Losing the lock while typing closes the box instead.
document.addEventListener('pointerlockchange', () => {
  if (chatOpen && !dragLook && document.pointerLockElement !== canvas) closeChat();
});

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
    if (send()) closeChat();
  } else if (e.code === 'Tab') {
    e.preventDefault();
  }
});
// a click while locked lands on the canvas and would steal focus from the field
input.addEventListener('blur', () => {
  if (chatOpen) setTimeout(() => { if (chatOpen) input.focus({ preventScroll: true }); }, 0);
});
box.addEventListener('mousedown', e => e.stopPropagation());
box.addEventListener('mouseup', e => e.stopPropagation());
box.addEventListener('pointerdown', e => e.stopPropagation());

function syncMenu() {
  const menu = !intro.classList.contains('hidden');
  log.classList.toggle('away', menu);
  if (menu) closeChat();
}
new MutationObserver(syncMenu).observe(intro, { attributes: true, attributeFilter: ['class'] });
syncMenu();
