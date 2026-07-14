import { describe, it, expect, beforeAll } from 'vitest';
import { extractSymbols } from './extract';
import type { SymbolNode } from './model';
import { useNodeEngine } from './wasm-node';

beforeAll(() => useNodeEngine());

/** Flatten a symbol tree to "kind name" strings for easy assertions. */
function flat(nodes: SymbolNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    out.push(`${n.kind} ${n.name}`);
    flat(n.children, out);
  }
  return out;
}

describe('extractSymbols — real grammars', () => {
  it('extracts Rust functions, structs, impls, and methods', async () => {
    const src = `
struct Point { x: i32, y: i32 }
impl Point {
    fn new(x: i32, y: i32) -> Self { Point { x, y } }
    fn norm(&self) -> i32 { self.x + self.y }
}
fn main() { let p = Point::new(1, 2); }
`;
    const syms = await extractSymbols('rust', src);
    const f = flat(syms);
    expect(f).toContain('struct Point');
    expect(f).toContain('impl Point');
    expect(f).toContain('method new'); // function inside impl -> method
    expect(f).toContain('method norm');
    expect(f).toContain('function main');
  });

  it('nests methods under their impl (containment)', async () => {
    const src = `impl Foo { fn bar() {} }`;
    const syms = await extractSymbols('rust', src);
    const impl = syms.find((s) => s.kind === 'impl');
    expect(impl?.name).toBe('Foo');
    expect(impl?.children.map((c) => c.name)).toEqual(['bar']);
    expect(impl?.children[0].kind).toBe('method');
  });

  it('extracts TypeScript classes, methods, interfaces, types', async () => {
    const src = `
export interface Shape { area(): number; }
type Id = string;
export class Circle implements Shape {
  constructor(private r: number) {}
  area(): number { return Math.PI * this.r * this.r; }
}
function helper(x: number) { return x + 1; }
`;
    const f = flat(await extractSymbols('typescript', src));
    expect(f).toContain('interface Shape');
    expect(f).toContain('type Id');
    expect(f).toContain('class Circle');
    expect(f).toContain('method area');
    expect(f).toContain('function helper');
  });

  it('extracts Python functions and methods', async () => {
    const src = `
class Animal:
    def __init__(self, name):
        self.name = name
    def speak(self):
        return "..."

def top_level():
    return 1
`;
    const syms = await extractSymbols('python', src);
    const f = flat(syms);
    expect(f).toContain('class Animal');
    expect(f).toContain('method speak'); // reclassified from function
    expect(f).toContain('function top_level');
  });

  it('extracts Go functions, methods, and structs', async () => {
    const src = `
package main
type Point struct { X int }
func (p Point) Norm() int { return p.X }
func main() {}
`;
    const f = flat(await extractSymbols('go', src));
    expect(f).toContain('struct Point');
    expect(f).toContain('method Norm');
    expect(f).toContain('function main');
  });

  it('returns [] for text-only languages', async () => {
    expect(await extractSymbols('css', 'a { color: red; }')).toEqual([]);
    expect(await extractSymbols(null, 'whatever')).toEqual([]);
  });

  it('computes stable hashes and fingerprints', async () => {
    const a = await extractSymbols('rust', 'fn f() { let x = 1; }');
    const b = await extractSymbols('rust', 'fn f() { let x = 1; }');
    expect(a[0].bodyHash).toBe(b[0].bodyHash);
    const c = await extractSymbols('rust', 'fn f() { let x = 2; }');
    expect(a[0].bodyHash).not.toBe(c[0].bodyHash);
  });
});
