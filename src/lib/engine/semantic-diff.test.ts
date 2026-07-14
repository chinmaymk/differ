import { describe, it, expect } from 'vitest';
import { matchSymbols } from './semantic-diff';
import type { SymbolNode, SymbolChange } from './model';

/** Build a SymbolNode with controllable hashes/fingerprint for the matcher. */
function sym(
  name: string,
  opts: Partial<SymbolNode> & { kind?: SymbolNode['kind'] } = {},
): SymbolNode {
  return {
    id: name,
    kind: opts.kind ?? 'function',
    name,
    startLine: opts.startLine ?? 1,
    endLine: opts.endLine ?? 1,
    startByte: opts.startByte ?? 0,
    endByte: opts.endByte ?? 0,
    signatureHash: opts.signatureHash ?? `sig:${name}`,
    bodyHash: opts.bodyHash ?? `body:${name}`,
    fingerprint: opts.fingerprint ?? [1, 2, 3],
    children: opts.children ?? [],
  };
}

const byName = (changes: SymbolChange[]) =>
  Object.fromEntries(changes.map((c) => [c.name, c]));

describe('matchSymbols', () => {
  it('detects unchanged symbols', () => {
    const a = [sym('foo')];
    const b = [sym('foo')];
    const [c] = matchSymbols(a, b);
    expect(c.status).toBe('unchanged');
    expect(c.hasChanges).toBe(false);
  });

  it('detects added and removed symbols', () => {
    // Distinct bodies so they are not mistaken for a rename.
    const changes = matchSymbols(
      [sym('gone', { bodyHash: 'g', fingerprint: [10, 20, 30] })],
      [sym('fresh', { bodyHash: 'f', fingerprint: [40, 50, 60] })],
    );
    const m = byName(changes);
    expect(m['gone'].status).toBe('removed');
    expect(m['fresh'].status).toBe('added');
  });

  it('detects a body modification', () => {
    const a = [sym('foo', { bodyHash: 'b1' })];
    const b = [sym('foo', { bodyHash: 'b2' })];
    const [c] = matchSymbols(a, b);
    expect(c.status).toBe('modified');
    expect(c.detail).toBe('body');
  });

  it('detects a signature-only modification', () => {
    const a = [sym('foo', { signatureHash: 's1', bodyHash: 'same' })];
    const b = [sym('foo', { signatureHash: 's2', bodyHash: 'same' })];
    const [c] = matchSymbols(a, b);
    expect(c.status).toBe('modified');
    expect(c.detail).toBe('signature');
  });

  it('detects a rename when the body is identical', () => {
    const a = [sym('oldName', { bodyHash: 'shared', fingerprint: [1, 2, 3] })];
    const b = [sym('newName', { bodyHash: 'shared', fingerprint: [1, 2, 3] })];
    const [c] = matchSymbols(a, b);
    expect(c.status).toBe('renamed');
    expect(c.oldName).toBe('oldName');
    expect(c.name).toBe('newName');
    expect(c.confidence).toBe(1);
  });

  it('detects a rename via high fingerprint similarity', () => {
    const a = [sym('alpha', { bodyHash: 'x', fingerprint: [1, 2, 3, 4, 5] })];
    const b = [sym('beta', { bodyHash: 'y', fingerprint: [1, 2, 3, 4, 9] })];
    const [c] = matchSymbols(a, b);
    expect(c.status).toBe('renamed'); // 8/10 = 0.8 >= 0.6
  });

  it('does NOT rename when bodies are dissimilar (conservative)', () => {
    const a = [sym('alpha', { bodyHash: 'x', fingerprint: [1, 2, 3] })];
    const b = [sym('beta', { bodyHash: 'y', fingerprint: [7, 8, 9] })];
    const changes = matchSymbols(a, b);
    const m = byName(changes);
    expect(m['alpha'].status).toBe('removed');
    expect(m['beta'].status).toBe('added');
  });

  it('recurses into children of a modified container', () => {
    const oldClass = sym('C', {
      kind: 'class',
      bodyHash: 'c1',
      children: [sym('m', { kind: 'method', bodyHash: 'm1' })],
    });
    const newClass = sym('C', {
      kind: 'class',
      bodyHash: 'c2',
      children: [sym('m', { kind: 'method', bodyHash: 'm2' })],
    });
    const [c] = matchSymbols([oldClass], [newClass]);
    expect(c.status).toBe('modified');
    expect(c.children[0].name).toBe('m');
    expect(c.children[0].status).toBe('modified');
  });

  it('detects a move across parents (same name+body, different container)', () => {
    const oldRoots = [
      sym('A', { kind: 'class', bodyHash: 'a', children: [sym('shared', { kind: 'method', bodyHash: 'B' })] }),
      sym('B', { kind: 'class', bodyHash: 'b', children: [] }),
    ];
    const newRoots = [
      sym('A', { kind: 'class', bodyHash: 'a2', children: [] }),
      sym('B', { kind: 'class', bodyHash: 'b2', children: [sym('shared', { kind: 'method', bodyHash: 'B' })] }),
    ];
    const changes = matchSymbols(oldRoots, newRoots);
    // The method should appear once, as 'moved', under new B — not as a
    // removed+added pair.
    const allChanges: SymbolChange[] = [];
    const walk = (cs: SymbolChange[]) => cs.forEach((c) => (allChanges.push(c), walk(c.children)));
    walk(changes);
    const moved = allChanges.filter((c) => c.name === 'shared');
    expect(moved).toHaveLength(1);
    expect(moved[0].status).toBe('moved');
  });

  it('handles overloads (duplicate keys) by pairing in order', () => {
    const a = [sym('f', { bodyHash: 'f1', startLine: 1 }), sym('f', { bodyHash: 'f2', startLine: 5 })];
    const b = [sym('f', { bodyHash: 'f1', startLine: 1 }), sym('f', { bodyHash: 'f9', startLine: 5 })];
    const changes = matchSymbols(a, b).filter((c) => c.name === 'f');
    expect(changes).toHaveLength(2);
    expect(changes.filter((c) => c.status === 'unchanged')).toHaveLength(1);
    expect(changes.filter((c) => c.status === 'modified')).toHaveLength(1);
  });
});
