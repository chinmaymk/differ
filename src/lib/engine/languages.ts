/**
 * Declarative per-language configuration. The engine has ZERO language-specific
 * procedural code — everything a language needs lives here.
 *
 * Symbol queries use a self-describing capture convention so each pattern
 * carries its own kind:
 *   @def.<kind>  the whole declaration node   (kind is a SymbolKind)
 *   @name        the declared name node
 *   @body        (optional) the body/block node, for signature/body separation
 *
 * `symbolQuery: null` means the language has no meaningful symbol structure
 * (or isn't wired yet) → the file is shown as a text-only diff.
 *
 * Grammar wasm files ship with @vscode/tree-sitter-wasm (16 grammars).
 */

export interface LangConfig {
  id: string;
  grammarWasm: string;
  /** File extensions (no dot) that map to this language. */
  extensions: string[];
  symbolQuery: string | null;
}

// --- Shared queries ---------------------------------------------------------

// Using `name: (_) @name` (wildcard) keeps queries robust across grammars that
// disagree on whether a name is an `identifier` vs `type_identifier`, etc.

const JS_DECL_QUERY = `
(function_declaration name: (_) @name body: (statement_block) @body) @def.function
(generator_function_declaration name: (_) @name body: (statement_block) @body) @def.function
(class_declaration name: (_) @name body: (class_body) @body) @def.class
(method_definition name: (_) @name body: (statement_block) @body) @def.method
`;

// Jest/Vitest/Mocha/Jasmine style test blocks are plain call expressions
// (`describe('...', () => {...})`), not declarations, so they need their own
// patterns on top of JS_QUERY. Covers plain calls and the common
// `.only`/`.skip` member-call variants.
const JS_TEST_QUERY = `
(call_expression
  function: (identifier) @_fn
  arguments: (arguments
    (string (string_fragment) @name)
    [
      (arrow_function body: (_) @body)
      (function_expression body: (statement_block) @body)
    ])
  (#match? @_fn "^(describe|it|test|xdescribe|xit|fdescribe|fit|context|suite)$")) @def.test

(call_expression
  function: (member_expression
    object: (identifier) @_fn
    property: (property_identifier) @_prop)
  arguments: (arguments
    (string (string_fragment) @name)
    [
      (arrow_function body: (_) @body)
      (function_expression body: (statement_block) @body)
    ])
  (#match? @_fn "^(describe|it|test|context|suite)$")
  (#match? @_prop "^(only|skip)$")) @def.test

; Hooks take only a callback, no name string — use the hook's own name.
(call_expression
  function: (identifier) @_fn @name
  arguments: (arguments
    .
    [
      (arrow_function body: (_) @body)
      (function_expression body: (statement_block) @body)
    ] .)
  (#match? @_fn "^(beforeEach|afterEach|beforeAll|afterAll)$")) @def.test
`;

const JS_QUERY = JS_DECL_QUERY + JS_TEST_QUERY;

const TS_QUERY =
  JS_QUERY +
  `
(abstract_class_declaration name: (_) @name body: (class_body) @body) @def.class
(interface_declaration name: (_) @name body: (interface_body) @body) @def.interface
(type_alias_declaration name: (_) @name) @def.type
(enum_declaration name: (_) @name body: (enum_body) @body) @def.enum
(internal_module name: (_) @name body: (statement_block) @body) @def.module
`;

const PYTHON_QUERY = `
(function_definition name: (_) @name body: (block) @body) @def.function
(class_definition name: (_) @name body: (block) @body) @def.class
`;

const GO_QUERY = `
(function_declaration name: (_) @name body: (block) @body) @def.function
(method_declaration name: (_) @name body: (block) @body) @def.method
(type_spec name: (_) @name type: (struct_type)) @def.struct
(type_spec name: (_) @name type: (interface_type)) @def.interface
`;

const RUST_QUERY = `
(function_item name: (_) @name body: (block) @body) @def.function
(struct_item name: (_) @name) @def.struct
(enum_item name: (_) @name) @def.enum
(union_item name: (_) @name) @def.struct
(trait_item name: (_) @name) @def.trait
(mod_item name: (_) @name) @def.module
(impl_item type: (_) @name) @def.impl
(const_item name: (_) @name) @def.constant
(static_item name: (_) @name) @def.constant
(type_item name: (_) @name) @def.type
`;

