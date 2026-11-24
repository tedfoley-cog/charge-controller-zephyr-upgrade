import { derive } from './lib/model.js';
import { esc } from './lib/dom.js';
import overview from './views/overview.js';
import inventory from './views/inventory.js';
import plan from './views/plan.js';
import board from './views/board.js';
import evidence from './views/evidence.js';

const VIEWS = { overview, inventory, plan, board, evidence };
const view = document.getElementById('view');
const drawer = document.getElementById('drawer');
const scrim = document.getElementById('scrim');
const toast = document.getElementById('toast');
let state = null;
let model = null;
let lastFocus = null;

export function parseHash() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  return { name: VIEWS[path] ? path : 'overview', params: Object.fromEntries(new URLSearchParams(query)) };
}

export function navigate(name, params = {}, { replace = false } = {}) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null));
  const query = new URLSearchParams(clean).toString();
  const hash = `#/${name}${query ? `?${query}` : ''}`;
  if (replace) history.replaceState(null, '', hash);
  else location.hash = hash;
  if (replace) render();
}

export function openDrawer(title, bodyHtml) {
  lastFocus = document.activeElement;
  document.getElementById('drawer-title').textContent = title;
  document.getElementById('drawer-body').innerHTML = bodyHtml;
  drawer.hidden = false;
  scrim.hidden = false;
  document.getElementById('drawer-close').focus();
}

export function closeDrawer() {
  if (drawer.hidden) return;
  drawer.hidden = true;
  scrim.hidden = true;
  lastFocus?.focus?.();
}

export function notify(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { toast.hidden = true; }, 2600);
}

function renderStatus() {
  const el = document.getElementById('run-status');
  const active = model.steps.find((s) => s.state === 'active');
  const failing = model.tickets.filter((t) => t.gate === 'fail').length;
  const kind = failing ? 'fail' : model.complete ? 'pass' : 'run';
  const text = failing ? `${failing} gate${failing > 1 ? 's' : ''} failing` : model.complete ? 'Release gate passed' : `Next: ${active.title}`;
  el.innerHTML = `<span class="dot ${kind}"></span><span>${esc(text)}</span>`;
  document.getElementById('tab-count-inventory').textContent = model.findings.length || '';
  if (state.inventory) document.getElementById('route-label').textContent = `Zephyr ${state.inventory.from} → ${state.inventory.to}`;
}

function render() {
  const { name, params } = parseHash();
  for (const tab of document.querySelectorAll('.tabs [role=tab]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.view === name));
  }
  const keepFocus = document.activeElement?.id;
  const caret = document.activeElement?.selectionStart;
  view.dataset.view = name;
  VIEWS[name]({ root: view, state, model, params, navigate, openDrawer, closeDrawer, notify });
  if (keepFocus) {
    const el = document.getElementById(keepFocus);
    el?.focus();
    if (caret != null && el?.setSelectionRange) el.setSelectionRange(caret, caret);
  }
}

document.querySelector('.tabs').addEventListener('click', (event) => {
  const tab = event.target.closest('[role=tab]');
  if (tab) navigate(tab.dataset.view);
});
document.getElementById('drawer-close').addEventListener('click', closeDrawer);
scrim.addEventListener('click', closeDrawer);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDrawer(); });
drawer.addEventListener('click', (event) => {
  const link = event.target.closest('[data-nav]');
  if (!link) return;
  event.preventDefault();
  closeDrawer();
  navigate(link.dataset.nav, JSON.parse(link.dataset.params || '{}'));
});
window.addEventListener('hashchange', render);

async function boot() {
  try {
    const response = await fetch('api/state');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state = await response.json();
  } catch (error) {
    view.innerHTML = `<div class="card empty" role="alert">Could not load migration state: ${esc(error.message)}</div>`;
    return;
  }
  model = derive(state);
  renderStatus();
  render();
}

boot();
