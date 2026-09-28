// Tokenizes Julia source with the vendored host grammars (test/grammars) and, optionally, this
// extension's injection grammar, wired the way package.json declares it.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as oniguruma from 'vscode-oniguruma';
import * as vsctm from 'vscode-textmate';

export const ROOT = path.resolve(__dirname, '../../..');
export const CASES = path.join(ROOT, 'test/grammar/cases');

interface ContributedGrammar {
  scopeName: string;
  path: string;
  injectTo?: string[];
}

/** scopeName → file, and injected scopeName → target scopes, as declared in package.json. */
function grammarSources(): { files: Map<string, string>; injections: Map<string, string[]> } {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
    contributes: { grammars: ContributedGrammar[] };
  };
  const files = new Map<string, string>([
    ['source.julia', path.join(ROOT, 'test/grammars/julia_vscode.json')],
    ['text.html.markdown', path.join(ROOT, 'test/grammars/markdown.tmLanguage.json')],
  ]);
  const injections = new Map<string, string[]>();
  for (const g of manifest.contributes.grammars) {
    files.set(g.scopeName, path.join(ROOT, g.path));
    for (const target of g.injectTo ?? []) injections.set(target, [...(injections.get(target) ?? []), g.scopeName]);
  }
  return { files, injections };
}

let onigLib: Promise<vsctm.IOnigLib> | undefined;

function getOnigLib(): Promise<vsctm.IOnigLib> {
  onigLib ??= (async () => {
    const wasm = fs.readFileSync(path.join(path.dirname(require.resolve('vscode-oniguruma')), 'onig.wasm'));
    await oniguruma.loadWASM(wasm);
    return {
      createOnigScanner: (patterns: string[]) => new oniguruma.OnigScanner(patterns),
      createOnigString: (s: string) => new oniguruma.OnigString(s),
    };
  })();
  return onigLib;
}

const grammars = new Map<string, Promise<vsctm.IGrammar>>();

function loadGrammar(scopeName: string, withInjection: boolean): Promise<vsctm.IGrammar> {
  const key = `${scopeName} ${withInjection}`;
  let grammar = grammars.get(key);
  if (grammar === undefined) {
    const { files, injections } = grammarSources();
    const registry = new vsctm.Registry({
      onigLib: getOnigLib(),
      loadGrammar: async (name) => {
        const file = files.get(name);
        // Other embedded languages (source.sql, source.cpp, text.html.derivative, …) are not needed.
        return file === undefined ? null : vsctm.parseRawGrammar(fs.readFileSync(file, 'utf8'), file);
      },
      getInjections: (name) => (withInjection ? injections.get(name) : undefined),
    });
    grammar = registry.loadGrammar(scopeName).then((g) => {
      if (g === null) throw new Error(`${scopeName} grammar not found`);
      return g;
    });
    grammars.set(key, grammar);
  }
  return grammar;
}

/** The `source.julia` grammar with or without this extension's injection. */
export function loadJulia(withInjection: boolean): Promise<vsctm.IGrammar> {
  return loadGrammar('source.julia', withInjection);
}

/** VS Code's Markdown grammar, for comparisons with a .md file. */
export function loadMarkdown(): Promise<vsctm.IGrammar> {
  return loadGrammar('text.html.markdown', false);
}

/** The editor's token types (vscode-textmate's StandardTokenType). */
export const TokenType = { Other: 0, Comment: 1, String: 2, RegEx: 3 } as const;

/** Token type per line and character, from the metadata of tokenizeLine2 (bits 8–9). */
export function tokenTypes(grammar: vsctm.IGrammar, source: string): number[][] {
  let state = vsctm.INITIAL;
  return splitLines(source).map((text) => {
    const { tokens, ruleStack } = grammar.tokenizeLine2(text, state);
    state = ruleStack;
    const types: number[] = [];
    for (let i = 0; i < tokens.length; i += 2) {
      const end = i + 2 < tokens.length ? (tokens[i + 2] ?? text.length) : text.length;
      for (let c = tokens[i] ?? 0; c < end; c++) types[c] = ((tokens[i + 1] ?? 0) >>> 8) & 3;
    }
    return types;
  });
}

export interface Token {
  line: number;
  start: number;
  end: number;
  text: string;
  scopes: string[];
}

/** Tokenizes line by line like VS Code: lines are passed without their line break. */
export function tokenize(grammar: vsctm.IGrammar, source: string): Token[][] {
  let state = vsctm.INITIAL;
  return splitLines(source).map((text, line) => {
    const result = grammar.tokenizeLine(text, state);
    state = result.ruleStack;
    return result.tokens
      .map((t) => ({ line, start: t.startIndex, end: Math.min(t.endIndex, text.length), text: '', scopes: t.scopes }))
      .filter((t) => t.end > t.start)
      .map((t) => ({ ...t, text: text.slice(t.start, t.end) }));
  });
}

export function splitLines(source: string): string[] {
  return source.split(/\r\n|\r|\n/);
}

/** Snapshot text in the format of vscode-tmgrammar-snap: `>` source lines, `#^^^ scopes` tokens. */
export function snapshot(source: string, tokens: Token[][]): string {
  const out: string[] = [];
  splitLines(source).forEach((text, line) => {
    out.push('>' + text);
    for (const t of tokens[line] ?? []) {
      out.push('#' + ' '.repeat(t.start) + '^'.repeat(t.end - t.start) + ' ' + t.scopes.join(' '));
    }
  });
  return out.join('\n') + '\n';
}

/** Scopes at a character position, per character, for comparisons independent of token splits. */
export function scopesPerCharacter(tokens: Token[][]): string[][][] {
  return tokens.map((line) => {
    const chars: string[][] = [];
    for (const t of line) for (let c = t.start; c < t.end; c++) chars[c] = t.scopes;
    return chars;
  });
}
