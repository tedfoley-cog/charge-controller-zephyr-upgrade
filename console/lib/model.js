// Pure derivations over the raw state returned by /api/state.
export const SEVERITIES = ['breaking', 'deprecated', 'advisory'];
export const COLUMNS = ['To Do', 'In Progress', 'In Review', 'Done'];
export const DEFAULT_BUDGET_PCT = 8;

export function countBy(items, key) {
  const out = {};
  for (const item of items) out[item[key]] = (out[item[key]] || 0) + 1;
  return out;
}

export function derive(state) {
  const findings = state.inventory?.findings ?? [];
  const planTickets = state.plan?.tickets ?? [];
  const ticketOf = {};
  for (const ticket of planTickets) for (const id of ticket.findings) ticketOf[id] = ticket.id;

  const tickets = planTickets.map((ticket) => {
    const jira = state.board?.tickets?.[ticket.id] ?? null;
    const evidence = state.evidence?.[ticket.id] ?? null;
    return {
      ...ticket,
      key: jira?.key ?? null,
      url: jira?.url ?? null,
      status: COLUMNS.includes(jira?.status) ? jira.status : 'To Do',
      pr: jira?.pr ?? null,
      review: jira?.review ?? null,
      session: jira?.session ?? null,
      evidence,
      gate_command: ticket.gate,
      gate: evidence?.verdict ?? 'pending',
    };
  });

  const work = tickets.filter((t) => t.id !== 'integration');
  const integration = tickets.find((t) => t.id === 'integration');
  const steps = [
    { title: 'Baseline', detail: state.baseline ? `${state.baseline.tests.total} tests, ${Object.keys(state.baseline.boards).length} boards` : 'make baseline', done: Boolean(state.baseline) },
    { title: 'Inventory', detail: state.inventory ? `${findings.length} findings` : 'make scan && make trial', done: Boolean(state.inventory) },
    { title: 'Plan', detail: state.plan ? `${tickets.length} tickets, ${state.plan.waves.length} waves` : 'make plan', done: Boolean(state.plan) },
    { title: 'Ticket board', detail: state.board?.epic?.key ?? 'Jira epic + tickets', done: Boolean(state.board?.epic?.key) },
    { title: 'Parallel PRs', detail: `${work.filter((t) => t.pr).length}/${work.length} opened`, done: work.length > 0 && work.every((t) => t.pr) },
    { title: 'Release gate', detail: integration?.gate === 'pass' ? 'all boards pass' : 'integration gate', done: integration?.gate === 'pass' },
  ];
  const active = steps.findIndex((s) => !s.done);
  steps.forEach((s, i) => { s.state = s.done ? 'done' : i === active ? 'active' : 'todo'; });

  return { findings, tickets, ticketOf, steps, complete: active === -1 };
}

// Latest known build of every baseline board: integration evidence wins,
// then the ticket that owns the board.
export function boardFootprint(state, tickets, budgetPct = DEFAULT_BUDGET_PCT) {
  const baseline = state.baseline?.boards ?? {};
  return Object.entries(baseline).map(([name, base]) => {
    const owner = tickets.find((t) => t.boards.includes(name));
    const sources = [state.evidence?.integration, owner?.evidence].filter(Boolean);
    const now = sources.map((e) => e.boards?.[name]).find((b) => b && b.status !== 'pending') ?? null;
    const growth = now?.flash ? (100 * (now.flash.used - base.flash.used)) / base.flash.used : null;
    return {
      name,
      owner: owner?.id ?? null,
      size: base.flash.size,
      base: base.flash.used,
      now: now?.flash?.used ?? null,
      status: now?.status ?? 'pending',
      growth,
      over: growth !== null && growth > budgetPct,
    };
  });
}

export function filterFindings(findings, f, ticketOf) {
  const q = (f.q || '').trim().toLowerCase();
  return findings.filter((x) =>
    (!f.severity || x.severity === f.severity)
    && (!f.category || x.category === f.category)
    && (!f.source || x.source === f.source)
    && (!f.ticket || ticketOf[x.id] === f.ticket)
    && (!q || [x.rule, x.title, x.file, x.snippet, x.category].some((v) => String(v).toLowerCase().includes(q))));
}

const RANK = { breaking: 0, deprecated: 1, advisory: 2 };
export function sortFindings(rows, key, dir) {
  const value = (x) => (key === 'severity' ? RANK[x.severity] : key === 'line' ? x.line : String(x[key] ?? '').toLowerCase());
  const sign = dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const [va, vb] = [value(a), value(b)];
    if (va < vb) return -sign;
    if (va > vb) return sign;
    return key === 'file' ? sign * (a.line - b.line) : a.file.localeCompare(b.file) || a.line - b.line;
  });
}

export function validateSignoff(form, { gatesOpen, overBudget }) {
  const errors = {};
  if (!form.approver || form.approver.trim().length < 3) errors.approver = 'Enter the approver name (3+ characters).';
  if (!/^CHG-\d{6}$/.test(form.change || '')) errors.change = 'Change record must look like CHG-004211.';
  const budget = Number(form.budget);
  if (form.budget === '' || Number.isNaN(budget) || budget < 0 || budget > 15) errors.budget = 'Budget must be between 0 and 15 %.';
  if (!form.reviewed) errors.reviewed = 'Confirm the review findings were read.';
  const blockers = [];
  if (gatesOpen.length) blockers.push(`${gatesOpen.length} gate${gatesOpen.length > 1 ? 's' : ''} not passing: ${gatesOpen.join(', ')}`);
  if (!errors.budget && overBudget.length) blockers.push(`over flash budget: ${overBudget.join(', ')}`);
  return { errors, blockers, ok: Object.keys(errors).length === 0 && blockers.length === 0 };
}
