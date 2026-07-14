/**
 * Symbol extraction: parse a source file with tree-sitter, run its symbol
 * query, and build the light `SymbolNode` tree (a projection of the CST that
 * keeps only named declarations). The CST is deleted before returning — the
 * only thing that escapes is plain serializable data.
 */
import type { Node, Query } from '@vscode/tree-sitter-wasm';
import type { SymbolKind, SymbolNode } from './model';
import { getLangHandle } from './parser';

/** FNV-1a 32-bit hash → base36 string. Fast, allocation-free. */
function hashStr(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function firstLine(s: string): string {
  const nl = s.indexOf('\n');
  return nl === -1 ? s : s.slice(0, nl);
}

/** Sorted, de-duplicated hashes of non-blank body lines (Dice fingerprint). */
function fingerprintOf(bodyText: string): number[] {
  const set = new Set<number>();
  for (const raw of bodyText.split('\n')) {
    const line = raw.trim();
    if (line.length > 0) set.add(hash32(line));
  }
  return Array.from(set).sort((a, b) => a - b);
}

interface RawSym {
  kind: SymbolKind;
  name: string;
  node: Node;
  bodyNode: Node | null;
}

const DEF_PREFIX = 'def.';

/** True when `a`'s byte range strictly contains `b`'s. */
function contains(a: RawSym, b: RawSym): boolean {
  return (
    a.node.startIndex <= b.node.startIndex &&
    a.node.endIndex >= b.node.endIndex &&
    a !== b
  );
}

// Kinds that make a contained `function` actually a `method`.
const METHOD_PARENTS = new Set<SymbolKind>([
  'class',
  'interface',
  'struct',
  'impl',
  'trait',
]);

/**
 * Extract the symbol tree for a source file in the given language.
 * Returns [] for unknown languages or those without a symbol query.
 */
export async function extractSymbols(
  langId: string | null,
  source: string,
): Promise<SymbolNode[]> {
  if (!langId) return [];
  const handle = await getLangHandle(langId);
  if (!handle || !handle.query) return [];

  const tree = handle.parser.parse(source);
  if (!tree) return [];
  try {
    return symbolsFromTree(handle.query, tree.rootNode);
  } finally {
    tree.delete();
  }
}

/** Build the symbol tree from a query + parsed root (no tree ownership). */
export function symbolsFromTree(query: Query, root: Node): SymbolNode[] {
  const raws: RawSym[] = [];
  for (const match of query.matches(root)) {
    let kind: SymbolKind | null = null;
    let defNode: Node | null = null;
    let nameNode: Node | null = null;
    let bodyNode: Node | null = null;
    for (const cap of match.captures) {
      if (cap.name.startsWith(DEF_PREFIX)) {
        kind = cap.name.slice(DEF_PREFIX.length) as SymbolKind;
        defNode = cap.node;
      } else if (cap.name === 'name') {
        nameNode = cap.node;
      } else if (cap.name === 'body') {
        bodyNode = cap.node;
      }
    }
    if (kind && defNode && nameNode) {
      raws.push({ kind, name: nameNode.text, node: defNode, bodyNode });
    }
  }
  return buildTree(raws);
}

/** Nest raw symbols by byte containment and compute hashes. */
function buildTree(raws: RawSym[]): SymbolNode[] {
  // Dedupe identical ranges (a node matched by two patterns); prefer a
  // specific kind over the generic 'type'/'other'.
  const byRange = new Map<string, RawSym>();
  for (const r of raws) {
    const key = `${r.node.startIndex}:${r.node.endIndex}`;
    const prev = byRange.get(key);
    if (!prev || (prev.kind === 'type' && r.kind !== 'type')) {
      byRange.set(key, r);
    }
  }
  const items = Array.from(byRange.values());
  // Outer-first ordering: by start asc, then by end desc (wider first).
  items.sort(
    (a, b) =>
      a.node.startIndex - b.node.startIndex ||
      b.node.endIndex - a.node.endIndex,
  );

  const roots: SymbolNode[] = [];
  // Stack of open parents (RawSym + built node) for containment nesting.
  const stack: { raw: RawSym; node: SymbolNode }[] = [];
  let counter = 0;

  for (const raw of items) {
    // Pop parents that no longer contain this item.
    while (stack.length && !contains(stack[stack.length - 1].raw, raw)) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];

    let kind = raw.kind;
    if (kind === 'function' && parent && METHOD_PARENTS.has(parent.node.kind)) {
      kind = 'method';
    }

    const symText = raw.node.text;
    const bodyText = raw.bodyNode ? raw.bodyNode.text : symText;
    const sigText = symText.endsWith(bodyText)
      ? symText.slice(0, symText.length - bodyText.length)
      : firstLine(symText);

    const node: SymbolNode = {
      id: parent ? `${parent.node.id}.${parent.node.children.length}` : `${counter++}`,
      kind,
      name: raw.name,
      startLine: raw.node.startPosition.row + 1,
      endLine: raw.node.endPosition.row + 1,
      startByte: raw.node.startIndex,
      endByte: raw.node.endIndex,
      signatureHash: hashStr(sigText),
      bodyHash: hashStr(bodyText),
      fingerprint: fingerprintOf(bodyText),
      children: [],
    };

    if (parent) parent.node.children.push(node);
    else roots.push(node);
    stack.push({ raw, node });
  }

  return roots;
}
