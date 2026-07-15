/** Builds a directory tree from a flat list of changed files. */
import type { ChangedFile } from '../engine/model';

export interface TreeFile {
  type: 'file';
  name: string;
  path: string;
  file: ChangedFile;
}

export interface TreeDir {
  type: 'dir';
  name: string;
  /** Full path of this directory (for stable expand/collapse keys). */
  path: string;
  children: TreeNode[];
}

export type TreeNode = TreeDir | TreeFile;

function newDir(name: string, path: string): TreeDir {
  return { type: 'dir', name, path, children: [] };
}

/**
 * Build a nested tree from file paths. Directory chains with a single child
 * directory are compacted (`a/b/c` → one row) like VS Code, which makes deep
 * layouts far easier to scan.
 */
export function buildFileTree(files: ChangedFile[]): TreeNode[] {
  const root = newDir('', '');

  for (const file of files) {
    const parts = file.path.split('/');
    const fileName = parts.pop()!;
    let dir = root;
    let prefix = '';
    for (const part of parts) {
      prefix = prefix ? `${prefix}/${part}` : part;
      let next = dir.children.find(
        (c): c is TreeDir => c.type === 'dir' && c.name === part,
      );
      if (!next) {
        next = newDir(part, prefix);
        dir.children.push(next);
      }
      dir = next;
    }
    dir.children.push({ type: 'file', name: fileName, path: file.path, file });
  }

  sortDir(root);
  compact(root);
  return root.children;
}

/** Directories first, then files; each alphabetical. */
function sortDir(dir: TreeDir): void {
  dir.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const c of dir.children) if (c.type === 'dir') sortDir(c);
}

/** All file paths under a node (itself, if a file; every descendant file, if a dir). */
export function collectPaths(node: TreeNode): string[] {
  if (node.type === 'file') return [node.path];
  return node.children.flatMap(collectPaths);
}

/** Merge single-child directory chains: dir with one dir child → combined. */
function compact(dir: TreeDir): void {
  for (const child of dir.children) {
    if (child.type === 'dir') compact(child);
  }
  dir.children = dir.children.map((child) => {
    let node = child;
    while (
      node.type === 'dir' &&
      node.children.length === 1 &&
      node.children[0].type === 'dir'
    ) {
      const only = node.children[0] as TreeDir;
      node = { ...only, name: `${node.name}/${only.name}` };
    }
    return node;
  });
}
