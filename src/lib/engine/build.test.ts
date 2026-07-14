import { describe, it, expect, beforeAll } from 'vitest';
import { buildFileDiff } from './build';
import type { DiffEntry, SymbolChange } from './model';
import { useNodeEngine } from './wasm-node';

beforeAll(() => useNodeEngine());

const enc = new TextEncoder();
const entry = (path: string, oldSrc: string | null, newSrc: string | null): DiffEntry => ({
  path,
  status: oldSrc === null ? 'added' : newSrc === null ? 'removed' : 'modified',
  oldBytes: oldSrc === null ? null : enc.encode(oldSrc),
  newBytes: newSrc === null ? null : enc.encode(newSrc),
});

const findSym = (roots: SymbolChange[], name: string): SymbolChange | undefined => {
  for (const r of roots) {
    if (r.name === name) return r;
    const inner = findSym(r.children, name);
    if (inner) return inner;
  }
  return undefined;
};

describe('buildFileDiff — end to end', () => {
  it('correlates a modified function to its changed lines', async () => {
    const oldSrc = `fn untouched() -> i32 {
    1
}

fn target(a: i32) -> i32 {
    a + 1
}
`;
    const newSrc = `fn untouched() -> i32 {
    1
}

fn target(a: i32) -> i32 {
    a + 100
}
`;
    const fd = await buildFileDiff(entry('lib.rs', oldSrc, newSrc));
    expect(fd.lang).toBe('rust');
    expect(fd.binary).toBe(false);
    expect(fd.semantic.textOnly).toBe(false);

    const target = findSym(fd.semantic.roots, 'target');
    const untouched = findSym(fd.semantic.roots, 'untouched');
    expect(target?.status).toBe('modified');
    expect(untouched?.status).toBe('unchanged');

    // The change is inside `target`, so it carries the +1/−1, and the
    // unchanged function carries nothing (the key correlation invariant).
    expect(target!.add).toBe(1);
    expect(target!.del).toBe(1);
    expect(untouched!.add).toBe(0);
    expect(untouched!.del).toBe(0);
  });

  it('honors the invariant: unchanged symbols have zero changed lines', async () => {
    const oldSrc = `fn a() { let x = 1; }\nfn b() { let y = 2; }\n`;
    const newSrc = `fn a() { let x = 1; }\nfn b() { let y = 999; }\n`;
    const fd = await buildFileDiff(entry('lib.rs', oldSrc, newSrc));
    for (const root of fd.semantic.roots) {
      if (root.status === 'unchanged') {
        expect(root.add + root.del).toBe(0);
      }
    }
    const b = findSym(fd.semantic.roots, 'b');
    expect(b?.status).toBe('modified');
  });

  it('attributes top-level (non-symbol) changes to fileLevel', async () => {
    const oldSrc = `use std::io;\n\nfn main() {}\n`;
    const newSrc = `use std::io;\nuse std::fmt;\n\nfn main() {}\n`;
    const fd = await buildFileDiff(entry('lib.rs', oldSrc, newSrc));
    expect(fd.semantic.fileLevel.add).toBe(1); // the added `use` line
    const main = findSym(fd.semantic.roots, 'main');
    expect(main?.status).toBe('unchanged');
  });

  it('falls back to text-only for unsupported languages', async () => {
    const fd = await buildFileDiff(entry('style.css', 'a{color:red}', 'a{color:blue}'));
    expect(fd.semantic.textOnly).toBe(true);
    expect(fd.semantic.reason).toBe('unsupported');
    expect(fd.text.hunks.length).toBeGreaterThan(0); // text diff still works
  });

  it('marks binary files', async () => {
    const bytes = new Uint8Array([1, 2, 0, 3, 255]);
    const fd = await buildFileDiff({
      path: 'img.png',
      status: 'modified',
      oldBytes: bytes,
      newBytes: new Uint8Array([1, 2, 0, 9]),
    });
    expect(fd.binary).toBe(true);
    expect(fd.text.hunks).toEqual([]);
  });

  it('handles an added file (no old side)', async () => {
    const fd = await buildFileDiff(entry('new.py', null, 'def hi():\n    return 1\n'));
    expect(fd.status).toBe('added');
    const hi = findSym(fd.semantic.roots, 'hi');
    expect(hi?.status).toBe('added');
    expect(hi!.add).toBeGreaterThan(0);
  });
});
