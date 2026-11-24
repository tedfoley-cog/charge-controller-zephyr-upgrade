import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { boardFootprint, derive, filterFindings, sortFindings, validateSignoff } from '../lib/model.js';
import { loadState } from '../server.mjs';

const state = async (name) => loadState(new URL(`../../tests/ui/fixtures/${name}`, import.meta.url).pathname);

test('day zero: only the baseline step is done', async () => {
  const model = derive(await state('empty'));
  assert.deepEqual(model.steps.map((s) => s.state), ['done', 'active', 'todo', 'todo', 'todo', 'todo']);
  assert.equal(model.tickets.length, 0);
});

test('mid-run: tickets merge plan, Jira board and gate evidence', async () => {
  const model = derive(await state('run'));
  const byId = Object.fromEntries(model.tickets.map((t) => [t.id, t]));
  assert.equal(byId.foundation.status, 'Done');
  assert.equal(byId.numerics.gate, 'fail');
  assert.equal(byId['mppt-lowpower'].gate, 'pending');
  assert.equal(model.steps.find((s) => s.state === 'active').title, 'Parallel PRs');
  assert.equal(model.complete, false);
});

test('finished run completes every step', async () => {
  const model = derive(await state('done'));
  assert.equal(model.complete, true);
});

test('every finding belongs to one ticket and filters compose', async () => {
  const s = await state('run');
  const { findings, ticketOf } = derive(s);
  assert.ok(findings.every((f) => ticketOf[f.id]));
  const can = filterFindings(findings, { ticket: 'can', severity: 'breaking', q: 'isotp' }, ticketOf);
  assert.ok(can.length > 0 && can.every((f) => f.rule === 'API-ISOTP-001'));
  const sorted = sortFindings(findings, 'file', 'desc');
  assert.ok(sorted[0].file >= sorted.at(-1).file);
});

test('flash budget marks boards over the limit', async () => {
  const s = await state('done');
  const { tickets } = derive(s);
  assert.deepEqual(boardFootprint(s, tickets, 8).filter((b) => b.over), []);
  assert.deepEqual(boardFootprint(s, tickets, 5).filter((b) => b.over).map((b) => b.name).sort(), ['mppt_2420_hc', 'mppt_2420_hpx']);
});

test('sign-off validation', () => {
  const ok = { approver: 'Dana Whitfield', change: 'CHG-004211', budget: '8', reviewed: true };
  assert.equal(validateSignoff(ok, { gatesOpen: [], overBudget: [] }).ok, true);
  assert.deepEqual(Object.keys(validateSignoff({ approver: 'x', change: 'CHG-1', budget: '40', reviewed: false }, { gatesOpen: [], overBudget: [] }).errors).sort(), ['approver', 'budget', 'change', 'reviewed']);
  const blocked = validateSignoff(ok, { gatesOpen: ['FW-106'], overBudget: ['mppt_2420_hc'] });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.blockers.length, 2);
});

test('fixtures contain no absolute paths', async () => {
  const text = await readFile(new URL('../../tests/ui/fixtures/run/inventory.json', import.meta.url), 'utf8');
  assert.ok(!text.includes('/home/'));
});
