/**
 * Single-parse analysis: parse a source file ONCE and produce both the symbol
 * tree (for semantic diff) and syntax tokens (for highlighting), then dispose
 * the CST. Reusing one parse for both keeps the worker fast and memory low.
 */
import type { SymbolNode, Token } from './model';
import { getLangHandle } from './parser';
import { symbolsFromTree } from './extract';
import { tokenize } from './highlight';

export interface Analysis {
  symbols: SymbolNode[];
  /** Syntax tokens indexed by 0-based line row. */
  tokens: Token[][];
}

const EMPTY: Analysis = { symbols: [], tokens: [] };

/**
 * Parse `source` in `langId` and return symbols + per-line tokens. Returns
 * empty analysis for unknown languages (no grammar). A language with a grammar
 * but no symbol query still yields syntax tokens (so text-only languages are
 * highlighted too).
 */
export async function analyzeSource(
  langId: string | null,
  source: string,
): Promise<Analysis> {
  if (!langId) return EMPTY;
  const handle = await getLangHandle(langId);
  if (!handle) return EMPTY;

  const tree = handle.parser.parse(source);
  if (!tree) return EMPTY;
  try {
    const symbols = handle.query
      ? symbolsFromTree(handle.query, tree.rootNode)
      : [];
    const tokens = tokenize(tree.rootNode, source);
    return { symbols, tokens };
  } finally {
    tree.delete();
  }
}
