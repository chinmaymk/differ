/**
 * Local-git diff source, backed by the Rust/libgit2 Tauri commands.
 *
 * Metadata is fetched eagerly (`listChanges`); file content is fetched lazily
 * (`readEntry`) so a large changeset only pays for files the user opens.
 */
import { invoke } from '@tauri-apps/api/core';

import type {
  ChangedFile,
  CommitInfo,
  DiffEntry,
  DiffSource,
  HunkMode,
  HunkPatch,
  Revision,
} from '../engine/model';

/** Shape returned by the Rust `read_file` command. */
interface FileContent {
  /** Base64 content, or null when the file is absent on this side or binary. */
  bytes: string | null;
  binary: boolean;
}

/** Decode a base64 string into raw bytes. */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export class TauriGitSource implements DiffSource {
  constructor(private readonly repoPath: string) {}

  label(): string {
    return this.repoPath;
  }

  listChanges(base: Revision, head: Revision): Promise<ChangedFile[]> {
    return invoke<ChangedFile[]>('list_changes', {
      repoPath: this.repoPath,
      base,
      head,
    });
  }

  listCommits(limit: number): Promise<CommitInfo[]> {
    return invoke<CommitInfo[]>('list_commits', {
      repoPath: this.repoPath,
      limit,
    });
  }

  async readEntry(
    base: Revision,
    head: Revision,
    file: ChangedFile,
  ): Promise<DiffEntry> {
    // Renames read the old side from the previous path.
    const oldPath = file.oldPath ?? file.path;

    const [oldContent, newContent] = await Promise.all([
      invoke<FileContent>('read_file', {
        repoPath: this.repoPath,
        rev: base,
        path: oldPath,
      }),
      invoke<FileContent>('read_file', {
        repoPath: this.repoPath,
        rev: head,
        path: file.path,
      }),
    ]);

    return {
      ...file,
      oldBytes: oldContent.bytes != null ? base64ToBytes(oldContent.bytes) : null,
      newBytes: newContent.bytes != null ? base64ToBytes(newContent.bytes) : null,
    };
  }

  stagePaths(paths: string[]): Promise<void> {
    return invoke('stage_paths', { repoPath: this.repoPath, paths });
  }

  unstagePaths(paths: string[]): Promise<void> {
    return invoke('unstage_paths', { repoPath: this.repoPath, paths });
  }

  discardPaths(paths: string[]): Promise<void> {
    return invoke('discard_paths', { repoPath: this.repoPath, paths });
  }

  applyHunk(path: string, hunk: HunkPatch, mode: HunkMode): Promise<void> {
    return invoke('apply_hunk', { repoPath: this.repoPath, path, hunk, mode });
  }

  commit(message: string): Promise<CommitInfo> {
    return invoke<CommitInfo>('commit', { repoPath: this.repoPath, message });
  }

  push(): Promise<string> {
    return invoke<string>('push', { repoPath: this.repoPath });
  }
}
