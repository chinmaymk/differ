import { expect, test } from '@playwright/test';

// Exercises the headless path end to end: a real browser, talking to the
// axum server (crates/server) over HTTP via HttpGitSource, against a fixture
// repo built fresh per run (see e2e/scripts/start-headless-server.mjs). No
// Tauri desktop shell involved — this is the fast/robust E2E path discussed
// alongside adding the headless server; native-shell E2E stays out of scope.

test('connects to the headless server and lists the fixture repo\'s changes', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'http://localhost:4899' })).toBeVisible();
  await expect(page.getByText('hello.txt')).toBeVisible();
  await expect(page.getByText('new-file.txt')).toBeVisible();
});

test('opens a diff and stages a hunk', async ({ page }) => {
  await page.goto('/');

  // hello.txt is auto-selected (first unstaged file) on load.
  await expect(page.getByText('WORLD', { exact: true })).toBeVisible();
  await expect(page.getByText('world', { exact: true })).toBeVisible();

  await expect(page.getByRole('button', { name: /^Commit \d+ files?$/ })).toBeDisabled();

  await page.getByRole('button', { name: 'Stage hunk' }).click();

  await expect(page.getByRole('button', { name: /^Commit 1 files?$/ })).toBeEnabled();
});
