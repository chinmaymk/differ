/**
 * Shared data model for the diff engine.
 *
 * This is the contract every engine module builds against. It is pure data
 * (no DOM, no tree-sitter handles) so it serializes cleanly across the
 * worker boundary and is trivial to unit-test.
 *
 * Coordinate conventions:
 *  - Line numbers are 1-based and inclusive.
 *  - Byte offsets are 0-based, [start, end) half-open.
 *  - A symbol/hunk that exists on only one side has `null` for the other side.
 */

// ---------------------------------------------------------------------------
// Text diff
// ---------------------------------------------------------------------------

/** The role of a single line in a unified diff. */
export type LineOp = 'context' | 'add' | 'del';

/** A contiguous run within a line, used for word/char-level highlighting. */
export interface InlineSpan {
  /** Char offset into the line text, 0-based. */
  start: number;
  /** Char offset, exclusive. */
  end: number;
  kind: 'same' | 'add' | 'del';
}

/** Syntax token categories (a small, readable subset from the parse tree). */
export type TokenClass =
  | 'keyword'
  | 'string'
  | 'number'
  | 'comment'
  | 'type'
  | 'constant'
  | 'function'
  | 'property';

/** A syntax-highlighted span within a single line (char offsets). */
export interface Token {
  start: number;
  end: number;
  cls: TokenClass;
}

/** One rendered line of a diff (unified view). */
export interface DiffLine {
  op: LineOp;
  /** 1-based line number in the old file, or null for an added line. */
  oldLine: number | null;
  /** 1-based line number in the new file, or null for a deleted line. */
  newLine: number | null;
  text: string;
  /**
   * Word/char-level spans, computed lazily on demand for changed lines.
   * Undefined = not yet computed. Present only for add/del lines that were
   * refined against their counterpart.
   */
  inline?: InlineSpan[];
  /** Syntax tokens for this line (from the parse tree), if available. */
  tokens?: Token[];
}

/** A contiguous block of change with surrounding context. */
export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

