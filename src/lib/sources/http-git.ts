/**
 * Headless-server diff source, backed by the `crates/server` HTTP API — the
 * same git-core logic as `TauriGitSource`, over `fetch` instead of Tauri IPC,
 * for use in a plain browser talking to a shared server rather than the
 * desktop shell. See `crates/server/src/lib.rs` for the route list.
 */
import type {
  BranchInfo,
  ChangedFile,
  CommitInfo,
  DiffEntry,
  DiffSource,
  HunkMode,
  HunkPatch,
  Revision,
  TagInfo,
  WorktreeInfo,
} from '../engine/model';
import { base64ToBytes } from './base64';

/** Shape returned by the server's `/api/file`. */
interface FileContent {
  bytes: string | null;
  binary: boolean;
}

interface ErrorBody {
  error: string;
}

export class HttpGitSource implements DiffSource {
  constructor(private readonly apiBase: string) {}

  label(): string {
    return this.apiBase;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.apiBase}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ErrorBody | null;
      throw new Error(body?.error ?? `${path} failed with status ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  private post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  listChanges(base: Revision, head: Revision): Promise<ChangedFile[]> {
    return this.post<ChangedFile[]>('/api/changes', { base, head });
  }

  listCommits(limit: number): Promise<CommitInfo[]> {
    return this.get<CommitInfo[]>(`/api/commits?limit=${limit}`);
  }

  listBranches(): Promise<BranchInfo[]> {
    return this.get<BranchInfo[]>('/api/branches');
  }

  listTags(): Promise<TagInfo[]> {
    return this.get<TagInfo[]>('/api/tags');
  }

  listWorktrees(): Promise<WorktreeInfo[]> {
    return this.get<WorktreeInfo[]>('/api/worktrees');
  }

  async readEntry(
    base: Revision,
    head: Revision,
    file: ChangedFile,
  ): Promise<DiffEntry> {
    // Renames read the old side from the previous path.
    const oldPath = file.oldPath ?? file.path;

    const [oldContent, newContent] = await Promise.all([
      this.post<FileContent>('/api/file', { rev: base, path: oldPath }),
      this.post<FileContent>('/api/file', { rev: head, path: file.path }),
    ]);

    return {
      ...file,
      oldBytes: oldContent.bytes != null ? base64ToBytes(oldContent.bytes) : null,
      newBytes: newContent.bytes != null ? base64ToBytes(newContent.bytes) : null,
    };
  }

  listAllFiles(rev: Revision): Promise<string[]> {
    return this.post<string[]>('/api/all-files', { rev });
  }

  async readFileAt(rev: Revision, path: string): Promise<Uint8Array | null> {
    const content = await this.post<FileContent>('/api/file', { rev, path });
    return content.bytes != null ? base64ToBytes(content.bytes) : null;
  }

  stagePaths(paths: string[]): Promise<void> {
    return this.post('/api/stage', { paths });
  }

  unstagePaths(paths: string[]): Promise<void> {
    return this.post('/api/unstage', { paths });
  }

  discardPaths(paths: string[]): Promise<void> {
    return this.post('/api/discard', { paths });
  }

  applyHunk(path: string, hunk: HunkPatch, mode: HunkMode): Promise<void> {
    return this.post('/api/hunk', { path, hunk, mode });
  }

  commit(message: string): Promise<CommitInfo> {
    return this.post<CommitInfo>('/api/commit', { message });
  }

  push(): Promise<string> {
    return this.post<string>('/api/push');
  }

  pull(): Promise<string> {
    return this.post<string>('/api/pull');
  }

  revertCommit(sha: string): Promise<CommitInfo> {
    return this.post<CommitInfo>('/api/revert', { sha });
  }
}
