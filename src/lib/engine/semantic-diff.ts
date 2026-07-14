/**
 * Semantic matcher (pure — operates on `SymbolNode` trees, no tree-sitter).
 *
 * Classifies each symbol as added / removed / modified / renamed / moved /
 * unchanged using scoped, recursive, second-chance matching:
 *   1. Exact `(kind, name)` pairing within the same parent's children.
 *   2. Rename: residual same-kind symbols with high body similarity.
 *   3. Move: a global pass over still-unmatched symbols across parents.
 * Cost is bounded by the number of *changed* symbols, not file size.
 */
import type {
  SemanticDiff,
  SymbolChange,
  SymbolNode,
  SymbolRef,
  ModifiedDetail,
} from './model';

/** Minimum Dice similarity to treat a residual pair as a rename. */
const RENAME_THRESHOLD = 0.6;
/** Minimum similarity to treat a residual cross-parent pair as a move. */
const MOVE_THRESHOLD = 0.7;

function refOf(s: SymbolNode): SymbolRef {
  return {
    startLine: s.startLine,
    endLine: s.endLine,
    startByte: s.startByte,
    endByte: s.endByte,
  };
}

function key(s: SymbolNode): string {
  return `${s.kind}\0${s.name}`;
}

/** Dice coefficient over two sorted, de-duplicated hash arrays. */
function dice(a: number[], b: number[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  let i = 0;
  let j = 0;
  let inter = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      inter++;
      i++;
      j++;
    } else if (a[i] < b[j]) {
      i++;
    } else {
      j++;
    }
  }
  return (2 * inter) / (a.length + b.length);
}

function similarity(a: SymbolNode, b: SymbolNode): number {
  if (a.bodyHash === b.bodyHash) return 1;
  return dice(a.fingerprint, b.fingerprint);
}

function modifiedDetail(a: SymbolNode, b: SymbolNode): ModifiedDetail {
  const sig = a.signatureHash !== b.signatureHash;
  const body = a.bodyHash !== b.bodyHash;
  return sig && body ? 'both' : sig ? 'signature' : 'body';
}

/** Records for the global move pass: a change plus its source symbol. */
interface Residual {
  change: SymbolChange;
  sym: SymbolNode;
}

interface Ctx {
  removed: Residual[];
  added: Residual[];
  pruned: Set<SymbolChange>;
}

function pairChange(old: SymbolNode, neu: SymbolNode, ctx: Ctx): SymbolChange {
  const same = old.signatureHash === neu.signatureHash && old.bodyHash === neu.bodyHash;
  const children = matchLevel(old.children, neu.children, ctx);
  const childChanged = children.some((c) => c.hasChanges);
  const change: SymbolChange = {
    id: neu.id,
    kind: neu.kind,
    name: neu.name,
    status: same ? 'unchanged' : 'modified',
    old: refOf(old),
    new: refOf(neu),
    add: 0,
    del: 0,
    hasChanges: !same || childChanged,
    children,
  };
  if (!same) change.detail = modifiedDetail(old, neu);
  return change;
}

function removedChange(s: SymbolNode, ctx: Ctx): SymbolChange {
  const children = s.children.map((c) => removedChange(c, ctx));
  const change: SymbolChange = {
    id: s.id,
    kind: s.kind,
    name: s.name,
    status: 'removed',
    old: refOf(s),
    add: 0,
    del: 0,
    hasChanges: true,
    children,
  };
  ctx.removed.push({ change, sym: s });
  return change;
}

function addedChange(s: SymbolNode, ctx: Ctx): SymbolChange {
  const children = s.children.map((c) => addedChange(c, ctx));
  const change: SymbolChange = {
    id: s.id,
    kind: s.kind,
    name: s.name,
    status: 'added',
    new: refOf(s),
    add: 0,
    del: 0,
    hasChanges: true,
    children,
  };
  ctx.added.push({ change, sym: s });
  return change;
}

function renameChange(old: SymbolNode, neu: SymbolNode, score: number, ctx: Ctx): SymbolChange {
  const children = matchLevel(old.children, neu.children, ctx);
  const change: SymbolChange = {
    id: neu.id,
    kind: neu.kind,
    name: neu.name,
    oldName: old.name,
    status: 'renamed',
    confidence: score,
    old: refOf(old),
    new: refOf(neu),
    add: 0,
    del: 0,
    hasChanges: true,
    children,
  };
  if (old.bodyHash !== neu.bodyHash || old.signatureHash !== neu.signatureHash) {
    change.detail = modifiedDetail(old, neu);
  }
  return change;
}

