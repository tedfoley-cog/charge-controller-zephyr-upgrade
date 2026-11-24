// Journey 5: visual regression of the views a release review looks at.
import { expect, test } from '@playwright/test';
import { DONE, RUN, drawer } from './helpers.js';

test.describe('visual', () => {
  test('overview mid-run', async ({ page }) => {
    await page.goto(RUN);
    await expect(page.getByTestId('stepper')).toBeVisible();
    await expect(page).toHaveScreenshot('overview-run.png', { fullPage: true });
  });

  test('plan with ticket drawer', async ({ page }) => {
    await page.goto(`${RUN}/#/plan?ticket=foundation`);
    await expect(drawer(page)).toBeVisible();
    await expect(page).toHaveScreenshot('plan-drawer.png');
  });

  test('evidence when the release gate passes', async ({ page }) => {
    await page.goto(`${DONE}/#/evidence`);
    await expect(page.getByTestId('flash-chart')).toHaveScreenshot('flash-chart-done.png');
  });

  test('narrow viewport keeps the board usable', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1000 });
    await page.goto(`${RUN}/#/board`);
    await expect(page.locator('.kanban .ticket')).toHaveCount(6);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page).toHaveScreenshot('board-narrow.png', { fullPage: true });
  });
});
