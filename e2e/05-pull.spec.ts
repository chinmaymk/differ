import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { readFixturePaths } from './fixtures/paths';

// Simulates a teammate pushing a commit to the remote, then pulls it in
// through the UI. Runs before any local-only commits exist (see
// build-fixture.mjs) so this is a clean fast-forward, not a merge.

test('pull fetches a new commit pushed to the remote', async ({ page }) => {
  const paths = readFixturePaths();

  writeFileSync(join(paths.upstreamCloneDir, 'upstream-file.txt'), 'from upstream\n');
  execFileSync('git', ['add', '-A'], { cwd: paths.upstreamCloneDir });
  execFileSync('git', ['commit', '-q', '-m', 'upstream update'], { cwd: paths.upstreamCloneDir });
  execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: paths.upstreamCloneDir });

  await page.goto('/');
  await page.getByRole('button', { name: 'Pull' }).click();
  await expect(page.getByRole('button', { name: /Pulled/ })).toBeVisible();

  await page.getByTitle("Change what you're comparing").click();
  await page.getByRole('button', { name: /^History/ }).click();
  await expect(page.getByText('upstream update')).toBeVisible();
});
