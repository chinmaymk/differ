/**
 * Story Mode's importance ranking. Pure, main-thread — operates on
 * already-built `FileDiff`s and the (optional) duplicate/blast-radius
 * signals computed by the repo-wide pass (dup-index.ts, duplicates.ts,
 * blast-radius.ts). No tree-sitter, no I/O.
 */
import type {
  FileDiff,
  SymbolChange,
  SymbolKind,
  SymbolStatus,
  ModifiedDetail,
} from './model';

export interface ImportanceReason {
  kind: 'file-status' | 'symbol-change' | 'duplicate' | 'blast-radius' | 'magnitude';
  text: string;
}

export interface DuplicateMatch {
  symbolId: string;
  symbolName: string;
  matchPath: string;
  matchName: string;
  similarity: number;
}

export interface SymbolBlastRadius {
  symbolId: string;
  count: number;
  files: string[];
}

export interface FileImportance {
  score: number;
  reasons: ImportanceReason[];
}

const MAX_REASONS = 3;
const TEST_PATH_RE = /(^|\/)(__tests__)\/|\.(test|spec)\.[^/]+$|(^|\/)[^/]+_test\.[^/]+$/;
const TEST_FILE_DAMPEN = 0.35;

const STATUS_BASE: Record<Exclude<SymbolStatus, 'unchanged'>, number> = {
  added: 3,
  removed: 2,
  modified: 2,
  renamed: 1,
  moved: 1,
};

const DETAIL_MULT: Record<ModifiedDetail, number> = {
  signature: 1.5,
  both: 1.3,
  body: 1.0,
};

const KIND_WEIGHT: Record<SymbolKind, number> = {
  class: 1.1,
  struct: 1.1,
  interface: 1.1,
  trait: 1.1,
  impl: 1.1,
  function: 1.0,
  method: 1.0,
  enum: 1.0,
  type: 1.0,
  module: 1.0,
  other: 0.6,
  field: 0.4,
  constant: 0.4,
  test: 0.2,
};

