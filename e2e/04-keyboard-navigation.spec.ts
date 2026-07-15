import { expect, test } from '@playwright/test';

// j/k selection + v (viewed) — read-only, no repo mutation.

test('j/k move the selection between files, v marks the current one viewed', async ({ page }) => {
  await page.goto('/');
  // The viewed count is a `title` tooltip on an otherwise-empty progress
  // bar div, not rendered text content — getByText would never match it.
  await expect(page.getByTitle('0 of 4 viewed')).toBeVisible();

  const rows = page.locator('.row.file');
  await expect(rows).toHaveCount(4);

  // `selected` is a class on the row itself (`.row.file.selected`), not a
  // separate wrapper — `.selected .name` (descendant combinator) never
  // matches anything.
  const selectedName = async () => page.locator('.row.file.selected .name').first().textContent();
  const initial = await selectedName();

  await page.keyboard.press('j');
  const afterJ = await selectedName();
  expect(afterJ).not.toBeNull();
  expect(afterJ).not.toBe(initial);

  await page.keyboard.press('k');
  const afterK = await selectedName();
  expect(afterK).toBe(initial);

  await page.keyboard.press('v');
  await expect(page.getByTitle('1 of 4 viewed')).toBeVisible();
});
