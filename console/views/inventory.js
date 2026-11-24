import { SEVERITIES, countBy, filterFindings, sortFindings } from '../lib/model.js';
import { emptyState, esc, pill, toCsv } from '../lib/dom.js';

const COLS = [
  ['severity', 'Severity'],
  ['rule', 'Rule'],
  ['title', 'Finding'],
  ['file', 'Location'],
  ['category', 'Category'],
  ['source', 'Found by'],
];

export function findingDetail(f, ticket) {
  const context = f.context?.length
    ? `<div class="code" data-testid="code-context">${f.context.map((c) => `<div class="${c.line === f.line ? 'hit' : ''}"><span class="ln">${c.line}</span>${esc(c.text)}</div>`).join('')}</div>`
    : `<div class="code"><div class="hit">${esc(f.snippet)}</div></div>`;
  return `
    <div>${pill(f.severity)} ${pill(f.source === 'build' ? 'trial build' : 'static rule', f.source)}</div>
    <dl class="kv">
      <dt>Rule</dt><dd class="mono">${esc(f.rule)}</dd>
      <dt>Location</dt><dd class="mono">${esc(f.file)}${f.line ? `:${f.line}` : ''}</dd>
      <dt>Changed in</dt><dd>${f.since ? `Zephyr ${esc(f.since)}` : 'reported by the v4.3 build'}${f.removed ? `, removed in ${esc(f.removed)}` : ''}</dd>
      <dt>Ticket</dt><dd>${ticket ? `<a href="#" data-nav="plan" data-params='${esc(JSON.stringify({ ticket: ticket.id }))}'>${esc(ticket.key ?? ticket.id)} · ${esc(ticket.title)}</a>` : '<span class="muted">not planned yet</span>'}</dd>
    </dl>
    <div><h4>Source</h4>${context}</div>
    <div><h4>Fix</h4><p data-testid="finding-fix">${esc(f.fix)}</p></div>
    <div><h4>Reference</h4><a href="${esc(f.ref)}" target="_blank" rel="noreferrer">${esc(f.ref)}</a></div>`;
}

export default function inventory({ root, state, model, params, navigate, openDrawer, notify }) {
  if (!state.inventory) {
    root.innerHTML = emptyState('No inventory yet. Scan the tree and run the trial build against Zephyr v4.3.', 'make scan && make trial');
    return;
  }
  const { findings, ticketOf, tickets } = model;
  const sort = params.sort || 'severity';
  const dir = params.dir || 'asc';
  const rows = sortFindings(filterFindings(findings, params, ticketOf), sort, dir);
  const set = (patch) => navigate('inventory', { ...params, ...patch }, { replace: true });
  const options = (key, selected, label) => `<option value="">${label}</option>${Object.keys(countBy(findings, key)).sort().map((v) => `<option ${v === selected ? 'selected' : ''}>${esc(v)}</option>`).join('')}`;
  const bySev = countBy(findings, 'severity');

  root.innerHTML = `
    <div class="toolbar">
      <input type="search" id="inv-search" placeholder="Search rule, file, symbol…" aria-label="Search findings" value="${esc(params.q || '')}" />
      <div class="chips" role="group" aria-label="Severity">
        ${SEVERITIES.map((s) => `<button class="chip" data-severity="${s}" aria-pressed="${params.severity === s}">${s} ${bySev[s] ?? 0}</button>`).join('')}
      </div>
      <select id="inv-category" aria-label="Category">${options('category', params.category, 'All categories')}</select>
      <select id="inv-source" aria-label="Found by">${options('source', params.source, 'Static + build')}</select>
      <select id="inv-ticket" aria-label="Ticket"><option value="">All tickets</option>${tickets.map((t) => `<option value="${esc(t.id)}" ${t.id === params.ticket ? 'selected' : ''}>${esc(t.key ?? t.id)}</option>`).join('')}</select>
      <button class="btn" id="inv-reset">Reset</button>
      <button class="btn" id="inv-export">Export CSV</button>
      <span class="result-count" data-testid="result-count">${rows.length} of ${findings.length} findings</span>
    </div>
    <div class="table-wrap">
      <table data-testid="inventory-table">
        <thead><tr>${COLS.map(([key, label]) => `<th aria-sort="${sort === key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}"><button data-sort="${key}">${label}</button></th>`).join('')}</tr></thead>
        <tbody>
          ${rows.map((f) => `<tr tabindex="0" data-id="${esc(f.id)}">
            <td>${pill(f.severity)}</td>
            <td class="mono">${esc(f.rule)}</td>
            <td>${esc(f.title)}</td>
            <td class="mono">${esc(f.file)}${f.line ? `:${f.line}` : ''}</td>
            <td>${esc(f.category)}</td>
            <td>${pill(f.source === 'build' ? 'trial build' : 'static', f.source)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${rows.length ? '' : '<div class="empty" data-testid="no-results">No findings match these filters.</div>'}
    </div>`;

  root.querySelector('#inv-search').addEventListener('input', (e) => set({ q: e.target.value }));
  root.querySelector('#inv-category').addEventListener('change', (e) => set({ category: e.target.value }));
  root.querySelector('#inv-source').addEventListener('change', (e) => set({ source: e.target.value }));
  root.querySelector('#inv-ticket').addEventListener('change', (e) => set({ ticket: e.target.value }));
  root.querySelector('#inv-reset').addEventListener('click', () => navigate('inventory', {}, { replace: true }));
  root.querySelectorAll('[data-severity]').forEach((chip) => chip.addEventListener('click', () => set({ severity: params.severity === chip.dataset.severity ? '' : chip.dataset.severity })));
  root.querySelectorAll('[data-sort]').forEach((button) => button.addEventListener('click', () => {
    const key = button.dataset.sort;
    set({ sort: key, dir: sort === key && dir === 'asc' ? 'desc' : 'asc' });
  }));
  root.querySelector('#inv-export').addEventListener('click', () => {
    const csv = toCsv(rows, ['severity', 'rule', 'title', 'file', 'line', 'category', 'source', 'fix']);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    link.download = 'deprecation-inventory.csv';
    link.click();
    notify(`Exported ${rows.length} findings`);
  });
  const open = (row) => {
    const f = findings.find((x) => x.id === row.dataset.id);
    openDrawer(f.title, findingDetail(f, tickets.find((t) => t.id === ticketOf[f.id])));
  };
  root.querySelectorAll('tbody tr').forEach((row) => {
    row.addEventListener('click', () => open(row));
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(row); });
  });
}