const FILE_STATUS_WEIGHT: Record<FileDiff['status'], number> = {
  added: 3,
  removed: 2,
  modified: 2,
  renamed: 0.5,
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function magMult(add: number, del: number): number {
  return Math.min(1 + Math.log2(1 + add + del) / 6, 2.0);
}

interface ScoredSymbol {
  change: SymbolChange;
  score: number;
  dup?: DuplicateMatch;
  blast?: SymbolBlastRadius;
}

function walkSymbols(
  roots: SymbolChange[],
  duplicates: Map<string, DuplicateMatch>,
  blastRadii: Map<string, SymbolBlastRadius>,
  out: ScoredSymbol[],
): void {
  for (const change of roots) {
    if (change.status !== 'unchanged') {
      const base = STATUS_BASE[change.status];
      const detailMult = change.detail ? DETAIL_MULT[change.detail] : 1.0;
      const kindWeight = KIND_WEIGHT[change.kind];
      const mm = magMult(change.add, change.del);
      const dup = duplicates.get(change.id);
      const blast = blastRadii.get(change.id);
      const dupBonus = dup ? 2 * clamp((dup.similarity - 0.75) / 0.25, 0, 1) : 0;
      const blastBonus = 2 * clamp((blast?.count ?? 0) / 8, 0, 1);
      const score = base * detailMult * kindWeight * mm + dupBonus + blastBonus;
      out.push({ change, score, dup, blast });
    }
    walkSymbols(change.children, duplicates, blastRadii, out);
  }
}

const KIND_LABEL: Record<SymbolKind, string> = {
  class: 'class',
  struct: 'struct',
  interface: 'interface',
  enum: 'enum',
  type: 'type',
  module: 'module',
  trait: 'trait',
  impl: 'impl',
  constant: 'constant',
  field: 'field',
  test: 'test',
  other: 'symbol',
  function: 'function',
  method: 'method',
};

function displayName(c: SymbolChange): string {
  return c.kind === 'function' || c.kind === 'method' ? `${c.name}()` : c.name;
}

/** Describe what changed about a single symbol, for a story-slide reason. */
function formatSymbolChange(c: SymbolChange): string {
  switch (c.status) {
    case 'added':
      return `new ${KIND_LABEL[c.kind]} \`${c.name}\``;
    case 'removed':
      return `removed ${KIND_LABEL[c.kind]} \`${c.name}\``;
    case 'renamed':
      return `renamed \`${c.oldName}\` → \`${c.name}\``;
    case 'moved':
      return `moved \`${displayName(c)}\``;
    case 'modified':
    default:
      if (c.detail === 'signature') return `signature change to \`${displayName(c)}\``;
      if (c.detail === 'both') return `signature and body change to \`${displayName(c)}\``;
      return `body change to \`${displayName(c)}\``;
  }
}

function fileStatusReason(diff: FileDiff): ImportanceReason {
  let text: string;
  switch (diff.status) {
    case 'added':
      text = 'new file';
      break;
    case 'removed':
      text = 'deleted file';
      break;
    case 'renamed':
      text = diff.oldPath ? `renamed from \`${diff.oldPath}\`` : 'renamed file';
      break;
    default:
      text = 'modified file';
  }
  return { kind: 'file-status', text };
}

/**
 * Score one file's importance for Story Mode ranking. `signals` carries the
 * optional repo-wide duplicate/blast-radius annotations, keyed by the
 * *new-side* `SymbolChange.id` they apply to (or old-side id for removed
 * symbols, since that's the only id a removed symbol has).
 */
export function scoreFile(
  diff: FileDiff,
  signals?: { duplicates?: DuplicateMatch[]; blastRadii?: SymbolBlastRadius[] },
): FileImportance {
  const isTestFile = TEST_PATH_RE.test(diff.path);
  const duplicates = new Map((signals?.duplicates ?? []).map((d) => [d.symbolId, d]));
  const blastRadii = new Map((signals?.blastRadii ?? []).map((b) => [b.symbolId, b]));

  const scored: ScoredSymbol[] = [];
  if (!diff.semantic.textOnly) {
    walkSymbols(diff.semantic.roots, duplicates, blastRadii, scored);
  }

  if (scored.length === 0) {
    let score = FILE_STATUS_WEIGHT[diff.status] + magMult(diff.add, diff.del);
    if (isTestFile) score *= TEST_FILE_DAMPEN;
    return { score, reasons: [fileStatusReason(diff)] };
  }

  const dampened = scored.map((s) => ({
    ...s,
    score: isTestFile ? s.score * TEST_FILE_DAMPEN : s.score,
  }));
  dampened.sort((a, b) => b.score - a.score);
  const top = dampened[0];

  const score = top.score + 0.5 * Math.log2(1 + dampened.length);

  const reasons: ImportanceReason[] = [];
  const seen = new Set<string>();
  const push = (r: ImportanceReason) => {
    if (reasons.length >= MAX_REASONS || seen.has(r.text)) return;
    seen.add(r.text);
    reasons.push(r);
  };

  // Removed-and-still-referenced override: the single highest-alert case.
  const removedReferenced = dampened
    .filter((s) => s.change.status === 'removed' && (s.blast?.count ?? 0) > 0)
    .sort((a, b) => (b.blast?.count ?? 0) - (a.blast?.count ?? 0))[0];
  if (removedReferenced) {
    push({
      kind: 'blast-radius',
      text: `⚠ removed but still referenced in ${removedReferenced.blast!.count} files`,
    });
  }

  push({ kind: 'symbol-change', text: formatSymbolChange(top.change) });

  const dupSymbol = dampened.find((s) => s.dup);
  if (dupSymbol?.dup) {
    const d = dupSymbol.dup;
    push({
      kind: 'duplicate',
      text: `possible duplicate of \`${d.matchName}\` in \`${d.matchPath}\` — ${Math.round(d.similarity * 100)}% similar`,
    });
  }

  const blastSymbol = dampened
    .filter((s) => s !== removedReferenced && (s.blast?.count ?? 0) > 0)
    .sort((a, b) => (b.blast?.count ?? 0) - (a.blast?.count ?? 0))[0];
  if (blastSymbol?.blast) {
    push({
      kind: 'blast-radius',
      text: `\`${displayName(blastSymbol.change)}\` used across ${blastSymbol.blast.count} files in the repo`,
    });
  }

  return { score, reasons };
}
