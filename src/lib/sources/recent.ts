/** Persists recently opened repositories for quick re-access. */

export interface RecentRepo {
  path: string;
  name: string;
  /** Unix ms of last open. */
  lastOpened: number;
}

const KEY = 'dv-recent-repos';
const MAX = 12;

function basename(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, '');
  const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return trimmed.slice(i + 1) || trimmed;
}

export function getRecentRepos(): RecentRepo[] {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** Record a repo as most-recently opened (deduped, capped). */
export function addRecentRepo(path: string): void {
  const list = getRecentRepos().filter((r) => r.path !== path);
  list.unshift({ path, name: basename(path), lastOpened: Date.now() });
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
}

export function removeRecentRepo(path: string): void {
  localStorage.setItem(
    KEY,
    JSON.stringify(getRecentRepos().filter((r) => r.path !== path)),
  );
}
