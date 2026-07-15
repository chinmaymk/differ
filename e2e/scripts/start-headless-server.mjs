#!/usr/bin/env node
// Playwright `webServer` entry point: builds the fixture (see
// e2e/fixtures/build-fixture.mjs), execs the headless axum server against
// it, and writes the fixture's paths to a well-known JSON file so spec
// files (also plain Node) can drive/verify things outside the UI — e.g. the
// pull test pushes a new commit to the "upstream clone" before clicking
// Pull, and the push test checks the bare origin's ref afterward.
import { execFileSync, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildFixture, cleanupFixture } from '../fixtures/build-fixture.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const port = process.env.E2E_SERVER_PORT ?? '4899';

export const PATHS_FILE = join(tmpdir(), 'diff-viewer-e2e-paths.json');

const fixture = buildFixture();
writeFileSync(PATHS_FILE, JSON.stringify(fixture));
process.stderr.write(`[e2e] fixture repo at ${fixture.fixtureDir}\n`);

execFileSync('cargo', ['build', '-p', 'server'], { cwd: repoRoot, stdio: 'inherit' });

const binary = join(repoRoot, 'target', 'debug', 'diff-viewer-server');
const child = spawn(binary, ['--repo', fixture.fixtureDir, '--port', port], { stdio: 'inherit' });

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  child.kill('SIGTERM');
  cleanupFixture(fixture);
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
