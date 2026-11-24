import { DEFAULT_BUDGET_PCT, boardFootprint, validateSignoff } from '../lib/model.js';
import { emptyState, esc, kb, pill } from '../lib/dom.js';

const KEY = 'migration-console.signoff';
const readSignoff = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };

function gateCard(t) {
  const e = t.evidence;
  if (!e) {
    return `<div class="card" data-gate="${esc(t.id)}"><h3>${esc(t.key ?? t.id)} · ${esc(t.id)}</h3><p class="muted">Gate has not run yet.</p></div>`;
  }
  return `<div class="card" data-gate="${esc(t.id)}">
    <h3>${esc(t.key ?? t.id)} · ${esc(t.id)} ${pill(e.verdict)}</h3>
    <p class="muted" style="margin-bottom:8px">${e.tests.total} unit tests, ${e.tests.failures} failing · Zephyr ${esc(e.zephyr)}</p>
    <ul class="checks">${e.checks.map((c) => `<li><span class="${c.ok ? 'ok' : 'ko'}">${c.ok ? '✓' : '✕'}</span><span>${esc(c.name)}<small>${esc(c.detail)}</small></span></li>`).join('')}</ul>
  </div>`;
}

export default function evidence({ root, state, model, notify }) {
  if (!state.baseline) {
    root.innerHTML = emptyState('No baseline evidence yet.', 'make baseline');
    return;
  }
  const { tickets } = model;
  const saved = readSignoff();
  const draft = evidence.draft ?? { approver: '', change: '', budget: String(DEFAULT_BUDGET_PCT), reviewed: false };
  evidence.draft = draft;
  const budget = Number(draft.budget);
  const budgetValid = draft.budget !== '' && !Number.isNaN(budget) && budget >= 0 && budget <= 15;
  const footprint = boardFootprint(state, tickets, budgetValid ? budget : DEFAULT_BUDGET_PCT);
  const gatesOpen = tickets.filter((t) => t.gate !== 'pass').map((t) => t.key ?? t.id);
  const overBudget = footprint.filter((b) => b.over).map((b) => b.name);
  const base = state.baseline.tests;
  const latest = Math.max(base.total, ...tickets.map((t) => t.evidence?.tests?.total ?? 0));

  const flashRows = footprint.map((b) => {
    const pct = (v) => `${Math.min(100, (100 * v) / b.size).toFixed(2)}%`;
    const budgetAt = pct(b.base * (1 + (budgetValid ? budget : DEFAULT_BUDGET_PCT) / 100));
    const label = b.now === null ? 'pending' : `${kb(b.now)} (${b.growth >= 0 ? '+' : ''}${b.growth.toFixed(1)}%)`;
    return `<div class="flash-row" data-flash="${esc(b.name)}" data-over="${b.over}">
      <span class="mono">${esc(b.name)}</span>
      <div class="flash-track" title="baseline ${kb(b.base)} of ${kb(b.size)}">
        <div class="base" style="width:${pct(b.base)}"></div>
        <div class="now ${b.now === null ? 'pending' : b.over ? 'over' : ''}" style="width:${pct(b.now ?? b.base)}"></div>
        <div class="budget" style="left:${budgetAt}"></div>
      </div>
      <span class="${b.over ? '' : 'muted'}" style="${b.over ? 'color:var(--bad)' : ''}">${label}</span>
    </div>`;
  }).join('');

  root.innerHTML = `
    <div class="section-title"><h2>No-regression evidence</h2><span class="muted">every number below is produced by <span class="mono">make gate</span> in CI</span></div>
    <div class="grid two">
      <div class="card" data-testid="flash-chart">
        <h3>Flash per board · grey v3.2 baseline, green v4.3, amber line = budget</h3>
        ${flashRows}
        <p class="muted" data-testid="tests-summary">Unit tests: ${base.total} at baseline → ${latest} now (${latest - base.total >= 0 ? '+' : ''}${latest - base.total} regression tests added).</p>
      </div>
      <div class="card">
        <h3>Release sign-off</h3>
        ${saved ? `<div class="banner ok" data-testid="signoff-done">Signed off by <b>${esc(saved.approver)}</b> under ${esc(saved.change)} with a +${esc(saved.budget)}% flash budget.</div>
          <button class="btn" id="signoff-revoke" style="margin-top:12px">Revoke sign-off</button>` : `
        <form class="signoff" id="signoff" novalidate>
          <div class="field" data-field="approver"><label for="so-approver">Approver</label><input id="so-approver" name="approver" autocomplete="off" value="${esc(draft.approver)}" /><div class="error"></div></div>
          <div class="field" data-field="change"><label for="so-change">Change record</label><input id="so-change" name="change" placeholder="CHG-004211" autocomplete="off" value="${esc(draft.change)}" /><div class="error"></div></div>
          <div class="field" data-field="budget"><label for="so-budget">Flash growth budget (%)</label><input id="so-budget" name="budget" inputmode="decimal" value="${esc(draft.budget)}" /><div class="error"></div></div>
          <div class="field" data-field="reviewed"><label><input type="checkbox" id="so-reviewed" name="reviewed" ${draft.reviewed ? 'checked' : ''} /> I have read the Devin Review findings on every pull request</label><div class="error"></div></div>
          <div id="signoff-blockers"></div>
          <button class="btn primary" type="submit">Sign off release</button>
        </form>`}
      </div>
    </div>
    <div class="section-title"><h2>Gate results per ticket</h2><span class="muted">${tickets.length - gatesOpen.length} of ${tickets.length} passing</span></div>
    ${tickets.length ? `<div class="grid three" data-testid="gates">${tickets.map(gateCard).join('')}</div>` : emptyState('No tickets yet.', 'make plan')}`;

  root.querySelector('#signoff-revoke')?.addEventListener('click', () => {
    localStorage.removeItem(KEY);
    notify('Sign-off revoked');
    evidence({ root, state, model, notify });
  });
  const form = root.querySelector('#signoff');
  if (!form) return;
  const read = () => {
    draft.approver = form.approver.value;
    draft.change = form.change.value.trim();
    draft.budget = form.budget.value.trim();
    draft.reviewed = form.reviewed.checked;
  };
  form.budget.addEventListener('change', () => { read(); evidence({ root, state, model, notify }); });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    read();
    const result = validateSignoff(draft, { gatesOpen, overBudget });
    form.querySelectorAll('.field').forEach((field) => {
      const message = result.errors[field.dataset.field] ?? '';
      field.classList.toggle('invalid', Boolean(message));
      field.querySelector('.error').textContent = message;
    });
    form.querySelector('#signoff-blockers').innerHTML = result.blockers.length
      ? `<div class="banner bad" role="alert" data-testid="signoff-blocked">Release blocked: ${esc(result.blockers.join('; '))}.</div>` : '';
    if (!result.ok) {
      form.querySelector('.field.invalid input')?.focus();
      return;
    }
    localStorage.setItem(KEY, JSON.stringify({ approver: draft.approver.trim(), change: draft.change, budget: draft.budget }));
    evidence.draft = null;
    notify('Release signed off');
    evidence({ root, state, model, notify });
  });
}
