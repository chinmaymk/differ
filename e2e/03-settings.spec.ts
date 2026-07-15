import { expect, test } from '@playwright/test';

// UI-only preferences (theme/view mode/font size) — no repo interaction, so
// these can run in any order relative to the git-mutating specs. Each test
// gets a fresh browser context (and therefore fresh localStorage) by default.

test('theme toggle sets/clears the document theme override', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.getByRole('button', { name: 'System', exact: true }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
});

test('view mode toggle switches between Unified and Split', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();

  // Word-boundary regex: Svelte's per-component CSS scope-id class (e.g.
  // "s-Twm6pjhj-ond") can coincidentally contain "on" as a substring, so a
  // bare /on/ regex would false-positive regardless of the real "on" class.
  const onClass = /(^|\s)on(\s|$)/;
  const split = page.getByRole('button', { name: 'Split', exact: true });
  const unified = page.getByRole('button', { name: 'Unified', exact: true });
  await expect(unified).toHaveClass(onClass);

  await split.click();
  await expect(split).toHaveClass(onClass);
  await expect(unified).not.toHaveClass(onClass);
});

test('font size controls adjust the code font size', async ({ page }) => {
  await page.goto('/');
  const app = page.locator('.app');
  await expect(app).toHaveAttribute('style', /--code-font-size: 14px/);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Larger font' }).click();
  await page.getByRole('button', { name: 'Larger font' }).click();
  await expect(app).toHaveAttribute('style', /--code-font-size: 16px/);

  await page.getByRole('button', { name: 'Smaller font' }).click();
  await expect(app).toHaveAttribute('style', /--code-font-size: 15px/);
});

test('settings dialog closes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
});
