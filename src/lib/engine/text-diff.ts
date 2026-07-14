/**
 * Text (line/word/char) diff engine.
 *
 * Strategy (all in TS, per the plan — keeps us single-wasm):
 *   1. Line diff always: intern each line to an int id, run Myers on the id
 *      arrays (cheap), reconstruct a unified line sequence, group into hunks
 *      with surrounding context.
 *   2. Word/char refinement lazily: `refineHunk` fills per-line `inline`
 *      spans on demand for the changed lines the UI actually renders.
 *
 * Large inputs bail out to `truncated` so the worker never blocks.
 */
import { diff } from 'fast-myers-diff';
import type { DiffLine, Hunk, InlineSpan, TextDiff } from './model';

/** Lines of context to keep around each change in a hunk. */
const CONTEXT = 3;

export interface TextDiffOptions {
  context?: number;
  /** Skip fine diffing above this many bytes on either side. */
  maxBytes?: number;
  /** Skip fine diffing above this many lines on either side. */
  maxLines?: number;
}

const DEFAULTS = { maxBytes: 2_000_000, maxLines: 50_000 };

/**
 * Split text into logical lines (newline terminators removed). A trailing
 * newline does not produce a spurious empty final line.
 */
export function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split('\n');
  // "a\nb\n".split('\n') === ['a','b',''] — drop the terminator artifact.
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Map each distinct string to a small int id for fast Myers comparison. */
function internLines(a: string[], b: string[]): [number[], number[]] {
  const ids = new Map<string, number>();
  const map = (lines: string[]) =>
    lines.map((l) => {
      let id = ids.get(l);
      if (id === undefined) {
        id = ids.size;
        ids.set(l, id);
      }
      return id;
    });
  return [map(a), map(b)];
}

/**
 * Compute the line-level diff of two texts. Produces hunks with context; word
 * refinement is deferred to `refineHunk`.
 */
export function diffLines(
  oldText: string,
  newText: string,
  opts: TextDiffOptions = {},
): TextDiff {
  const context = opts.context ?? CONTEXT;
  const maxBytes = opts.maxBytes ?? DEFAULTS.maxBytes;
  const maxLines = opts.maxLines ?? DEFAULTS.maxLines;

  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  const tooLarge =
    oldText.length > maxBytes ||
    newText.length > maxBytes ||
    oldLines.length > maxLines ||
    newLines.length > maxLines;

  if (tooLarge) {
    return {
      hunks: [],
      add: newLines.length,
      del: oldLines.length,
      truncated: true,
    };
  }

  const [oldIds, newIds] = internLines(oldLines, newLines);

  // Reconstruct the full unified line sequence from Myers edit tuples.
  const all: DiffLine[] = [];
  let add = 0;
  let del = 0;
  let oi = 0;
  let ni = 0;

  const emitContext = (count: number) => {
    for (let k = 0; k < count; k++) {
      all.push({
        op: 'context',
        oldLine: oi + 1,
        newLine: ni + 1,
        text: oldLines[oi],
      });
      oi++;
      ni++;
    }
  };

  for (const [xs, xe, , ye] of diff(oldIds, newIds)) {
    // Equal region preceding this edit (old[oi..xs] aligns with new[ni..ys]);
    // emitContext advances ni in lockstep so we don't need ys explicitly.
    emitContext(xs - oi);
    // Deletions.
    while (oi < xe) {
      all.push({ op: 'del', oldLine: oi + 1, newLine: null, text: oldLines[oi] });
      oi++;
      del++;
    }
    // Insertions.
    while (ni < ye) {
      all.push({ op: 'add', oldLine: null, newLine: ni + 1, text: newLines[ni] });
      ni++;
      add++;
    }
  }
  // Trailing equal region.
  emitContext(oldLines.length - oi);

  const hunks = groupHunks(all, context);
  return { hunks, add, del, truncated: false };
}

/**
 * Group a full unified line sequence into hunks: keep `context` lines around
 * every change; runs of kept lines that touch become a single hunk (this
 * naturally merges nearby changes).
 */
