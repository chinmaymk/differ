import { expect, test, type Page } from '@playwright/test';

// Mutates the working tree — must run after 01/02/03/04 (which assume the
// fixture's pristine initial changes) and after 05-pull (still just those
// same four files at this point; pull only adds a new, unrelated commit).

function sectionByHeader(page: Page, headerText: string) {
  return page
    .getByText(headerText, { exact: true })
    .locator(
      'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " section ")][1]',
    );
}

test('stage, unstage, then discard a hunk', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await page.goto('/');

  await page.locator('.row.file', { hasText: 'keep.txt' }).getByRole('button').first().click();
  await page.getByRole('button', { name: 'Stage hunk' }).click();

  const staged = sectionByHeader(page, 'Staged Changes');
  const unstaged = sectionByHeader(page, 'Changes');
  await expect(staged.locator('.row.file', { hasText: 'keep.txt' })).toBeVisible();
  await expect(unstaged.locator('.row.file', { hasText: 'keep.txt' })).toHaveCount(0);

  await staged.locator('.row.file', { hasText: 'keep.txt' }).getByRole('button').first().click();
  await page.getByRole('button', { name: 'Unstage hunk' }).click();
  await expect(unstaged.locator('.row.file', { hasText: 'keep.txt' })).toBeVisible();

  await unstaged.locator('.row.file', { hasText: 'keep.txt' }).getByRole('button').first().click();
  await page.getByRole('button', { name: 'Discard hunk' }).click();

  // keep.txt now matches HEAD again — gone from the file list entirely.
  await expect(page.locator('.row.file', { hasText: 'keep.txt' })).toHaveCount(0);
  await expect(page.getByText('3 files')).toBeVisible();
});

test('stage and unstage a whole (renamed) file', async ({ page }) => {
  await page.goto('/');

  await page
    .locator('.row.file', { hasText: 'new-name.txt' })
    .getByRole('button', { name: 'Stage file' })
    .click();

  const staged = sectionByHeader(page, 'Staged Changes');
  const unstaged = sectionByHeader(page, 'Changes');
  await expect(staged.locator('.row.file', { hasText: 'new-name.txt' })).toBeVisible();

  await staged
    .locator('.row.file', { hasText: 'new-name.txt' })
    .getByRole('button', { name: 'Unstage file' })
    .click();
  await expect(unstaged.locator('.row.file', { hasText: 'new-name.txt' })).toBeVisible();
});

test('discarding a removed file restores it', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await page.goto('/');

  await page
    .locator('.row.file', { hasText: 'remove-me.txt' })
    .getByRole('button', { name: 'Discard file changes' })
    .click();

  await expect(page.locator('.row.file', { hasText: 'remove-me.txt' })).toHaveCount(0);
  await expect(page.getByText('2 files')).toBeVisible();
});
