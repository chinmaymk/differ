#!/usr/bin/env node
// Playwright `webServer` entry point: builds a fresh fixture repo with known
// history/worktree edits, then execs the headless axum server against it.
// One process (this script -> the server binary) so Playwright's teardown
// (SIGTERM to this script) cleanly stops the whole thing via the handlers
// below.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const port = process.env.E2E_SERVER_PORT ?? '4899';

const fixtureDir = mkdtempSync(join(tmpdir(), 'diff-viewer-e2e-'));

function git(args) {
  execFileSync('git', args, { cwd: fixtureDir, stdio: 'inherit' });
}

git(['init', '-q', '-b', 'main']);
git(['config', 'user.email', 'e2e@example.com']);
git(['config', 'user.name', 'E2E Fixture']);
writeFileSync(join(fixtureDir, 'hello.txt'), 'hello\nworld\n');
git(['add', '-A']);
git(['commit', '-q', '-m', 'initial commit']);
// An unstaged edit plus a brand-new untracked file, so the app has both a
// "modified" and an "added" entry to render on load.
writeFileSync(join(fixtureDir, 'hello.txt'), 'hello\nWORLD\n');
writeFileSync(join(fixtureDir, 'new-file.txt'), 'brand new\n');

process.stderr.write(`[e2e] fixture repo at ${fixtureDir}\n`);
execFileSync('cargo', ['build', '-p', 'server'], { cwd: repoRoot, stdio: 'inherit' });

const binary = join(repoRoot, 'target', 'debug', 'diff-viewer-server');
const child = spawn(binary, ['--repo', fixtureDir, '--port', port], { stdio: 'inherit' });

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  child.kill('SIGTERM');
  rmSync(fixtureDir, { recursive: true, force: true });
}
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});
process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});
child.on('exit', (code) => {
  cleanup();
  process.exit(code ?? 0);
});
