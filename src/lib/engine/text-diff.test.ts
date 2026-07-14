import { describe, it, expect } from 'vitest';
import { diffLines, splitLines, inlineSpans, refineHunk } from './text-diff';
import type { DiffLine } from './model';

const flat = (d: ReturnType<typeof diffLines>): DiffLine[] =>
  d.hunks.flatMap((h) => h.lines);

describe('splitLines', () => {
  it('handles trailing newline without a spurious empty line', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\nb')).toEqual(['a', 'b']);
    expect(splitLines('')).toEqual([]);
    expect(splitLines('a\n\n')).toEqual(['a', '']); // preserves blank line
  });
});

describe('diffLines', () => {
  it('reports no hunks for identical text', () => {
    const d = diffLines('a\nb\nc\n', 'a\nb\nc\n');
    expect(d.hunks).toEqual([]);
    expect(d.add).toBe(0);
    expect(d.del).toBe(0);
  });

  it('detects a single-line modification', () => {
    const d = diffLines('a\nb\nc\n', 'a\nB\nc\n');
    expect(d.add).toBe(1);
    expect(d.del).toBe(1);
    const lines = flat(d);
    expect(lines.find((l) => l.op === 'del')?.text).toBe('b');
    expect(lines.find((l) => l.op === 'add')?.text).toBe('B');
  });

  it('assigns correct old/new line numbers', () => {
    const d = diffLines('a\nb\nc\nd\n', 'a\nc\nd\n'); // delete b (old line 2)
    const del = flat(d).find((l) => l.op === 'del');
    expect(del?.oldLine).toBe(2);
    expect(del?.newLine).toBeNull();
  });

  it('handles a pure addition (new file)', () => {
    const d = diffLines('', 'x\ny\n');
    expect(d.add).toBe(2);
    expect(d.del).toBe(0);
    expect(flat(d).every((l) => l.op === 'add')).toBe(true);
  });

  it('handles a pure deletion (removed file)', () => {
    const d = diffLines('x\ny\n', '');
    expect(d.del).toBe(2);
    expect(d.add).toBe(0);
    expect(flat(d).every((l) => l.op === 'del')).toBe(true);
  });

  it('merges nearby changes into one hunk but splits distant ones', () => {
    const oldT = Array.from({ length: 40 }, (_, i) => `line${i}`).join('\n');
    const lines = oldT.split('\n');
    lines[2] = 'CHANGED_A';
    lines[35] = 'CHANGED_B';
    const newT = lines.join('\n');
    const d = diffLines(oldT, newT);
    expect(d.hunks.length).toBe(2); // far apart -> two hunks
  });

  it('keeps context lines around a change', () => {
    const oldT = 'a\nb\nc\nd\ne\nf\ng\n';
    const newT = 'a\nb\nc\nX\ne\nf\ng\n';
    const d = diffLines(oldT, newT);
    expect(d.hunks.length).toBe(1);
    const ctx = d.hunks[0].lines.filter((l) => l.op === 'context');
    expect(ctx.length).toBe(6); // 3 above + 3 below
  });

  it('bails out on very large input', () => {
    const big = 'x\n'.repeat(60_000);
    const d = diffLines(big, big + 'y\n');
    expect(d.truncated).toBe(true);
    expect(d.hunks).toEqual([]);
  });
});

describe('inlineSpans', () => {
  it('highlights only the changed word', () => {
    const { del, add } = inlineSpans('const x = 1;', 'const y = 1;');
    const delChanged = del.filter((s) => s.kind === 'del');
    const addChanged = add.filter((s) => s.kind === 'add');
    expect(delChanged).toHaveLength(1);
    expect(addChanged).toHaveLength(1);
    // 'x' is at offset 6..7
    expect('const x = 1;'.slice(delChanged[0].start, delChanged[0].end)).toBe('x');
    expect('const y = 1;'.slice(addChanged[0].start, addChanged[0].end)).toBe('y');
  });
});

describe('refineHunk', () => {
  it('fills inline spans on paired del/add lines', () => {
    const d = diffLines('foo(a, b);\n', 'foo(a, c);\n');
    refineHunk(d.hunks[0]);
    const del = d.hunks[0].lines.find((l) => l.op === 'del');
    const add = d.hunks[0].lines.find((l) => l.op === 'add');
    expect(del?.inline).toBeDefined();
    expect(add?.inline).toBeDefined();
    expect(del!.inline!.some((s) => s.kind === 'del')).toBe(true);
  });
});
