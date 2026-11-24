// Journey 2: a lead checks the plan and follows tickets across the board.
import { expect, test } from '@playwright/test';
import { RUN, drawer, resultCount, tab } from './helpers.js';

test('plan waves: four parallel tickets with disjoint ownership, ticket drawer links to its findings', async ({ page }) => {
  await page.goto(`${RUN}/#/plan`);
  await expect(page.getByTestId('conflict-banner')).toContainText('cannot conflict');
  await expect(page.locator('[data-wave="0"] .ticket')).toHaveCount(1);
  await expect(page.locator('[data-wave="1"] .ticket')).toHaveCount(4);
  await expect(page.locator('[data-wave="2"] .ticket')).toHaveCount(1);
  await expect(page.locator('[data-wave="1"] h3')).toContainText('4 in parallel');

  await page.locator('[data-ticket="numerics"]').click();
  await expect(drawer(page)).toContainText('gate fail');
  await expect(drawer(page).getByTestId('ticket-review')).toContainText('4 findings, 1 resolved');
  await expect(drawer(page).getByRole('link', { name: '#15 (open)' })).toHaveAttribute('href', /pull\/15$/);
  await expect(drawer(page).locator('.code').first()).toContainText('app/src/*.cpp');

  await drawer(page).getByRole('link', { name: /Show the 39 findings/ }).click();
  await expect(tab(page, 'Inventory')).toHaveAttribute('aria-selected', 'true');
  expect((await resultCount(page)).shown).toBe(39);
  await expect(page.getByLabel('Ticket')).toHaveValue('numerics');
});

test('board: columns mirror Jira status, wave filter, drawer closes with Escape and restores focus', async ({ page }) => {
  await page.goto(`${RUN}/#/board`);
  await expect(page.getByTestId('epic').getByRole('link', { name: 'FW-101' })).toHaveAttribute('href', /browse\/FW-101$/);
  const column = (name) => page.locator(`[data-column="${name}"] .ticket`);
  await expect(column('To Do')).toHaveCount(1);
  await expect(column('In Progress')).toHaveCount(2);
  await expect(column('In Review')).toHaveCount(2);
  await expect(column('Done')).toHaveCount(1);

  await page.getByLabel('Wave').selectOption('1');
  await expect(page.locator('.kanban .ticket')).toHaveCount(4);
  await expect(column('Done')).toHaveCount(0);
  await expect(page).toHaveURL(/wave=1/);

  const card = page.locator('[data-ticket="can"]');
  await card.click();
  await expect(drawer(page)).toContainText('mppt_2420_hc and mppt_2420_rc build under hardware model v2');
  await page.keyboard.press('Escape');
  await expect(drawer(page)).toBeHidden();
  await expect(card).toBeFocused();

  await card.click();
  await page.locator('#scrim').click({ position: { x: 20, y: 300 } });
  await expect(drawer(page)).toBeHidden();
});
