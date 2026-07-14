/** Built-in sample diffs for the demo mode — chosen to exercise the semantic
 * classifications (add, modify, rename) and the raw diff at once. */
import { MemorySource } from './memory';

const TS_OLD = `interface Shape {
  area(): number;
}

export class Circle implements Shape {
  constructor(private radius: number) {}

  area(): number {
    return 3.14 * this.radius * this.radius;
  }
}

function describe(s: Shape): string {
  return "area=" + s.area();
}
`;

const TS_NEW = `interface Shape {
  area(): number;
  perimeter(): number;
}

export class Circle implements Shape {
  constructor(private radius: number) {}

  area(): number {
    return Math.PI * this.radius * this.radius;
  }

  perimeter(): number {
    return 2 * Math.PI * this.radius;
  }
}

function summarize(s: Shape): string {
  return "area=" + s.area() + " perimeter=" + s.perimeter();
}
`;

const PY_OLD = `import math


def compute(values):
    total = 0
    for v in values:
        total += v
    return total


class Stats:
    def __init__(self, data):
        self.data = data

    def mean(self):
        return compute(self.data) / len(self.data)
`;

const PY_NEW = `import math


def compute(values):
    return sum(values)


class Stats:
    def __init__(self, data):
        self.data = data

    def mean(self):
        return compute(self.data) / len(self.data)

    def stddev(self):
        m = self.mean()
        return math.sqrt(compute((v - m) ** 2 for v in self.data) / len(self.data))
`;

// A newly added file — demonstrates the neutral (not all-green) rendering.
const NEW_FILE = `export function clamp(x: number, lo: number, hi: number): number {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}
`;

// An image change (SVG so the demo needs no binary assets) — icon recolored
// and a ring added.
const svg = (fill: string, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">` +
  `<rect width="120" height="120" fill="#0d1117"/>` +
  `<circle cx="60" cy="60" r="34" fill="${fill}"/>${extra}</svg>`;

const ICON_OLD = svg('#2f81f7');
const ICON_NEW = svg('#3fb950', '<circle cx="60" cy="60" r="46" fill="none" stroke="#3fb950" stroke-width="4"/>');

export function sampleSource(): MemorySource {
  return new MemorySource('Demo changes', [
    { path: 'src/shapes.ts', oldText: TS_OLD, newText: TS_NEW },
    { path: 'src/math/utils.ts', oldText: null, newText: NEW_FILE },
    { path: 'analytics/stats.py', oldText: PY_OLD, newText: PY_NEW },
    { path: 'assets/icon.svg', oldText: ICON_OLD, newText: ICON_NEW },
  ]);
}
