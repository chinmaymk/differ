import { describe, it, expect } from 'vitest';
import {
  tokenize,
  candidateFiles,
  classifyContext,
  confirmReferences,
  CONFIRM_CANDIDATE_CAP,
} from './blast-radius';
import type { RepoIndex } from './dup-index';
import type { DiffSource, Revision } from './model';

function repoIndex(identifiers: Record<string, string[]>, totalFiles: number): RepoIndex {
  const identifierIndex = new Map<string, Set<string>>();
  for (const [word, files] of Object.entries(identifiers)) {
    identifierIndex.set(word, new Set(files));
  }
  return { entries: [], identifierIndex, totalFiles, capped: false };
}

const REV: Revision = { kind: 'worktree' };

describe('tokenize', () => {
  it('extracts identifier-like words and dedups them', () => {
    const set = tokenize('function foo(bar) { return foo + bar; }');
    expect([...set].sort()).toEqual(['bar', 'foo', 'function', 'return']);
  });

  it('drops words shorter than the minimum identifier length', () => {
    const set = tokenize('a ab abc');
    expect(set.has('a')).toBe(false);
    expect(set.has('ab')).toBe(false);
    expect(set.has('abc')).toBe(true);
  });
});

describe('candidateFiles', () => {
  it('excludes the symbol\'s own file', () => {
    const index = repoIndex({ formatDate: ['a.ts', 'b.ts'] }, 10);
    expect(candidateFiles('formatDate', 'a.ts', index)).toEqual(['b.ts']);
  });

  it('rejects names shorter than the minimum identifier length', () => {
    const index = repoIndex({ id: ['a.ts'] }, 10);
    expect(candidateFiles('id', 'x.ts', index)).toBeNull();
  });

  it('rejects names above the document-frequency ratio (too generic to this repo)', () => {
    const files = Array.from({ length: 20 }, (_, i) => `f${i}.ts`);
    const index = repoIndex({ common: files }, 100); // 20/100 = 20% > 12%
    expect(candidateFiles('common', 'own.ts', index)).toBeNull();
  });

  it('accepts names right at the document-frequency boundary', () => {
    const files = Array.from({ length: 11 }, (_, i) => `f${i}.ts`); // 11/100 = 11% < 12%
    const index = repoIndex({ specific: files }, 100);
    expect(candidateFiles('specific', 'own.ts', index)).toHaveLength(11);
  });

  it('returns null when there are no matches at all', () => {
    const index = repoIndex({}, 10);
    expect(candidateFiles('nowhere', 'own.ts', index)).toBeNull();
  });
});

describe('classifyContext', () => {
  it('classifies a call', () => {
    expect(classifyContext('formatDate', 'const s = formatDate(now);')).toBe('call');
  });

  it('classifies member access', () => {
    expect(classifyContext('formatDate', 'return utils.formatDate;')).toBe('member');
  });

  it('classifies type position (extends/implements/annotation/generic)', () => {
    // `new Widget()` is legitimately also call-shaped (checked first) — both
    // are "reference" categories, so that ambiguity doesn't affect
    // confirmReferences; here we test unambiguous type-position shapes.
    expect(classifyContext('Base', 'class Foo extends Base {}')).toBe('type-position');
    expect(classifyContext('Comparable', 'class Foo implements Comparable {}')).toBe('type-position');
    expect(classifyContext('Widget', 'let w: Widget;')).toBe('type-position');
    expect(classifyContext('Widget', 'const list: Array<Widget> = [];')).toBe('type-position');
  });

  it('classifies `new X()` as a reference (call-shaped, checked before type-position)', () => {
    expect(classifyContext('Widget', 'const w = new Widget();')).not.toBe('none');
  });

  it('classifies an import line', () => {
    expect(classifyContext('formatDate', "import { formatDate } from './utils';")).toBe('import');
  });

  it('returns none for incidental prose or unrelated words', () => {
    expect(classifyContext('formatDate', '// this comment mentions nothing relevant')).toBe('none');
    expect(classifyContext('foo', 'const foobar = 1;')).toBe('none'); // word-boundary, not a substring match
  });
});

describe('confirmReferences', () => {
  function fakeSource(files: Record<string, string>): DiffSource {
    return {
      label: () => 'fake',
      listChanges: async () => [],
      readEntry: async () => {
        throw new Error('not used');
      },
      readFileAt: async (_rev, path) => {
        const text = files[path];
        return text === undefined ? null : new TextEncoder().encode(text);
      },
    };
  }

  it('confirms only files with a reference-shaped match', () => {
    // totalFiles high enough that 2 candidate files stay under MAX_DOC_FREQ_RATIO.
    const index = repoIndex({ formatDate: ['a.ts', 'b.ts'] }, 50);
    const source = fakeSource({
      'a.ts': 'const s = formatDate(now);',
      'b.ts': '// formatDate is mentioned here but not used',
    });
    return confirmReferences('formatDate', 'own.ts', index, source, REV).then((result) => {
      expect(result.count).toBe(1);
      expect(result.files).toEqual(['a.ts']);
    });
  });

  it('falls back to the unconfirmed count when candidates exceed the cap', async () => {
    const many = Array.from({ length: CONFIRM_CANDIDATE_CAP + 5 }, (_, i) => `f${i}.ts`);
    const index = repoIndex({ widely: many }, 1000); // stays under 12% doc-freq ratio
    const source = fakeSource({});
    const result = await confirmReferences('widely', 'own.ts', index, source, REV);
    expect(result.count).toBe(many.length);
    expect(result.files).toHaveLength(5);
  });

  it('skips a candidate whose content is unavailable without throwing', async () => {
    const index = repoIndex({ formatDate: ['missing.ts'] }, 10);
    const source = fakeSource({}); // readFileAt resolves null for any path
    const result = await confirmReferences('formatDate', 'own.ts', index, source, REV);
    expect(result.count).toBe(0);
  });

  it('reuses a shared fetch cache across calls', async () => {
    let reads = 0;
    const index = repoIndex({ shared: ['a.ts'] }, 10);
    const source: DiffSource = {
      label: () => 'fake',
      listChanges: async () => [],
      readEntry: async () => {
        throw new Error('not used');
      },
      readFileAt: async () => {
        reads++;
        return new TextEncoder().encode('shared(1);');
      },
    };
    const cache = new Map();
    await confirmReferences('shared', 'own.ts', index, source, REV, cache);
    await confirmReferences('shared', 'own2.ts', index, source, REV, cache);
    expect(reads).toBe(1);
  });
});
