/**
 * Orchestrator: turn a source-provided `DiffEntry` (old/new bytes) into a
 * complete `FileDiff` — text diff, semantic diff, and correlation. This is the
 * single entry point the worker calls per file.
 */
import type { DiffEntry, FileDiff, SemanticDiff, TextDiff, Token } from './model';
import { diffLines } from './text-diff';
import { detectLang, hasSemantics } from './languages';
import { analyzeSource } from './analyze';
import { semanticDiff } from './semantic-diff';
import { correlate } from './correlate';
import { imageMime, toDataUrl } from './media';

const decoder = new TextDecoder('utf-8', { fatal: false });

/** Heuristic binary check: a NUL byte in the first 8KB. */
function isBinary(bytes: Uint8Array | null): boolean {
  if (!bytes) return false;
  const n = Math.min(bytes.length, 8192);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

function decode(bytes: Uint8Array | null): string {
  return bytes ? decoder.decode(bytes) : '';
}

function textOnly(reason: SemanticDiff['reason']): SemanticDiff {
  return { roots: [], fileLevel: { add: 0, del: 0 }, textOnly: true, reason };
}

/**
 * Attach per-line syntax tokens to the diff lines. Added lines read the new
 * side; deleted lines the old side; context lines are identical so either
 * works (we use the new side).
 */
function applyTokens(text: TextDiff, oldTokens: Token[][], newTokens: Token[][]): void {
  for (const hunk of text.hunks) {
    for (const line of hunk.lines) {
      if (line.op === 'del' && line.oldLine !== null) {
        line.tokens = oldTokens[line.oldLine - 1];
      } else if (line.newLine !== null) {
        line.tokens = newTokens[line.newLine - 1];
      } else if (line.oldLine !== null) {
        line.tokens = oldTokens[line.oldLine - 1];
      }
    }
  }
}

/** Build the full diff model for one file. */
export async function buildFileDiff(entry: DiffEntry): Promise<FileDiff> {
  const lang = detectLang(entry.path);

  // Image files: present a visual before/after instead of a text diff.
  const mime = imageMime(entry.path);
  if (mime && (entry.oldBytes || entry.newBytes)) {
    return {
      path: entry.path,
      oldPath: entry.oldPath,
      status: entry.status,
      lang,
      binary: true,
      image: {
        old: entry.oldBytes ? toDataUrl(entry.oldBytes, mime) : null,
        new: entry.newBytes ? toDataUrl(entry.newBytes, mime) : null,
        mime,
      },
      text: { hunks: [], add: 0, del: 0, truncated: false },
      semantic: textOnly('unsupported'),
      add: 0,
      del: 0,
    };
  }

  const binary = isBinary(entry.oldBytes) || isBinary(entry.newBytes);

  if (binary) {
    return {
      path: entry.path,
      oldPath: entry.oldPath,
      status: entry.status,
      lang,
      binary: true,
      text: { hunks: [], add: 0, del: 0, truncated: false },
      semantic: textOnly('unsupported'),
      add: 0,
      del: 0,
    };
  }

  const oldText = decode(entry.oldBytes);
  const newText = decode(entry.newBytes);
  const text = diffLines(oldText, newText);

  let semantic: SemanticDiff;
  if (text.truncated) {
    semantic = textOnly('too-large');
  } else if (!lang) {
    // No grammar at all → plain text diff, no highlighting or semantics.
    semantic = textOnly('unsupported');
  } else {
    try {
      // One parse per side yields both symbols and syntax tokens.
      const [oldA, newA] = await Promise.all([
        analyzeSource(lang, oldText),
        analyzeSource(lang, newText),
      ]);
      applyTokens(text, oldA.tokens, newA.tokens);
      if (hasSemantics(lang)) {
        semantic = semanticDiff(oldA.symbols, newA.symbols);
        correlate(text, semantic);
      } else {
        // Grammar exists (highlighting works) but no symbol query.
        semantic = textOnly('unsupported');
      }
    } catch {
      semantic = textOnly('parse-error');
    }
  }

  return {
    path: entry.path,
    oldPath: entry.oldPath,
    status: entry.status,
    lang,
    binary: false,
    text,
    semantic,
    add: text.add,
    del: text.del,
  };
}
