import { expect, test } from '@playwright/test';

// Stages the two files left over from 06 (new-name.txt renamed, new-file.txt
// added), commits them, then reverts that commit through the History tab's
// row menu. Must run after 06.

const COMMIT_MESSAGE = 'add new file and rename old-name.txt';

test('stages remaining changes, commits, then reverts the commit', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await page.goto('/');

  // Staging round-trips through the server (stage + refresh); firing the
  // next click before one settles races the UI update, so wait for each to
  // land before moving on. new-name.txt's rename only re-pairs into a
  // single staged "Renamed" entry once BOTH halves are staged — staging
  // just the new path alone (not old-name.txt's now-missing-on-disk half)
  // would leave old-name.txt's deletion dangling, uncommitted, after commit.
  const stagedSection = page.locator('.sechead', { hasText: 'Staged Changes' });

  await page
    .locator('.row.file', { hasText: 'new-name.txt' })
    .getByRole('button', { name: 'Stage file' })
    .click();
  await expect(stagedSection.getByText('1', { exact: true })).toBeVisible();

  await page
    .locator('.row.file', { hasText: 'old-name.txt' })
    .getByRole('button', { name: 'Stage file' })
    .click();
  await expect(page.locator('.row.file', { hasText: 'old-name.txt' })).toHaveCount(0);

  await page
    .locator('.row.file', { hasText: 'new-file.txt' })
    .getByRole('button', { name: 'Stage file' })
    .click();
  // Two files staged, but the commit button also requires a non-empty
  // message (see CommitPanel's `disabled` condition) — visible, not yet
  // enabled.
  await expect(page.getByRole('button', { name: 'Commit 2 files' })).toBeVisible();

  await page.getByPlaceholder('Commit message').fill(COMMIT_MESSAGE);
  await expect(page.getByRole('button', { name: 'Commit 2 files' })).toBeEnabled();
  await page.getByRole('button', { name: 'Commit 2 files' }).click();

  // Nothing staged left, and the working tree is clean (the two staged
  // changes were the only uncommitted state remaining after 06).
  await expect(page.getByRole('button', { name: /^Commit \d+ files?$/ })).toBeDisabled();
  await expect(page.getByText('No changes in this comparison')).toBeVisible();

  await page.getByTitle("Change what you're comparing").click();
  await page.getByRole('button', { name: /^History/ }).click();
  await expect(page.getByText(COMMIT_MESSAGE)).toBeVisible();

  const row = page.locator('.list .row', { hasText: COMMIT_MESSAGE });
  // "More actions" is only a `title`, not an aria-label — the button's
  // accessible name is its icon glyph text content instead.
  await row.getByTitle('More actions').click();
  await row.getByRole('button', { name: 'Revert commit' }).click();

  // The revert commit fully undoes the previous one and applies cleanly —
  // working tree is clean again, and a new "Revert ..." commit exists.
  await expect(page.getByText('No changes in this comparison')).toBeVisible();
  await page.getByTitle("Change what you're comparing").click();
  await page.getByRole('button', { name: /^History/ }).click();
  await expect(page.getByText(`Revert "${COMMIT_MESSAGE}"`)).toBeVisible();
});