/** The line-level diff of a single file. */
export interface TextDiff {
  hunks: Hunk[];
  /** Total added / deleted line counts. */
  add: number;
  del: number;
  /**
   * True when the file exceeded size thresholds and only a coarse (or no)
   * diff was produced. The UI shows a "large file" affordance.
   */
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Semantic diff
// ---------------------------------------------------------------------------

/** Normalized, language-agnostic symbol categories the UI and matcher speak. */
export type SymbolKind =
  | 'function'
  | 'method'
  | 'class'
  | 'struct'
  | 'interface'
  | 'enum'
  | 'type'
  | 'module'
  | 'trait'
  | 'impl'
  | 'constant'
  | 'field'
  | 'test'
  | 'other';

/**
 * A named declaration extracted from one side of a file. This is the light
 * "symbol tree" — a projection of the full CST keeping only what we render.
 */
export interface SymbolNode {
  /** Stable id within one extraction (path-like, e.g. "0.2.1"). */
  id: string;
  kind: SymbolKind;
  name: string;
  startLine: number;
  endLine: number;
  startByte: number;
  endByte: number;
  /** Hash of the declaration header (name + params + return), raw bytes. */
  signatureHash: string;
  /** Hash of the body bytes (raw, so it agrees with the text diff). */
  bodyHash: string;
  /**
   * Sorted, de-duplicated 32-bit hashes of the symbol's non-blank body lines.
   * A cheap fingerprint for Dice-similarity when detecting renames/moves whose
   * body also changed (so `bodyHash` no longer matches).
   */
  fingerprint: number[];
  children: SymbolNode[];
}

/** How a symbol changed between old and new. */
export type SymbolStatus =
  | 'unchanged'
  | 'added'
  | 'removed'
  | 'modified'
  | 'renamed'
  | 'moved';

/** Which part of a modified symbol changed. */
export type ModifiedDetail = 'signature' | 'body' | 'both';

/** A lightweight reference to a symbol's location on one side. */
export interface SymbolRef {
  startLine: number;
  endLine: number;
  startByte: number;
  endByte: number;
}

/**
 * A node in the semantic-change tree. Mirrors the structure of the code:
 * a changed class contains changed methods, etc.
 */
export interface SymbolChange {
  id: string;
  kind: SymbolKind;
  /** Current name (new side), or old name when removed. */
  name: string;
  status: SymbolStatus;
  /** Present for renamed symbols: the previous name. */
  oldName?: string;
  /** Present for modified symbols: what changed. */
  detail?: ModifiedDetail;
  /** 0..1 confidence for heuristic classifications (rename/move). */
  confidence?: number;
  /** Location on the old side (absent for added symbols). */
  old?: SymbolRef;
  /** Location on the new side (absent for removed symbols). */
  new?: SymbolRef;
  /** Rolled-up changed-line counts under this symbol (inclusive of children). */
  add: number;
  del: number;
  /** True if this symbol or any descendant has line changes. */
  hasChanges: boolean;
  children: SymbolChange[];
}

/** The semantic diff of a single file. */
export interface SemanticDiff {
  /** Top-level symbol changes (tree). */
  roots: SymbolChange[];
  /**
   * Changes to lines that fall outside any symbol (imports, top-level
   * statements, comments). `add`/`del` summarize them.
   */
  fileLevel: { add: number; del: number };
  /**
   * True when semantics were skipped (unsupported language, large file,
   * parse failure) and only the text diff is available.
   */
  textOnly: boolean;
  /** Reason for text-only mode, for UI messaging. */
  reason?: 'unsupported' | 'too-large' | 'parse-error';
}

// ---------------------------------------------------------------------------
// File-level model
// ---------------------------------------------------------------------------

export type FileStatus = 'added' | 'removed' | 'modified' | 'renamed';

/** Old/new image data URLs for an image file, for visual comparison. */
export interface ImageDiff {
  /** Data URL of the old image, or null when added. */
  old: string | null;
  /** Data URL of the new image, or null when removed. */
  new: string | null;
  mime: string;
}

/** The complete diff model for one file — the unit the UI renders. */
export interface FileDiff {
  /** New-side path (or old-side path for a deletion). */
  path: string;
  /** Old-side path when different (renames). */
  oldPath?: string;
  status: FileStatus;
  /** Detected language id (see languages.ts), or null if unknown/binary. */
  lang: string | null;
  /** True for binary files — no textual diff is shown. */
  binary: boolean;
  /** Present for image files — old/new data URLs for visual comparison. */
  image?: ImageDiff;
  text: TextDiff;
  semantic: SemanticDiff;
  add: number;
  del: number;
}

// ---------------------------------------------------------------------------
// Diff source (where file bytes come from)
// ---------------------------------------------------------------------------

/** Lightweight metadata for one changed file (no content). */
export interface ChangedFile {
  /** New-side path (or old-side path for a deletion). */
  path: string;
  /** Old-side path when different (renames). */
  oldPath?: string;
  status: FileStatus;
}

/** A pair of file contents to diff, plus identity/metadata. */
export interface DiffEntry extends ChangedFile {
  /** Old content bytes; null when the file was added. */
  oldBytes: Uint8Array | null;
  /** New content bytes; null when the file was removed. */
  newBytes: Uint8Array | null;
}

/** A named revision to compare (a ref, the working tree/index, or an empty
 * baseline for a root commit). */
export interface Revision {
  kind: 'ref' | 'worktree' | 'index' | 'empty';
  /** For kind 'ref': a commit-ish (sha, branch, tag, "HEAD"). */
  ref?: string;
}

/** A commit in the repository history. */
export interface CommitInfo {
  sha: string;
  shortSha: string;
  summary: string;
  author: string;
  /** Author time, Unix seconds. */
  timestamp: number;
  /** First-parent sha, or null for a root commit. */
  parent: string | null;
}

/**
 * A single hunk's exact content, sent verbatim to the backend for staging.
 * Deliberately the same shape as `Hunk` (minus render-only fields) so the
 * boundary a user clicked "stage"/"discard" on is always the boundary that
 * gets applied — the backend never recomputes its own diff to find it.
 */
export interface HunkPatch {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: { op: LineOp; text: string }[];
}

/** What to do with a hunk sent via `DiffSource.applyHunk`. */
export type HunkMode = 'stage' | 'unstage' | 'discard';

/**
 * Source-agnostic provider of diff entries. Implementations: TauriGitSource
 * (local git via Rust), and later browser/GitHub providers. The engine only
 * ever sees `DiffEntry` triples and never knows the origin.
 *
 * Content is fetched lazily (`readEntry`) so a large changeset only pays for
 * files the user actually opens.
 */
export interface DiffSource {
  /** Human-readable label (e.g. repo path or PR title). */
  label(): string;
  /** List changed files between two revisions (metadata only). */
  listChanges(base: Revision, head: Revision): Promise<ChangedFile[]>;
  /** Fetch the old/new bytes for a single changed file. */
  readEntry(
    base: Revision,
    head: Revision,
    file: ChangedFile,
  ): Promise<DiffEntry>;
  /** List recent commits, if the source is backed by history (git). */
  listCommits?(limit: number): Promise<CommitInfo[]>;

  // -- Write operations, present only for sources backed by a real local
  // repo (desktop). Absent entirely for read-only sources (demo/paste
  // mode) — callers gate UI on these being defined, same as `listCommits`.

  /** Stage a batch of paths (files or, from a directory action, all files
   * beneath it). A path missing from the working directory is staged as a
   * deletion. */
  stagePaths?(paths: string[]): Promise<void>;
  /** Unstage a batch of paths, resetting their index entries to HEAD. */
  unstagePaths?(paths: string[]): Promise<void>;
  /** Discard uncommitted working-tree changes for a batch of paths. A path
   * with no index entry (never staged) is deleted outright. */
  discardPaths?(paths: string[]): Promise<void>;
  /** Stage, unstage, or discard exactly one hunk of one file. */
  applyHunk?(path: string, hunk: HunkPatch, mode: HunkMode): Promise<void>;
  /** Commit the current index as a new commit on HEAD. */
  commit?(message: string): Promise<CommitInfo>;
  /** Push the current branch. Resolves with a status message. */
  push?(): Promise<string>;
}
