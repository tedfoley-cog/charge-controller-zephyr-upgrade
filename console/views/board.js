import { COLUMNS } from '../lib/model.js';
import { emptyState, esc } from '../lib/dom.js';
import { ticketCard, ticketDetail } from './plan.js';

export default function board({ root, state, model, params, navigate, openDrawer }) {
  if (!state.plan) {
    root.innerHTML = emptyState('No tickets yet. Build the plan, then the orchestrator creates the Jira epic and tickets.', 'make plan');
    return;
  }
  const epic = state.board?.epic;
  const wave = params.wave ?? '';
  const tickets = model.tickets.filter((t) => wave === '' || String(t.wave) === wave);
  root.innerHTML = `
    <div class="toolbar">
      <div>
        <h2 style="font-size:16px">Ticket board</h2>
        <span class="muted" data-testid="epic">${epic?.key ? `Epic <a href="${esc(epic.url)}" target="_blank" rel="noreferrer">${esc(epic.key)}</a> in Jira project ${esc(state.board.project)}` : 'Jira epic not created yet: tickets show their plan ids.'}</span>
      </div>
      <span style="flex:1"></span>
      <label class="muted" for="board-wave">Wave</label>
      <select id="board-wave">
        <option value="">All waves</option>
        ${state.plan.waves.map((w) => `<option value="${w.wave}" ${String(w.wave) === wave ? 'selected' : ''}>Wave ${w.wave}</option>`).join('')}
      </select>
    </div>
    <div class="kanban">
      ${COLUMNS.map((column) => {
        const cards = tickets.filter((t) => t.status === column);
        return `<section class="col" data-column="${esc(column)}"><h3><span>${esc(column)}</span><span>${cards.length}</span></h3>${cards.map(ticketCard).join('')}</section>`;
      }).join('')}
    </div>`;
  root.querySelector('#board-wave').addEventListener('change', (e) => navigate('board', { wave: e.target.value }, { replace: true }));
  root.querySelectorAll('[data-ticket]').forEach((card) => card.addEventListener('click', () => {
    const t = model.tickets.find((x) => x.id === card.dataset.ticket);
    openDrawer(`${t.key ?? t.id} · ${t.title}`, ticketDetail(t));
  }));
}
