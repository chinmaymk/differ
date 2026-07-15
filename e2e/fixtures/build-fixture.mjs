// Builds a fresh fixture repo covering the app's major git-facing features
// in one shape: two pushed commits, a branch, a tag, a remote (bare origin)
// plus a synced "upstream clone" for simulating incoming commits (pull), and
// a deliberately varied set of *uncommitted* worktree changes (modified,
// renamed, removed, added) for the file-list/hunk/staging tests. Returns the
// paths E2E specs need to drive/verify the scenario from outside the UI too
// (e.g. checking the bare origin's ref after a push).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, unlinkSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A minimal valid 1x1 transparent PNG — enough for the image-diff view to
// decode real dimensions, without shipping a binary asset in the repo.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

export function buildFixture() {
  const root = mkdtempSync(join(tmpdir(), 'diff-viewer-e2e-'));
  const fixtureDir = join(root, 'repo');
  const originDir = join(root, 'origin.git');
  const upstreamCloneDir = join(root, 'upstream-clone');
  mkdirSync(fixtureDir);

  const git = (args, cwd = fixtureDir) => execFileSync('git', args, { cwd, stdio: 'inherit' });
  const gitOut = (args, cwd = fixtureDir) => execFileSync('git', args, { cwd }).toString().trim();

  execFileSync('git', ['init', '--bare', '-q', '-b', 'main', originDir]);

  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'e2e@example.com']);
  git(['config', 'user.name', 'E2E Fixture']);
  git(['remote', 'add', 'origin', originDir]);

  // Commit 1: baseline files, including two that get mutated in the worktree
  // later (old-name.txt → renamed, remove-me.txt → deleted).
  writeFileSync(join(fixtureDir, 'readme.txt'), 'Hello\nWorld\n');
  writeFileSync(join(fixtureDir, 'keep.txt'), 'one\ntwo\nthree\n');
  writeFileSync(join(fixtureDir, 'old-name.txt'), 'alpha\nbeta\ngamma\ndelta\n');
  writeFileSync(join(fixtureDir, 'remove-me.txt'), 'bye\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'initial commit']);
  const firstCommitSha = gitOut(['rev-parse', 'HEAD']);

  // Commit 2: a text modification + a binary addition (image-diff coverage).
  writeFileSync(join(fixtureDir, 'keep.txt'), 'one\nTWO\nthree\n');
  writeFileSync(join(fixtureDir, 'logo.png'), TINY_PNG);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'second commit']);
  git(['push', '-q', '-u', 'origin', 'main']);
  const secondCommitSha = gitOut(['rev-parse', 'HEAD']);

  // A branch with one commit beyond HEAD, for the Branches tab.
  git(['branch', 'feature']);
  git(['checkout', '-q', 'feature']);
  writeFileSync(join(fixtureDir, 'readme.txt'), 'Hello\nWorld\nFeature note\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'feature work']);
  git(['checkout', '-q', 'main']);

  // An annotated tag on the FIRST commit (not HEAD), so comparing against it
  // produces a non-empty diff (HEAD's second-commit changes reversed) — a
  // tag pointing at HEAD would show nothing.
  git(['tag', '-a', 'v1.0', firstCommitSha, '-m', 'release notes for v1.0']);

  // A synced clone of origin, used by the pull test to simulate a teammate
  // pushing new work — created now, while it's still in sync with origin,
  // so a later commit there is a clean fast-forward for the fixture repo.
  execFileSync('git', ['clone', '-q', originDir, upstreamCloneDir]);
  execFileSync('git', ['config', 'user.email', 'upstream@example.com'], { cwd: upstreamCloneDir });
  execFileSync('git', ['config', 'user.name', 'Upstream Contributor'], { cwd: upstreamCloneDir });

  // Finally, the *uncommitted* worktree state the app opens into. Plain
  // filesystem ops (not `git add`/`git mv`) so these land as unstaged/
  // untracked changes — list_changes' rename detection runs on every diff
  // kind, so the plain rename below is still picked up as "renamed".
  writeFileSync(join(fixtureDir, 'keep.txt'), 'one\nTWO\nthree\nfour\n'); // modified
  renameSync(join(fixtureDir, 'old-name.txt'), join(fixtureDir, 'new-name.txt')); // renamed
  unlinkSync(join(fixtureDir, 'remove-me.txt')); // removed
  writeFileSync(join(fixtureDir, 'new-file.txt'), 'brand new content\n'); // added

  return { root, fixtureDir, originDir, upstreamCloneDir, firstCommitSha, secondCommitSha };
}

export function cleanupFixture(paths) {
  rmSync(paths.root, { recursive: true, force: true });
}
