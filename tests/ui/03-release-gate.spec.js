// Journey 3: the release owner reads the evidence and signs off, or is stopped.
import { expect, test } from '@playwright/test';
import { DONE, RUN } from './helpers.js';

const fill = async (page, { approver, change, budget, reviewed }) => {
  if (approver !== undefined) await page.getByLabel('Approver').fill(approver);
  if (change !== undefined) await page.getByLabel('Change record').fill(change);
  if (budget !== undefined) {
    await page.getByLabel('Flash growth budget (%)').fill(budget);
    await page.getByLabel('Flash growth budget (%)').blur();
  }
  if (reviewed) await page.getByLabel(/I have read the Devin Review findings/).check();
};

test('mid-run: failing gate is visible and sign-off is blocked even with a valid form', async ({ page }) => {
  await page.goto(`${RUN}/#/evidence`);
  const numerics = page.locator('[data-gate="numerics"]');
  await expect(numerics.locator('.pill')).toHaveText('fail');
  await expect(numerics.locator('.ko')).toHaveCount(1);
  await expect(numerics).toContainText('+0 test cases vs the base branch');
  await expect(page.locator('[data-gate="mppt-lowpower"]')).toContainText('Gate has not run yet');
  await expect(page.getByTestId('tests-summary')).toContainText('95 at baseline → 103 now');

  await fill(page, { approver: 'Dana Whitfield', change: 'CHG-004211', reviewed: true });
  await page.getByRole('button', { name: 'Sign off release' }).click();
  await expect(page.getByTestId('signoff-blocked')).toContainText('3 gates not passing: FW-104, FW-106, FW-107');
  await expect(page.getByTestId('signoff-done')).toHaveCount(0);
});

test('finished run: field validation, budget what-if, sign-off persists and can be revoked', async ({ page }) => {
  await page.goto(`${DONE}/#/evidence`);
  await expect(page.getByTestId('run-status')).toContainText('Release gate passed');
  await expect(page.getByTestId('gates').locator('.pill.pass')).toHaveCount(6);

  // empty submit: every field reports its own error, focus moves to the first
  await page.getByRole('button', { name: 'Sign off release' }).click();
  await expect(page.locator('.field.invalid')).toHaveCount(3);
  await expect(page.locator('[data-field="approver"] .error')).toContainText('approver name');
  await expect(page.locator('[data-field="change"] .error')).toContainText('CHG-004211');
  await expect(page.getByLabel('Approver')).toBeFocused();

  // bad formats
  await fill(page, { approver: 'Dana Whitfield', change: 'chg-12', budget: '40', reviewed: true });
  await page.getByRole('button', { name: 'Sign off release' }).click();
  await expect(page.locator('[data-field="budget"] .error')).toContainText('between 0 and 15');
  await expect(page.locator('[data-field="change"] .error')).not.toBeEmpty();
  await expect(page.locator('[data-field="approver"] .error')).toBeEmpty();

  // tighter budget: two boards go over and block the release
  await fill(page, { change: 'CHG-004211', budget: '5' });
  await expect(page.locator('[data-flash][data-over="true"]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Sign off release' }).click();
  await expect(page.getByTestId('signoff-blocked')).toContainText('over flash budget: mppt_2420_hc, mppt_2420_hpx');

  // agreed budget: sign-off goes through and survives a reload
  await fill(page, { budget: '8' });
  await expect(page.locator('[data-flash][data-over="true"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign off release' }).click();
  await expect(page.getByTestId('signoff-done')).toContainText('Signed off by Dana Whitfield under CHG-004211 with a +8% flash budget');
  await page.reload();
  await expect(page.getByTestId('signoff-done')).toBeVisible();

  await page.getByRole('button', { name: 'Revoke sign-off' }).click();
  await expect(page.getByRole('button', { name: 'Sign off release' })).toBeVisible();
  await expect(page.getByLabel('Approver')).toHaveValue('');
});
