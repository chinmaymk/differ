/** Find the nested symbol path (outermost → innermost) whose NEW-side range
 * encloses a given new-file line. Powers the "in Class › method" breadcrumb
 * shown on each hunk header so reviewers always know where they are. */
import type { SymbolChange } from '../engine/model';

export function enclosingSymbols(
  roots: SymbolChange[],
  newLine: number,
): SymbolChange[] {
  const path: SymbolChange[] = [];
  let level = roots;
  // Descend as long as some symbol at this level contains the line.
  for (;;) {
    const hit = level.find(
      (c) => c.new && newLine >= c.new.startLine && newLine <= c.new.endLine,
    );
    if (!hit) break;
    path.push(hit);
    level = hit.children;
  }
  return path;
}
