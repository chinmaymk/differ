import { describe, it, expect } from 'vitest';
import { scoreFile } from './importance';
import type {
  DuplicateMatch,
  SymbolBlastRadius,
} from './importance';
import type { FileDiff, SymbolChange, SymbolKind } from './model';

let nextId = 0;

function symChange(name: string, opts: Partial<SymbolChange> = {}): SymbolChange {
  return {
    id: opts.id ?? `sym-${nextId++}`,
    kind: opts.kind ?? 'function',
    name,
    status: opts.status ?? 'modified',
    oldName: opts.oldName,
    detail: opts.detail,
    confidence: opts.confidence,
    old: opts.old,
    new: opts.new,
    add: opts.add ?? 1,
    del: opts.del ?? 1,
    hasChanges: opts.hasChanges ?? true,
    fingerprint: opts.fingerprint ?? [],
    children: opts.children ?? [],
  };
}

function fileDiff(
  path: string,
  roots: SymbolChange[],
  opts: Partial<FileDiff> & { textOnly?: boolean } = {},
): FileDiff {
  return {
    path,
    oldPath: opts.oldPath,
    status: opts.status ?? 'modified',
    lang: opts.lang ?? 'typescript',
    binary: opts.binary ?? false,
    text: { hunks: [], add: opts.add ?? 0, del: opts.del ?? 0, truncated: false },
    semantic: {
      roots,
      fileLevel: { add: 0, del: 0 },
      textOnly: opts.textOnly ?? false,
    },
    add: opts.add ?? 0,
    del: opts.del ?? 0,
  };
}