/** Match a sibling set (children of one matched parent, or the roots). */
function matchLevel(olds: SymbolNode[], news: SymbolNode[], ctx: Ctx): SymbolChange[] {
  const result: SymbolChange[] = [];
  const oldByKey = new Map<string, SymbolNode[]>();
  for (const s of olds) {
    const k = key(s);
    (oldByKey.get(k) ?? oldByKey.set(k, []).get(k)!).push(s);
  }
  const matchedOld = new Set<SymbolNode>();
  const matchedNew = new Set<SymbolNode>();

  // 1. Exact (kind, name) pairing, in order for duplicate keys (overloads).
  const newByKey = new Map<string, SymbolNode[]>();
  for (const s of news) {
    const k = key(s);
    (newByKey.get(k) ?? newByKey.set(k, []).get(k)!).push(s);
  }
  for (const [k, os] of oldByKey) {
    const ns = newByKey.get(k);
    if (!ns) continue;
    const n = Math.min(os.length, ns.length);
    for (let i = 0; i < n; i++) {
      result.push(pairChange(os[i], ns[i], ctx));
      matchedOld.add(os[i]);
      matchedNew.add(ns[i]);
    }
  }

  // 2. Rename detection over residuals of the same kind.
  const oldRem = olds.filter((s) => !matchedOld.has(s));
  const newRem = news.filter((s) => !matchedNew.has(s));
  const candidates: { o: SymbolNode; n: SymbolNode; score: number }[] = [];
  for (const o of oldRem) {
    for (const nn of newRem) {
      if (o.kind !== nn.kind || o.name === nn.name) continue;
      const score = similarity(o, nn);
      if (score >= RENAME_THRESHOLD) candidates.push({ o, n: nn, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  for (const c of candidates) {
    if (matchedOld.has(c.o) || matchedNew.has(c.n)) continue;
    result.push(renameChange(c.o, c.n, c.score, ctx));
    matchedOld.add(c.o);
    matchedNew.add(c.n);
  }

  // 3. Leftovers become removed / added (candidates for the move pass).
  for (const o of olds) if (!matchedOld.has(o)) result.push(removedChange(o, ctx));
  for (const nn of news) if (!matchedNew.has(nn)) result.push(addedChange(nn, ctx));

  sortForDisplay(result);
  return result;
}

/** Reclassify removed+added pairs that are actually the same symbol moved. */
function detectMoves(ctx: Ctx): void {
  for (const r of ctx.removed) {
    if (ctx.pruned.has(r.change)) continue;
    let best: Residual | null = null;
    let bestScore = 0;
    for (const a of ctx.added) {
      if (a.change.status !== 'added') continue;
      if (a.sym.kind !== r.sym.kind || a.sym.name !== r.sym.name) continue;
      const score = similarity(r.sym, a.sym);
      if (score >= MOVE_THRESHOLD && score > bestScore) {
        best = a;
        bestScore = score;
      }
    }
    if (best) {
      best.change.status = 'moved';
      best.change.confidence = bestScore;
      best.change.old = r.change.old;
      if (bestScore < 1) best.change.detail = 'body';
      ctx.pruned.add(r.change); // the "removed" side disappears
    }
  }
}

function sortForDisplay(changes: SymbolChange[]): void {
  changes.sort((a, b) => {
    const ap = a.new?.startLine ?? a.old?.startLine ?? 0;
    const bp = b.new?.startLine ?? b.old?.startLine ?? 0;
    return ap - bp;
  });
}

/** Remove pruned (moved-away) changes from the tree. */
function prune(changes: SymbolChange[], pruned: Set<SymbolChange>): SymbolChange[] {
  return changes
    .filter((c) => !pruned.has(c))
    .map((c) => ({ ...c, children: prune(c.children, pruned) }));
}

/** Match two symbol trees into a change tree. */
export function matchSymbols(
  oldRoots: SymbolNode[],
  newRoots: SymbolNode[],
): SymbolChange[] {
  const ctx: Ctx = { removed: [], added: [], pruned: new Set() };
  const roots = matchLevel(oldRoots, newRoots, ctx);
  detectMoves(ctx);
  return prune(roots, ctx.pruned);
}

/**
 * Build the semantic diff for a file from its extracted symbol trees. Line
 * counts (`add`/`del`) and `fileLevel` are filled later by correlation.
 */
export function semanticDiff(
  oldRoots: SymbolNode[],
  newRoots: SymbolNode[],
): SemanticDiff {
  return {
    roots: matchSymbols(oldRoots, newRoots),
    fileLevel: { add: 0, del: 0 },
    textOnly: false,
  };
}
