export const RUN = 'http://localhost:4173';
export const DONE = 'http://localhost:4174';
export const EMPTY = 'http://localhost:4175';

export const tab = (page, name) => page.getByRole('tab', { name });
export const drawer = (page) => page.getByRole('dialog');
export const rows = (page) => page.getByTestId('inventory-table').locator('tbody tr');
export async function resultCount(page) {
  const text = await page.getByTestId('result-count').textContent();
  const [shown, total] = text.match(/\d+/g).map(Number);
  return { shown, total };
}
