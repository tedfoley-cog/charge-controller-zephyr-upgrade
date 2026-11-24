// Journey 1: an engineer triages what breaks on the new OS.
import { expect, test } from '@playwright/test';
import { RUN, drawer, resultCount, rows, tab } from './helpers.js';

test('overview → category drill-down → filter, search, sort → finding drawer → owning ticket', async ({ page }) => {
  await page.goto(RUN);
  await expect(page.getByTestId('run-status')).toContainText('1 gate failing');
  await expect(page.locator('[data-kpi="Findings"] .value')).toHaveText('109');
  await expect(page.locator('[data-kpi="Breaking"] .value')).toHaveText('60');

  // drill down from the chart
  await page.getByTestId('category-chart').getByRole('button', { name: 'api' }).click();
  await expect(tab(page, 'Inventory')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Category')).toHaveValue('api');
  expect(await resultCount(page)).toEqual({ shown: 13, total: 109 });

  // narrow with search: only the ISO-TP rule is left
  await page.getByLabel('Search findings').fill('isotp');
  await expect(rows(page)).toHaveCount(4);
  for (const cell of await rows(page).locator('td:nth-child(2)').allTextContents()) expect(cell).toBe('API-ISOTP-001');

  // sort by location, ascending then descending
  const location = page.getByRole('columnheader', { name: 'Location' });
  await location.getByRole('button').click();
  await expect(location).toHaveAttribute('aria-sort', 'ascending');
  const asc = await rows(page).locator('td:nth-child(4)').allTextContents();
  await location.getByRole('button').click();
  await expect(location).toHaveAttribute('aria-sort', 'descending');
  expect(await rows(page).locator('td:nth-child(4)').allTextContents()).toEqual([...asc].reverse());

  // open the finding: source context, fix and the ticket that owns it
  await rows(page).filter({ hasText: 'can.cpp:50' }).click();
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page).getByTestId('code-context').locator('.hit')).toContainText('use_ext_addr');
  await expect(drawer(page).getByTestId('finding-fix')).toContainText('ISOTP_MSG_FIXED_ADDR');
  await drawer(page).getByRole('link', { name: /FW-103/ }).click();

  // lands on the plan with the ticket drawer open
  await expect(tab(page, 'Plan')).toHaveAttribute('aria-selected', 'true');
  await expect(drawer(page).getByRole('heading', { level: 2 })).toContainText('FW-103');
  await expect(drawer(page).getByTestId('acceptance').locator('li')).toHaveCount(3);
});

test('filters live in the URL, survive reload and reset cleanly', async ({ page }) => {
  await page.goto(`${RUN}/#/inventory?severity=deprecated&ticket=numerics`);
  await expect(page.getByRole('button', { name: /^deprecated/ })).toHaveAttribute('aria-pressed', 'true');
  expect((await resultCount(page)).shown).toBe(39);
  await page.reload();
  expect((await resultCount(page)).shown).toBe(39);

  await page.getByLabel('Found by').selectOption('build');
  await expect(page.getByTestId('no-results')).toBeVisible();
  await page.getByRole('button', { name: 'Reset' }).click();
  expect(await resultCount(page)).toEqual({ shown: 109, total: 109 });
  await page.getByLabel('Found by').selectOption('build');
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).first()).toContainText('trial build');
});

test('CSV export contains exactly the filtered rows', async ({ page }) => {
  await page.goto(`${RUN}/#/inventory?category=kconfig`);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  expect(download.suggestedFilename()).toBe('deprecation-inventory.csv');
  const stream = await download.createReadStream();
  let csv = '';
  for await (const chunk of stream) csv += chunk;
  const lines = csv.trim().split('\n');
  expect(lines[0]).toBe('severity,rule,title,file,line,category,source,fix');
  expect(lines).toHaveLength(1 + 9);
  expect(lines.slice(1).every((l) => l.includes('"kconfig"'))).toBe(true);
  await expect(page.locator('#toast')).toContainText('Exported 9 findings');
});
