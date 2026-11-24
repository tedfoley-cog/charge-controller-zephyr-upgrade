import { SEVERITIES, boardFootprint, countBy } from '../lib/model.js';
import { emptyState, esc, kb } from '../lib/dom.js';

export default function overview({ root, state, model, navigate }) {
  const { findings, tickets, steps } = model;
  const sev = countBy(findings, 'severity');
  const baseline = state.baseline;
  const footprint = boardFootprint(state, tickets);
  const migrated = footprint.filter((b) => b.status === 'built').length;
  const prs = tickets.filter((t) => t.pr).length;
  const latestTests = Math.max(0, ...Object.values(state.evidence).map((e) => e?.tests?.total ?? 0));

  const kpis = [
    { label: 'Findings', value: state.inventory ? findings.length : '—', hint: state.inventory ? `${state.inventory.summary.files} files, ${state.inventory.rules} rules + trial build` : 'not scanned yet', cls: '' },
    { label: 'Breaking', value: state.inventory ? sev.breaking ?? 0 : '—', hint: 'will not build on v4.3', cls: sev.breaking ? 'bad' : '' },
    { label: 'Unit tests', value: latestTests || baseline?.tests.total || '—', hint: baseline ? `baseline ${baseline.tests.total}, ${baseline.tests.failures} failing` : 'no baseline', cls: latestTests > (baseline?.tests.total ?? 0) ? 'ok' : '' },
    { label: 'Boards on v4.3', value: `${migrated}/${footprint.length}`, hint: 'built inside flash budget', cls: migrated === footprint.length && footprint.length ? 'ok' : 'warn' },
    { label: 'Pull requests', value: `${prs}/${tickets.length || '—'}`, hint: state.plan ? `~${state.plan.manual_estimate_hours} h manual estimate` : 'no plan yet', cls: '' },
  ];

  const categories = Object.entries(countBy(findings, 'category')).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...categories.map(([, n]) => n));
  const catRows = categories.map(([category, total]) => {
    const parts = SEVERITIES.map((s) => {
      const n = findings.filter((f) => f.category === category && f.severity === s).length;
      return n ? `<i class="sev-${s}" style="width:${(100 * n) / max}%" title="${n} ${s}"></i>` : '';
    }).join('');
    return `<div class="bar-row"><button data-category="${esc(category)}">${esc(category)}</button><div class="bar">${parts}</div><span class="muted">${total}</span></div>`;
  }).join('');

  const boards = footprint.map((b) => `
    <tr data-board="${esc(b.name)}">
      <td class="mono">${esc(b.name)}</td>
      <td>${kb(b.base)}</td>
      <td>${b.now ? kb(b.now) : '<span class="muted">—</span>'}</td>
      <td>${b.growth === null ? '<span class="muted">pending</span>' : `<span style="color:${b.over ? 'var(--bad)' : 'var(--ok)'}">${b.growth >= 0 ? '+' : ''}${b.growth.toFixed(1)}%</span>`}</td>
    </tr>`).join('');

  root.innerHTML = `
    <div class="stepper" data-testid="stepper">
      ${steps.map((s, i) => `<div class="step ${s.state}" data-step="${esc(s.title)}"><div class="n">${s.state === 'done' ? '✓ ' : ''}STEP ${i + 1}</div><div class="t">${esc(s.title)}</div><div class="d">${esc(s.detail)}</div></div>`).join('')}
    </div>
    <div class="section-title"><h2>Where the upgrade stands</h2></div>
    <div class="grid kpis">
      ${kpis.map((k) => `<div class="card kpi ${k.cls}" data-kpi="${esc(k.label)}"><h3>${esc(k.label)}</h3><div class="value">${esc(k.value)}</div><div class="hint">${esc(k.hint)}</div></div>`).join('')}
    </div>
    <div class="section-title"><h2>What breaks, by area</h2><span class="muted">click an area to open it in the inventory</span></div>
    <div class="grid two">
      <div class="card" data-testid="category-chart">
        <h3>Findings by category</h3>
        ${state.inventory ? `<div class="bars">${catRows}</div>
        <div class="legend">${SEVERITIES.map((s) => `<span><i class="sev-${s}"></i>${s} ${sev[s] ?? 0}</span>`).join('')}</div>` : emptyState('No inventory yet.', 'make scan && make trial')}
      </div>
      <div class="card">
        <h3>Firmware flash per board</h3>
        ${baseline ? `<table data-testid="board-table"><thead><tr><th>Board</th><th>v3.2 baseline</th><th>v4.3</th><th>Change</th></tr></thead><tbody>${boards}</tbody></table>` : emptyState('No baseline evidence yet.', 'make baseline')}
      </div>
    </div>`;

  root.querySelectorAll('[data-category]').forEach((button) => {
    button.addEventListener('click', () => navigate('inventory', { category: button.dataset.category }));
  });
  root.querySelectorAll('[data-board]').forEach((row) => {
    row.addEventListener('click', () => navigate('evidence'));
  });
}
