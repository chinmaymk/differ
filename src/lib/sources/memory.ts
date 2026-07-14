/**
 * In-memory diff source: compares provided old/new text blobs. Used for the
 * demo/sample mode and for pasted before/after content — the same engine
 * pipeline runs regardless of origin. Also handy in a plain browser with no
 * Tauri backend.
 */
import type {
  ChangedFile,
  DiffEntry,
  DiffSource,
  Revision,
} from '../engine/model';

export interface MemoryFile {
  path: string;
  oldText?: string | null;
  newText?: string | null;
  /** Raw bytes override (e.g. for images); take precedence over text. */
  oldBytes?: Uint8Array | null;
  newBytes?: Uint8Array | null;
}

const enc = new TextEncoder();

function sideBytes(
  bytes: Uint8Array | null | undefined,
  text: string | null | undefined,
): Uint8Array | null {
  if (bytes !== undefined) return bytes;
  return text == null ? null : enc.encode(text);
}

export class MemorySource implements DiffSource {
  constructor(
    private name: string,
    private files: MemoryFile[],
  ) {}

  label(): string {
    return this.name;
  }

  private hasOld(f: MemoryFile): boolean {
    return f.oldBytes != null || f.oldText != null;
  }
  private hasNew(f: MemoryFile): boolean {
    return f.newBytes != null || f.newText != null;
  }

  async listChanges(_base: Revision, _head: Revision): Promise<ChangedFile[]> {
    return this.files.map((f) => ({
      path: f.path,
      status: !this.hasOld(f) ? 'added' : !this.hasNew(f) ? 'removed' : 'modified',
    }));
  }

  async readEntry(
    _base: Revision,
    _head: Revision,
    file: ChangedFile,
  ): Promise<DiffEntry> {
    const f = this.files.find((x) => x.path === file.path);
    if (!f) throw new Error(`Unknown file: ${file.path}`);
    return {
      ...file,
      oldBytes: sideBytes(f.oldBytes, f.oldText),
      newBytes: sideBytes(f.newBytes, f.newText),
    };
  }
}
