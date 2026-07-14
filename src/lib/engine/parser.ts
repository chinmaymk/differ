/**
 * Tree-sitter lifecycle: engine init, lazy per-language grammar loading with
 * an LRU cache, and compiled-query caching.
 *
 * The wasm bytes are provided by an injected `GrammarSource` so the same code
 * runs unchanged in the browser/worker (fetch from /wasm) and in Node tests
 * (read from the filesystem). tree-sitter handles (`Tree`) are wasm-heap
 * objects that are NOT garbage collected — callers must `.delete()` them.
 */
import {
  Parser,
  Language,
  Query,
  // The package ships types via its bundled .d.ts.
} from '@vscode/tree-sitter-wasm';
import { LANGUAGES, type LangConfig } from './languages';

/** Supplies the wasm bytes for the core runtime and each grammar. */
export interface GrammarSource {
  /** Maps a core file name (e.g. "tree-sitter.wasm") to a URL or path. */
  coreLocateFile(file: string): string;
  /** Returns the raw bytes of a grammar wasm (e.g. "tree-sitter-rust.wasm"). */
  loadGrammar(file: string): Promise<Uint8Array>;
}

let source: GrammarSource | null = null;
let initPromise: Promise<void> | null = null;

/** Configure where wasm comes from. Must be called before any parsing. */
export function configureEngine(src: GrammarSource): void {
  source = src;
}

function ensureSource(): GrammarSource {
  if (!source) {
    throw new Error('Engine not configured: call configureEngine() first.');
  }
  return source;
}

/** Initialize the tree-sitter core runtime exactly once. */
export function initEngine(): Promise<void> {
  if (!initPromise) {
    const src = ensureSource();
    initPromise = Parser.init({
      locateFile: (file: string) => src.coreLocateFile(file),
    });
  }
  return initPromise;
}

// --- Grammar LRU cache ------------------------------------------------------

const MAX_GRAMMARS = 4;
/** langId -> loaded Language, most-recently-used last. */
const grammarCache = new Map<string, Language>();
const queryCache = new Map<string, Query>();

async function loadLanguage(config: LangConfig): Promise<Language> {
  const cached = grammarCache.get(config.id);
  if (cached) {
    // Refresh LRU position.
    grammarCache.delete(config.id);
    grammarCache.set(config.id, cached);
    return cached;
  }
  await initEngine();
  const bytes = await ensureSource().loadGrammar(config.grammarWasm);
  const lang = await Language.load(bytes);

  grammarCache.set(config.id, lang);
  // Evict least-recently-used beyond the cap.
  while (grammarCache.size > MAX_GRAMMARS) {
    const oldest = grammarCache.keys().next().value as string;
    grammarCache.delete(oldest);
    queryCache.delete(oldest);
  }
  return lang;
}

/** A parser + its language + compiled symbol query, ready to use. */
export interface LangHandle {
  config: LangConfig;
  language: Language;
  parser: Parser;
  query: Query | null;
}

// One parser instance is reused; setLanguage is cheap relative to churn.
let sharedParser: Parser | null = null;

/** Get a ready handle for a language id, or null if the id is unknown. */
export async function getLangHandle(langId: string): Promise<LangHandle | null> {
  const config = LANGUAGES[langId];
  if (!config) return null;
  const language = await loadLanguage(config);

  if (!sharedParser) sharedParser = new Parser();
  sharedParser.setLanguage(language);

  let query = queryCache.get(langId) ?? null;
  if (!query && config.symbolQuery) {
    query = new Query(language, config.symbolQuery);
    queryCache.set(langId, query);
  }
  return { config, language, parser: sharedParser, query };
}

/** Release cached grammars/queries (e.g. on teardown). */
export function disposeEngine(): void {
  grammarCache.clear();
  queryCache.clear();
  sharedParser = null;
}
