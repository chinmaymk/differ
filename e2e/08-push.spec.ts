import { execFileSync } from 'node:child_process';

import { expect, test } from '@playwright/test';

import { readFixturePaths } from './fixtures/paths';

// By this point (after 05's pull and 07's commit + revert) local main is
// ahead of origin by two commits that were never pushed. Verifies both the
// UI success state and, independently, that the bare origin's ref actually
// moved — not just that the button changed color.

test('push sends local commits to the remote', async ({ page }) => {
  const paths = readFixturePaths();
  const localHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: paths.fixtureDir })
    .toString()
    .trim();
  const originHeadBefore = execFileSync('git', ['rev-parse', 'main'], { cwd: paths.originDir })
    .toString()
    .trim();
  expect(originHeadBefore).not.toBe(localHead);

  await page.goto('/');
  await page.getByRole('button', { name: 'Push', exact: true }).click();
  await expect(page.getByRole('button', { name: /Pushed/ })).toBeVisible();

  const originHeadAfter = execFileSync('git', ['rev-parse', 'main'], { cwd: paths.originDir })
    .toString()
    .trim();
  expect(originHeadAfter).toBe(localHead);
});