describe('scoreFile', () => {
  it('ranks a signature change above a body-only change, all else equal', () => {
    const sig = fileDiff('a.ts', [
      symChange('foo', { detail: 'signature', add: 3, del: 3 }),
    ]);
    const body = fileDiff('a.ts', [
      symChange('foo', { detail: 'body', add: 3, del: 3 }),
    ]);
    expect(scoreFile(sig).score).toBeGreaterThan(scoreFile(body).score);
  });

  it('ranks "both" between signature and body', () => {
    const mk = (detail: 'signature' | 'both' | 'body') =>
      scoreFile(fileDiff('a.ts', [symChange('foo', { detail, add: 3, del: 3 })])).score;
    expect(mk('signature')).toBeGreaterThan(mk('both'));
    expect(mk('both')).toBeGreaterThan(mk('body'));
  });

  it('dampens scores for test-file paths', () => {
    const change = () => [symChange('foo', { detail: 'signature', add: 5, del: 5 })];
    const normal = scoreFile(fileDiff('src/lib/foo.ts', change())).score;
    const test1 = scoreFile(fileDiff('src/lib/foo.test.ts', change())).score;
    const test2 = scoreFile(fileDiff('src/lib/__tests__/foo.ts', change())).score;
    const test3 = scoreFile(fileDiff('src/lib/foo_test.ts', change())).score;
    expect(test1).toBeLessThan(normal);
    expect(test2).toBeLessThan(normal);
    expect(test3).toBeLessThan(normal);
  });

  it('de-weights low-signal kinds relative to function/class', () => {
    const mk = (kind: SymbolKind) =>
      scoreFile(
        fileDiff('a.ts', [symChange('x', { kind, detail: 'body', add: 2, del: 2 })]),
      ).score;
    expect(mk('function')).toBeGreaterThan(mk('constant'));
    expect(mk('function')).toBeGreaterThan(mk('field'));
    expect(mk('function')).toBeGreaterThan(mk('test'));
    expect(mk('class')).toBeGreaterThan(mk('field'));
  });

  it('scales magnitude sub-linearly', () => {
    const mk = (n: number) =>
      scoreFile(fileDiff('a.ts', [symChange('x', { detail: 'body', add: n, del: 0 })])).score;
    const small = mk(5);
    const big = mk(50); // 10x the lines
    expect(big).toBeGreaterThan(small);
    expect(big / small).toBeLessThan(2); // nowhere near a 10x score jump
  });

  it('uses max, not sum, so one big signature change outranks many trivial field tweaks', () => {
    const bigSignature = fileDiff('a.ts', [
      symChange('important', { kind: 'function', detail: 'signature', add: 4, del: 4 }),
    ]);
    const manyTrivial = fileDiff('b.ts', [
      ...Array.from({ length: 50 }, (_, i) =>
        symChange(`field${i}`, { kind: 'field', detail: 'body', add: 1, del: 1 }),
      ),
    ]);
    expect(scoreFile(bigSignature).score).toBeGreaterThan(scoreFile(manyTrivial).score);
  });

  it('falls back to file-status scoring for text-only diffs', () => {
    const diff = fileDiff('image.png', [], { textOnly: true, status: 'added', add: 0, del: 0 });
    const result = scoreFile(diff);
    expect(result.reasons[0]).toEqual({ kind: 'file-status', text: 'new file' });
  });

  it('reports a file-status reason when there are no scored symbols', () => {
    const diff = fileDiff('README.md', [], { status: 'removed' });
    expect(scoreFile(diff).reasons[0].text).toBe('deleted file');
  });

  it('describes a signature change as the top reason', () => {
    const diff = fileDiff('a.ts', [
      symChange('login', { kind: 'function', detail: 'signature', add: 2, del: 1 }),
    ]);
    const { reasons } = scoreFile(diff);
    expect(reasons.some((r) => r.text.includes('signature change to `login()`'))).toBe(true);
  });

  it('describes a rename as the top reason', () => {
    const diff = fileDiff('a.ts', [
      symChange('newName', { kind: 'function', status: 'renamed', oldName: 'oldName', add: 0, del: 0 }),
    ]);
    const { reasons } = scoreFile(diff);
    expect(reasons.some((r) => r.text.includes('renamed `oldName` → `newName`'))).toBe(true);
  });

  it('describes a new symbol as the top reason', () => {
    const diff = fileDiff('a.ts', [
      symChange('UserService', { kind: 'class', status: 'added', add: 10, del: 0 }),
    ]);
    const { reasons } = scoreFile(diff);
    expect(reasons.some((r) => r.text.includes('new class `UserService`'))).toBe(true);
  });

  it('surfaces a duplicate-match reason when provided', () => {
    const target = symChange('formatDate', { kind: 'function', status: 'added', add: 5, del: 0 });
    const diff = fileDiff('a.ts', [target]);
    const duplicates: DuplicateMatch[] = [
      {
        symbolId: target.id,
        symbolName: 'formatDate',
        matchPath: 'src/lib/utils.ts',
        matchName: 'formatDate',
        similarity: 0.82,
      },
    ];
    const { reasons } = scoreFile(diff, { duplicates });
    expect(
      reasons.some((r) => r.text.includes('possible duplicate of `formatDate` in `src/lib/utils.ts` — 82% similar')),
    ).toBe(true);
  });

  it('boosts score and adds a warning reason for a removed symbol still referenced elsewhere', () => {
    const removed = symChange('oldHelper', {
      kind: 'function',
      status: 'removed',
      add: 0,
      del: 5,
    });
    const diff = fileDiff('a.ts', [removed]);
    const blastRadii: SymbolBlastRadius[] = [
      { symbolId: removed.id, count: 6, files: ['x.ts', 'y.ts'] },
    ];
    const { reasons, score } = scoreFile(diff, { blastRadii });
    expect(reasons[0].text).toBe('⚠ removed but still referenced in 6 files');

    const withoutBlast = scoreFile(fileDiff('b.ts', [
      symChange('oldHelper', { kind: 'function', status: 'removed', add: 0, del: 5 }),
    ])).score;
    expect(score).toBeGreaterThan(withoutBlast);
  });

  it('does not pad reasons with a generic file-status fallback when a symbol reason already exists', () => {
    const diff = fileDiff('a.ts', [
      symChange('perimeter', { kind: 'method', status: 'added', add: 2, del: 0 }),
    ]);
    const { reasons } = scoreFile(diff);
    expect(reasons).toHaveLength(1);
    expect(reasons[0].kind).toBe('symbol-change');
  });

  it('caps reasons at 3', () => {
    const target = symChange('formatDate', { kind: 'function', status: 'removed', add: 0, del: 5 });
    const diff = fileDiff('a.ts', [target]);
    const duplicates: DuplicateMatch[] = [
      { symbolId: target.id, symbolName: 'formatDate', matchPath: 'x.ts', matchName: 'formatDate', similarity: 0.9 },
    ];
    const blastRadii: SymbolBlastRadius[] = [{ symbolId: target.id, count: 3, files: ['x.ts'] }];
    const { reasons } = scoreFile(diff, { duplicates, blastRadii });
    expect(reasons.length).toBeLessThanOrEqual(3);
  });
});
