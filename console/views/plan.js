import { emptyState, esc, pill } from '../lib/dom.js';

export function ticketCard(t) {
  return `<button class="ticket" data-ticket="${esc(t.id)}">
    <div class="key">${esc(t.key ?? t.id)}</div>
    <div class="title">${esc(t.title)}</div>
    <div class="meta">
      ${pill(t.status)}
      <span>${t.finding_count} findings</span>
      ${t.boards.length ? `<span>${t.boards.length} board${t.boards.length > 1 ? 's' : ''}</span>` : ''}
      ${t.pr ? `<span>PR #${esc(t.pr.number)}</span>` : ''}
      ${t.gate !== 'pending' ? pill(`gate ${t.gate}`, t.gate) : ''}
    </div>
  </button>`;
}

export function ticketDetail(t) {
  const link = (url, label) => (url ? `<a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(label)}</a>` : '<span class="muted">—</span>');
  const review = t.review ? `${pill(t.review.status)} ${t.review.findings ?? 0} findings, ${t.review.resolved ?? 0} resolved` : '<span class="muted">not reviewed yet</span>';
  return `
    <div>${pill(t.status)} ${pill(`gate ${t.gate}`, t.gate)} <span class="muted">wave ${t.wave}</span></div>
    <dl class="kv">
      <dt>Jira</dt><dd>${link(t.url, t.key)}</dd>
      <dt>Pull request</dt><dd>${t.pr ? link(t.pr.url, `#${t.pr.number} (${t.pr.state})`) : '<span class="muted">—</span>'}</dd>
      <dt>Devin session</dt><dd>${link(t.session, 'open session')}</dd>
      <dt>Devin Review</dt><dd data-testid="ticket-review">${review}</dd>
      <dt>Depends on</dt><dd>${t.depends_on.length ? esc(t.depends_on.join(', ')) : 'nothing'}</dd>
      <dt>Manual estimate</dt><dd>~${t.manual_estimate_hours} h</dd>
    </dl>
    <div><h4>Acceptance criteria</h4><ul class="plain" data-testid="acceptance">${t.acceptance.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>
    <div><h4>Owned paths</h4>${t.owns.length ? `<div class="code">${t.owns.map((o) => `<div>${esc(o)}</div>`).join('')}</div>` : '<span class="muted">merge of the wave branches</span>'}</div>
    <div><h4>Gate</h4><div class="code"><div>${esc(t.gate_command)}</div></div></div>
    <div><a href="#" data-nav="inventory" data-params='${esc(JSON.stringify({ ticket: t.id }))}'>Show the ${t.finding_count} findings of this ticket →</a></div>`;
}

export default function plan({ root, state, model, params, openDrawer }) {
  if (!state.plan) {
    root.innerHTML = emptyState('No plan yet. The plan groups findings into tickets with disjoint file ownership.', 'make plan');
    return;
  }
  const { tickets } = model;
  const conflicts = state.plan.conflicts;
  const waveNames = { 0: 'Wave 0 · foundation', 1: 'Wave 1 · parallel sessions', 2: 'Wave 2 · integration' };
  root.innerHTML = `
    <div class="section-title"><h2>Migration plan</h2><span class="muted">branch <span class="mono">${esc(state.plan.integration_branch)}</span> · ~${state.plan.manual_estimate_hours} h manual estimate</span></div>
    <div class="banner ${conflicts.length ? 'bad' : 'ok'}" data-testid="conflict-banner" style="margin-bottom:16px">
      ${conflicts.length ? `${conflicts.length} file-ownership conflict(s) between parallel tickets: ${esc(conflicts.map((c) => `${c.a} ↔ ${c.b}`).join(', '))}` : 'Parallel tickets own disjoint files: their pull requests cannot conflict.'}
    </div>
    <div class="waves">
      ${state.plan.waves.map((w) => `<section class="wave ${w.parallel > 1 ? 'parallel' : ''}" data-wave="${w.wave}">
        <h3>${esc(waveNames[w.wave] ?? `Wave ${w.wave}`)}${w.parallel > 1 ? ` · ${w.parallel} in parallel` : ''}</h3>
        <div class="cards">${tickets.filter((t) => t.wave === w.wave).map(ticketCard).join('')}</div>
      </section>`).join('')}
    </div>`;
  const open = (id) => {
    const t = tickets.find((x) => x.id === id);
    if (t) openDrawer(`${t.key ?? t.id} · ${t.title}`, ticketDetail(t));
  };
  root.querySelectorAll('[data-ticket]').forEach((card) => card.addEventListener('click', () => open(card.dataset.ticket)));
  if (params.ticket) open(params.ticket);
}