function groupHunks(all: DiffLine[], context: number): Hunk[] {
  const n = all.length;
  if (n === 0) return [];

  const keep = new Array<boolean>(n).fill(false);
  let anyChange = false;
  for (let i = 0; i < n; i++) {
    if (all[i].op !== 'context') {
      anyChange = true;
      const lo = Math.max(0, i - context);
      const hi = Math.min(n - 1, i + context);
      for (let j = lo; j <= hi; j++) keep[j] = true;
    }
  }
  if (!anyChange) return [];

  const hunks: Hunk[] = [];
  let i = 0;
  while (i < n) {
    if (!keep[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && keep[j]) j++;
    const lines = all.slice(i, j);
    hunks.push(makeHunk(lines));
    i = j;
  }
  return hunks;
}

/** Build a hunk (with a best-effort @@ header) from its line slice. */
function makeHunk(lines: DiffLine[]): Hunk {
  let oldStart = 0;
  let newStart = 0;
  let oldLines = 0;
  let newLines = 0;
  for (const l of lines) {
    if (l.oldLine !== null) {
      if (oldStart === 0) oldStart = l.oldLine;
      oldLines++;
    }
    if (l.newLine !== null) {
      if (newStart === 0) newStart = l.newLine;
      newLines++;
    }
  }
  return {
    oldStart: oldStart || 1,
    oldLines,
    newStart: newStart || 1,
    newLines,
    lines,
  };
}

// ---------------------------------------------------------------------------
// Word/char refinement (lazy)
// ---------------------------------------------------------------------------

interface Token {
  text: string;
  start: number;
  end: number;
}

/** Tokenize a line into words, whitespace runs, and single symbol chars. */
function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  const re = /(\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

function internTokens(a: Token[], b: Token[]): [number[], number[]] {
  const ids = new Map<string, number>();
  const map = (toks: Token[]) =>
    toks.map((t) => {
      let id = ids.get(t.text);
      if (id === undefined) {
        id = ids.size;
        ids.set(t.text, id);
      }
      return id;
    });
  return [map(a), map(b)];
}

/** Coalesce adjacent spans of the same kind. */
function coalesce(spans: InlineSpan[]): InlineSpan[] {
  const out: InlineSpan[] = [];
  for (const s of spans) {
    if (s.start === s.end) continue;
    const last = out[out.length - 1];
    if (last && last.kind === s.kind && last.end === s.start) {
      last.end = s.end;
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

/**
 * Word-level diff of a deleted line against its paired added line. Returns the
 * inline spans for each side (kind 'same' | 'del' for old, 'same' | 'add' for
 * new). Used to highlight exactly what changed within a modified line.
 */
export function inlineSpans(
  oldLine: string,
  newLine: string,
): { del: InlineSpan[]; add: InlineSpan[] } {
  const oldToks = tokenize(oldLine);
  const newToks = tokenize(newLine);
  const [oldIds, newIds] = internTokens(oldToks, newToks);

  const delSpans: InlineSpan[] = [];
  const addSpans: InlineSpan[] = [];
  let oi = 0;
  let ni = 0;

  const pushSame = (count: number) => {
    for (let k = 0; k < count; k++) {
      delSpans.push({ start: oldToks[oi].start, end: oldToks[oi].end, kind: 'same' });
      addSpans.push({ start: newToks[ni].start, end: newToks[ni].end, kind: 'same' });
      oi++;
      ni++;
    }
  };

  for (const [xs, xe, , ye] of diff(oldIds, newIds)) {
    pushSame(xs - oi);
    while (oi < xe) {
      delSpans.push({ start: oldToks[oi].start, end: oldToks[oi].end, kind: 'del' });
      oi++;
    }
    while (ni < ye) {
      addSpans.push({ start: newToks[ni].start, end: newToks[ni].end, kind: 'add' });
      ni++;
    }
  }
  pushSame(oldToks.length - oi);

  return { del: coalesce(delSpans), add: coalesce(addSpans) };
}

/**
 * Pair each run of deleted lines with the following run of added lines (by
 * index — the common heuristic) and word-diff the pairs. Returns a map from
 * `DiffLine` to its inline spans WITHOUT mutating the model, so it is safe to
 * call from reactive/derived contexts. Cheap enough to run per visible hunk.
 */
export function computeHunkInline(hunk: Hunk): Map<DiffLine, InlineSpan[]> {
  const out = new Map<DiffLine, InlineSpan[]>();
  const lines = hunk.lines;
  let i = 0;
  while (i < lines.length) {
    if (lines[i].op !== 'del') {
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    while (i < lines.length && lines[i].op === 'del') dels.push(lines[i++]);
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i].op === 'add') adds.push(lines[i++]);
    const pairs = Math.min(dels.length, adds.length);
    for (let k = 0; k < pairs; k++) {
      const { del, add } = inlineSpans(dels[k].text, adds[k].text);
      out.set(dels[k], del);
      out.set(adds[k], add);
    }
  }
  return out;
}

/**
 * Fill `inline` spans on the changed lines of a hunk, in place. Convenience for
 * non-reactive contexts (e.g. computing the model in the worker). Idempotent.
 */
export function refineHunk(hunk: Hunk): void {
  const inline = computeHunkInline(hunk);
  for (const [line, spans] of inline) line.inline = spans;
}
