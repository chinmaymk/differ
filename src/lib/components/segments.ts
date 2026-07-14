/** Shared line rendering: merge syntax tokens (fg) with word-level change
 * spans (bg) into flat styled segments. Used by both unified and split views. */
import type { DiffLine, InlineSpan } from '../engine/model';

export interface Seg {
  text: string;
  cls: string;
}

export function lineSegments(line: DiffLine, inline?: InlineSpan[]): Seg[] {
  const text = line.text;
  const n = text.length;
  if (n === 0) return [];
  const tokens = line.tokens;
  if ((!tokens || tokens.length === 0) && !inline) {
    return [{ text, cls: '' }];
  }

  const bounds = new Set<number>([0, n]);
  if (tokens) for (const t of tokens) { bounds.add(t.start); bounds.add(t.end); }
  if (inline) for (const s of inline) { bounds.add(s.start); bounds.add(s.end); }
  const points = [...bounds].filter((p) => p >= 0 && p <= n).sort((a, b) => a - b);

  const segs: Seg[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a >= b) continue;
    const tok = tokens?.find((t) => t.start <= a && t.end > a);
    const chg = inline?.find((s) => s.start <= a && s.end > a && s.kind !== 'same');
    let cls = tok ? `tok-${tok.cls}` : '';
    if (chg) cls += ' chg';
    segs.push({ text: text.slice(a, b), cls });
  }
  return segs;
}