const JAVA_QUERY = `
(class_declaration name: (_) @name body: (class_body) @body) @def.class
(interface_declaration name: (_) @name body: (interface_body) @body) @def.interface
(enum_declaration name: (_) @name body: (enum_body) @body) @def.enum
(method_declaration name: (_) @name) @def.method
(constructor_declaration name: (_) @name) @def.method
`;

const RUBY_QUERY = `
(method name: (_) @name) @def.method
(singleton_method name: (_) @name) @def.method
(class name: (_) @name) @def.class
(module name: (_) @name) @def.module
`;

// --- Registry ---------------------------------------------------------------

const CONFIGS: LangConfig[] = [
  { id: 'javascript', grammarWasm: 'tree-sitter-javascript.wasm', extensions: ['js', 'jsx', 'mjs', 'cjs'], symbolQuery: JS_QUERY },
  { id: 'typescript', grammarWasm: 'tree-sitter-typescript.wasm', extensions: ['ts', 'mts', 'cts'], symbolQuery: TS_QUERY },
  { id: 'tsx', grammarWasm: 'tree-sitter-tsx.wasm', extensions: ['tsx'], symbolQuery: TS_QUERY },
  { id: 'python', grammarWasm: 'tree-sitter-python.wasm', extensions: ['py', 'pyi'], symbolQuery: PYTHON_QUERY },
  { id: 'go', grammarWasm: 'tree-sitter-go.wasm', extensions: ['go'], symbolQuery: GO_QUERY },
  { id: 'rust', grammarWasm: 'tree-sitter-rust.wasm', extensions: ['rs'], symbolQuery: RUST_QUERY },
  { id: 'java', grammarWasm: 'tree-sitter-java.wasm', extensions: ['java'], symbolQuery: JAVA_QUERY },
  { id: 'ruby', grammarWasm: 'tree-sitter-ruby.wasm', extensions: ['rb'], symbolQuery: RUBY_QUERY },
  // Wired for language detection + text diff; semantic queries can be added
  // later behind this same config with no engine changes.
  { id: 'cpp', grammarWasm: 'tree-sitter-cpp.wasm', extensions: ['cpp', 'cc', 'cxx', 'hpp', 'h', 'hh'], symbolQuery: null },
  { id: 'csharp', grammarWasm: 'tree-sitter-c-sharp.wasm', extensions: ['cs'], symbolQuery: null },
  { id: 'php', grammarWasm: 'tree-sitter-php.wasm', extensions: ['php'], symbolQuery: null },
  { id: 'css', grammarWasm: 'tree-sitter-css.wasm', extensions: ['css', 'scss', 'less'], symbolQuery: null },
  { id: 'bash', grammarWasm: 'tree-sitter-bash.wasm', extensions: ['sh', 'bash', 'zsh'], symbolQuery: null },
  { id: 'powershell', grammarWasm: 'tree-sitter-powershell.wasm', extensions: ['ps1', 'psm1'], symbolQuery: null },
  { id: 'ini', grammarWasm: 'tree-sitter-ini.wasm', extensions: ['ini', 'toml', 'cfg', 'conf'], symbolQuery: null },
  { id: 'regex', grammarWasm: 'tree-sitter-regex.wasm', extensions: [], symbolQuery: null },
];

/** langId -> config. */
export const LANGUAGES: Record<string, LangConfig> = Object.fromEntries(
  CONFIGS.map((c) => [c.id, c]),
);

const EXT_TO_LANG: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const c of CONFIGS) for (const ext of c.extensions) m[ext] = c.id;
  return m;
})();

/** Detect a language id from a file path, or null if unknown. */
export function detectLang(path: string): string | null {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  return EXT_TO_LANG[ext] ?? null;
}

/** Does this language have a semantic (symbol) query wired up? */
export function hasSemantics(langId: string | null): boolean {
  return !!langId && LANGUAGES[langId]?.symbolQuery != null;
}
