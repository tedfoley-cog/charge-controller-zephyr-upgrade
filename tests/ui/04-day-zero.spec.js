// Journey 4: before the run, the console says what to do next instead of showing blanks.
import { expect, test } from '@playwright/test';
import { EMPTY, tab } from './helpers.js';

test('day zero: baseline only, every view guides to the next command', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(EMPTY);
  await expect(page.getByTestId('run-status')).toContainText('Next: Inventory');
  await expect(page.locator('.step.done')).toHaveCount(1);
  await expect(page.locator('.step.active')).toContainText('Inventory');
  await expect(page.locator('[data-kpi="Unit tests"] .value')).toHaveText('95');
  await expect(page.locator('[data-kpi="Boards on v4.3"] .value')).toHaveText('0/6');
  await expect(page.getByTestId('board-table').locator('tbody tr')).toHaveCount(6);

  for (const [name, command] of [['Inventory', 'make scan && make trial'], ['Plan', 'make plan'], ['Board', 'make plan']]) {
    await tab(page, name).click();
    await expect(page.getByTestId('empty-state')).toContainText(command);
  }
  await tab(page, 'Evidence').click();
  await expect(page.locator('[data-flash]')).toHaveCount(6);
  await expect(page.locator('[data-flash]').first()).toContainText('pending');
  await page.getByRole('button', { name: 'Sign off release' }).click();
  await expect(page.locator('.field.invalid')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('unknown route falls back to the overview and tabs work from the keyboard', async ({ page }) => {
  await page.goto(`${EMPTY}/#/nope`);
  await expect(tab(page, 'Overview')).toHaveAttribute('aria-selected', 'true');
  await tab(page, 'Overview').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(tab(page, 'Inventory')).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(tab(page, 'Overview')).toHaveAttribute('aria-selected', 'true');
});
