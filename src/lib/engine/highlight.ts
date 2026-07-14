/**
 * Lightweight syntax highlighting derived from the tree-sitter parse we already
 * do for semantics — no separate highlight grammar needed. We walk the tree and
 * classify atomic nodes (keywords, strings, numbers, comments, types,
 * constants) into a small, readable token set. Identifiers stay uncolored to
 * keep the result calm rather than rainbow.
 *
 * Columns are tree-sitter byte columns; for the overwhelmingly-ASCII case that
 * matches char offsets. Non-ASCII lines may highlight slightly off — acceptable
 * and non-fatal.
 */
import type { Node } from '@vscode/tree-sitter-wasm';
import type { Token, TokenClass } from './model';

/** Classify a node by type; a non-null result is atomic (don't descend). */
function classify(type: string, isNamed: boolean): TokenClass | null {
  if (type.includes('comment')) return 'comment';
  if (type.includes('string')) return 'string';
  if (
    type === 'char_literal' ||
    type === 'rune_literal' ||
    type === 'character_literal'
  )
    return 'string';
  if (
    type.includes('number') ||
    type.includes('integer') ||
    type.includes('float') ||
    type === 'int_literal' ||
    type === 'imaginary_literal'
  )
    return 'number';
  if (
    type === 'true' ||
    type === 'false' ||
    type === 'null' ||
    type === 'nil' ||
    type === 'none' ||
    type === 'undefined' ||
    type === 'boolean' ||
    type === 'boolean_literal'
  )
    return 'constant';
  if (
    type === 'type_identifier' ||
    type === 'primitive_type' ||
    type === 'predefined_type'
  )
    return 'type';
  // Anonymous alphabetic leaves are keywords (fn, return, class, def, and…).
  if (!isNamed && /^[a-z][a-z_]*$/i.test(type)) return 'keyword';
  return null;
}

/**
 * Produce syntax tokens for every line of `source`, indexed by 0-based row.
 * Multi-line nodes (block comments, multiline strings) are split per row.
 */
export function tokenize(root: Node, source: string): Token[][] {
  const lineLengths = source.split('\n').map((l) => l.length);
  const byLine: Token[][] = lineLengths.map(() => []);

  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    const cls = classify(node.type, node.isNamed);
    if (cls) {
      const sr = node.startPosition.row;
      const sc = node.startPosition.column;
      const er = node.endPosition.row;
      const ec = node.endPosition.column;
      if (sr === er) {
        byLine[sr]?.push({ start: sc, end: ec, cls });
      } else {
        for (let r = sr; r <= er; r++) {
          const start = r === sr ? sc : 0;
          const end = r === er ? ec : (lineLengths[r] ?? 0);
          byLine[r]?.push({ start, end, cls });
        }
      }
      continue; // atomic — don't descend
    }
    const kids = node.children;
    for (let i = kids.length - 1; i >= 0; i--) {
      if (kids[i]) stack.push(kids[i] as Node);
    }
  }

  for (const arr of byLine) arr.sort((a, b) => a.start - b.start);
  return byLine;
}
