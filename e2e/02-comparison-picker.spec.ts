import { expect, test, type Page } from '@playwright/test';

// Read-only navigation through the comparison picker (History/Branches/Tags)
// — no repo mutation, safe to run early alongside 01.

async function openPicker(page: Page) {
  await page.getByTitle("Change what you're comparing").click();
}

test('History tab: selecting a commit shows that commit\'s own changes', async ({ page }) => {
  await page.goto('/');
  await openPicker(page);
  await page.getByRole('button', { name: /^History/ }).click();
  await page.getByText('second commit').click();

  await expect(page.locator('.row.file', { hasText: 'keep.txt' })).toBeVisible();
  await expect(page.locator('.row.file', { hasText: 'logo.png' })).toBeVisible();

  await page.locator('.row.file', { hasText: 'logo.png' }).getByRole('button').first().click();
  await expect(page.getByText('New file', { exact: true })).toBeVisible();
  await expect(page.getByText('Image', { exact: true })).toBeVisible();
  await expect(page.getByText('Added', { exact: true })).toBeVisible();
});

test('Branches tab: comparing against feature shows its extra commit', async ({ page }) => {
  await page.goto('/');
  await openPicker(page);
  await page.getByRole('button', { name: /^Branches/ }).click();
  await page.getByText('feature', { exact: true }).click();

  await page.locator('.row.file', { hasText: 'readme.txt' }).getByRole('button').first().click();
  await expect(page.getByText('Feature note', { exact: true })).toBeVisible();
});

test('Tags tab: comparing against v1.0 shows HEAD\'s changes reversed', async ({ page }) => {
  await page.goto('/');
  await openPicker(page);
  await page.getByRole('button', { name: /^Tags/ }).click();
  await page.getByText('v1.0', { exact: true }).click();

  // v1.0 predates logo.png's addition in the second commit, so comparing
  // HEAD -> v1.0 shows it disappearing.
  await expect(page.locator('.row.file', { hasText: 'logo.png' })).toBeVisible();
  await page.locator('.row.file', { hasText: 'logo.png' }).getByRole('button').first().click();
  await expect(page.getByText('Deleted', { exact: true })).toBeVisible();
});

test('returns to Uncommitted changes and shows the original four changes', async ({ page }) => {
  await page.goto('/');
  await openPicker(page);
  await page.getByRole('button', { name: /^Tags/ }).click();
  await page.getByText('v1.0', { exact: true }).click();
  await expect(page.getByText('1 files').or(page.getByText(/\d+ files/))).toBeVisible();

  await openPicker(page);
  await page.getByRole('button', { name: 'Uncommitted changes' }).click();
  await expect(page.getByText('4 files')).toBeVisible();
});
