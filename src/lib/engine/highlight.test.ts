import { describe, it, expect, beforeAll } from 'vitest';
import { analyzeSource } from './analyze';
import type { Token, TokenClass } from './model';
import { useNodeEngine } from './wasm-node';

beforeAll(() => useNodeEngine());

/** Text of every token of a given class on a given 0-based line. */
function texts(src: string, tokens: Token[][], line: number, cls: TokenClass): string[] {
  const lineText = src.split('\n')[line];
  return (tokens[line] ?? [])
    .filter((t) => t.cls === cls)
    .map((t) => lineText.slice(t.start, t.end));
}

describe('syntax tokenizer', () => {
  it('classifies keywords, strings, numbers, comments in Rust', async () => {
    const src = [
      '// a comment',
      'fn main() {',
      '    let x = 42;',
      '    let s = "hello";',
      '}',
    ].join('\n');
    const { tokens } = await analyzeSource('rust', src);

    expect(texts(src, tokens, 0, 'comment')[0]).toContain('a comment');
    expect(texts(src, tokens, 1, 'keyword')).toContain('fn');
    expect(texts(src, tokens, 2, 'keyword')).toContain('let');
    expect(texts(src, tokens, 2, 'number')).toContain('42');
    expect(texts(src, tokens, 3, 'string')).toContain('"hello"');
  });

  it('highlights text-only languages that still have a grammar', async () => {
    // CSS has a grammar but no symbol query — highlighting must still work.
    const src = 'a { color: red; }';
    const { symbols, tokens } = await analyzeSource('css', src);
    expect(symbols).toEqual([]);
    expect(tokens.length).toBeGreaterThan(0);
  });

  it('classifies types and keywords in TypeScript', async () => {
    const src = 'class Circle {}';
    const { tokens } = await analyzeSource('typescript', src);
    expect(texts(src, tokens, 0, 'keyword')).toContain('class');
    expect(texts(src, tokens, 0, 'type')).toContain('Circle');
  });
});
