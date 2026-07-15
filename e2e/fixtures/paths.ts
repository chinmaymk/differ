import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Written by e2e/scripts/start-headless-server.mjs once at webServer startup. */
const PATHS_FILE = join(tmpdir(), 'diff-viewer-e2e-paths.json');

export interface FixturePaths {
  root: string;
  fixtureDir: string;
  originDir: string;
  upstreamCloneDir: string;
  firstCommitSha: string;
  secondCommitSha: string;
}

export function readFixturePaths(): FixturePaths {
  return JSON.parse(readFileSync(PATHS_FILE, 'utf8'));
}
