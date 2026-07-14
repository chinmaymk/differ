/** Small presentation helpers shared across components. */
import type { SymbolKind, SymbolStatus, FileStatus } from '../engine/model';

/** Short glyph for a symbol kind (kept text-only for zero asset weight). */
export function kindGlyph(kind: SymbolKind): string {
  switch (kind) {
    case 'function':
      return 'ƒ';
    case 'method':
      return 'm';
    case 'class':
      return 'C';
    case 'struct':
      return 'S';
    case 'interface':
      return 'I';
    case 'enum':
      return 'E';
    case 'trait':
      return 'T';
    case 'impl':
      return '⊕';
    case 'type':
      return 't';
    case 'module':
      return 'M';
    case 'constant':
      return 'κ';
    case 'field':
      return '·';
    default:
      return '•';
  }
}

export function statusLabel(status: SymbolStatus): string {
  return status[0].toUpperCase() + status.slice(1);
}

/** CSS color var for a status. */
export function statusColor(status: SymbolStatus | FileStatus): string {
  switch (status) {
    case 'added':
      return 'var(--add-fg)';
    case 'removed':
      return 'var(--del-fg)';
    case 'renamed':
    case 'moved':
      return 'var(--move-fg)';
    case 'modified':
      return 'var(--mod-fg)';
    default:
      return 'var(--fg-muted)';
  }
}

export function fileStatusGlyph(status: FileStatus): string {
  switch (status) {
    case 'added':
      return 'A';
    case 'removed':
      return 'D';
    case 'renamed':
      return 'R';
    default:
      return 'M';
  }
}

/** Split a path into directory + filename for two-tone rendering. */
export function splitPath(path: string): { dir: string; name: string } {
  const i = path.lastIndexOf('/');
  return i === -1
    ? { dir: '', name: path }
    : { dir: path.slice(0, i + 1), name: path.slice(i + 1) };
}
