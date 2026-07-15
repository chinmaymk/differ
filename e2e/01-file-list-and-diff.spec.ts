import { expect, test } from '@playwright/test';

// Read-only: the fixture's initial uncommitted changes (see
// e2e/fixtures/build-fixture.mjs) are asserted as-is here, before any other
// spec file mutates the repo — must run first (numeric prefix order).

function fileRow(page: import('@playwright/test').Page, name: string) {
  return page.locator('.row.file', { hasText: name });
}

test('connects to the headless server and lists all four uncommitted changes', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'http://localhost:4899' })).toBeVisible();
  await expect(page.getByText('4 files')).toBeVisible();

  await expect(fileRow(page, 'keep.txt').getByText('M', { exact: true })).toBeVisible();
  await expect(fileRow(page, 'new-name.txt').getByText('R', { exact: true })).toBeVisible();
  await expect(fileRow(page, 'remove-me.txt').getByText('D', { exact: true })).toBeVisible();
  await expect(fileRow(page, 'new-file.txt').getByText('A', { exact: true })).toBeVisible();
});

test('opens a modified file and shows its added line as text diff', async ({ page }) => {
  await page.goto('/');
  await fileRow(page, 'keep.txt').getByRole('button').first().click();

  await expect(page.getByText('Modified', { exact: true })).toBeVisible();
  await expect(page.getByText('Text diff (no semantic parser for this file)')).toBeVisible();
  await expect(page.getByText('four', { exact: true })).toBeVisible();
});

test('opens a renamed file and shows its origin path', async ({ page }) => {
  await page.goto('/');
  await fileRow(page, 'new-name.txt').getByRole('button').first().click();

  await expect(page.getByText('Renamed', { exact: true })).toBeVisible();
  await expect(page.getByText('from old-name.txt')).toBeVisible();
});

test('opens a removed file and shows "Deleted"', async ({ page }) => {
  await page.goto('/');
  await fileRow(page, 'remove-me.txt').getByRole('button').first().click();

  await expect(page.getByText('Deleted', { exact: true })).toBeVisible();
});

test('opens an added untracked file and shows "New file"', async ({ page }) => {
  await page.goto('/');
  await fileRow(page, 'new-file.txt').getByRole('button').first().click();

  await expect(page.getByText('New file', { exact: true })).toBeVisible();
  await expect(page.getByText('brand new content', { exact: true })).toBeVisible();
});
