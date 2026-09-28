// Theme color check: tokenizes a sample docstring with the Julia grammar and this extension's
// injection, resolves the colors with every installed color theme the way VS Code does, and
// compares them character by character with
//   - the same Julia code in a .jl file (signature and Julia code blocks),
//   - the same Markdown in a .md file (prose, headings, lists, inline markup, fences),
//   - the Julia grammar alone for the quotes and the code around the docstring.
// Semantic highlighting is not simulated. Themes come from the VS Code installation (VSCODE_APP,
// default: the macOS app) and the user's extensions (VSCODE_EXTENSIONS, default: ~/.vscode/extensions).
//
// Usage: node test/tools/theme-colors.mjs [--theme <name part>] [--verbose]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const vsctm = require('vscode-textmate');
const oniguruma = require('vscode-oniguruma');
const jsonc = require('jsonc-parser');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const themeFilter = (args[args.indexOf('--theme') + 1] ?? '').toLowerCase();
const vscodeApp = process.env.VSCODE_APP ?? '/Applications/Visual Studio Code.app/Contents/Resources/app';
const userExtensions = process.env.VSCODE_EXTENSIONS ?? path.join(os.homedir(), '.vscode/extensions');

// ------------------------------------------------------------------ sample

const Q = '"""';
/** Docstring lines between the quotes. Kinds: code (compared with CODE), md (with the .md file). */
const BODY = [
  ['code', '    solve(prob::Problem, x₀; tol = 1e-8) -> Vector{Float64}'],
  ['md', ''],
  ['md', 'Solve `prob` from `x₀`; see [`Problem`](@ref), **bold** and *italic* text.'],
  ['md', ''],
  ['md', '# Arguments'],
  ['md', ''],
  ['md', '- `prob`: the problem'],
  ['md', '- `tol`: stopping tolerance'],
  ['md', '  ```julia'],
  ['md', '  y = solve(prob)'],
  ['md', '  ```'],
  ['md', ''],
  ['md', '1. first step'],
  ['md', ''],
  ['admonition', '!!! note "Convergence"'],
  ['md', '    Stops when the **gradient** is below `tol`.'],
  ['md', ''],
  ['md', '```julia'],
  ['code', 'x = solve(prob, [1.0, 2.0]; tol = 1e-6)'],
  ['code', 'println("done: $(x[1])")'],
  ['md', '```'],
  ['md', ''],
  ['fence', '```jldoctest'],
  ['code', 'julia> sum(abs2, [1, 2])'],
  ['code', '5'],
  ['md', '```'],
  ['md', ''],
  ['fence', '```text'],
  ['md', 'plain text'],
  ['md', '```'],
  ['md', 'Last line with `code`.'],
];
const AFTER = ['function solve end', 'x = "a plain string"'];
const JL = [Q, ...BODY.map(([, t]) => t).slice(0, -1), BODY[BODY.length - 1][1] + Q, ...AFTER].join('\n');
/** The code lines as they would appear in a .jl file, and where they start in the docstring. */
const codeLines = BODY.flatMap(([kind, text], i) => {
  if (kind !== 'code') return [];
  const prefix = text.match(/^( {4}|julia> )?/)[0];
  return [{ line: i + 1, offset: prefix.length, text: text.slice(prefix.length) }];
});
const MD = BODY.map(([, t]) => t).join('\n');

// ------------------------------------------------------------------ themes

function normalizeColor(color) {
  if (typeof color !== 'string' || !/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) return undefined;
  let hex = color.slice(1).toUpperCase();
  if (hex.length <= 4) hex = [...hex].map((c) => c + c).join('');
  if (hex.length === 8 && hex.endsWith('FF')) hex = hex.slice(0, 6);
  return '#' + hex;
}

/** Colors and token rules of a theme file, following `include` and tmTheme references. */
function readTheme(file, into = { colors: {}, rules: [] }) {
  const text = fs.readFileSync(file, 'utf8');
  if (text.trimStart().startsWith('<')) {
    const plist = vsctm.parseRawGrammar(text, 'theme.plist');
    for (const s of plist.settings ?? []) {
      if (s.scope) into.rules.push(s);
      else {
        into.colors['editor.foreground'] ??= s.settings?.foreground;
        into.colors['editor.background'] ??= s.settings?.background;
      }
    }
    return into;
  }
  const theme = jsonc.parse(text);
  if (theme.include) readTheme(path.join(path.dirname(file), theme.include), into);
  Object.assign(into.colors, theme.colors);
  if (Array.isArray(theme.tokenColors)) into.rules.push(...theme.tokenColors);
  else if (typeof theme.tokenColors === 'string') readTheme(path.join(path.dirname(file), theme.tokenColors), into);
  return into;
}

const DEFAULT_COLORS = {
  'vs-dark': ['#BBBBBB', '#1E1E1E'],
  vs: ['#333333', '#FFFFFF'],
  'hc-black': ['#FFFFFF', '#000000'],
  'hc-light': ['#292929', '#FFFFFF'],
};

/** The theme as VS Code hands it to vscode-textmate: a default rule from the editor colors, then the rules. */
function textmateTheme(theme) {
  const { colors, rules } = readTheme(theme.file);
  const [fg, bg] = DEFAULT_COLORS[theme.uiTheme] ?? DEFAULT_COLORS['vs-dark'];
  const settings = [
    {
      settings: {
        foreground: normalizeColor(colors['editor.foreground']) ?? fg,
        background: normalizeColor(colors['editor.background']) ?? bg,
      },
    },
  ];
  for (const r of rules) {
    if (!r.scope || !r.settings) continue;
    const { foreground, background, fontStyle } = r.settings;
    settings.push({ scope: r.scope, settings: { foreground: normalizeColor(foreground), background: normalizeColor(background), fontStyle } });
  }
  return { name: theme.label, settings };
}

function installedThemes() {
  const dirs = [path.join(vscodeApp, 'extensions'), userExtensions]
    .filter((d) => fs.existsSync(d))
    .flatMap((d) => fs.readdirSync(d).map((e) => path.join(d, e)));
  const themes = new Map();
  for (const dir of dirs) {
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    let nls = {};
    try {
      nls = JSON.parse(fs.readFileSync(path.join(dir, 'package.nls.json'), 'utf8'));
    } catch {
      // no localized labels
    }
    for (const t of manifest.contributes?.themes ?? []) {
      const label = String(t.label ?? t.id).replace(/^%(.*)%$/, (m, key) => nls[key] ?? m);
      themes.set(label, { label, uiTheme: t.uiTheme, file: path.join(dir, t.path) });
    }
  }
  return [...themes.values()].filter((t) => t.label.toLowerCase().includes(themeFilter));
}

// ------------------------------------------------------------------ tokenizing

await oniguruma.loadWASM(fs.readFileSync(path.join(path.dirname(require.resolve('vscode-oniguruma')), 'onig.wasm')));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const injections = manifest.contributes.grammars;
const grammarFiles = new Map([
  ['source.julia', path.join(root, 'test/grammars/julia_vscode.json')],
  ['text.html.markdown', path.join(root, 'test/grammars/markdown.tmLanguage.json')],
  ...injections.map((g) => [g.scopeName, path.join(root, g.path)]),
]);

function registry(withInjection) {
  return new vsctm.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
      createOnigString: (s) => new oniguruma.OnigString(s),
    }),
    loadGrammar: async (scopeName) => {
      const file = grammarFiles.get(scopeName);
      return file ? vsctm.parseRawGrammar(fs.readFileSync(file, 'utf8'), file) : null;
    },
    getInjections: (scopeName) =>
      withInjection ? injections.filter((g) => g.injectTo?.includes(scopeName)).map((g) => g.scopeName) : undefined,
  });
}

const withInjection = registry(true);
const hostOnly = registry(false);
const grammars = {
  julia: await withInjection.loadGrammar('source.julia'),
  markdown: await withInjection.loadGrammar('text.html.markdown'),
  host: await hostOnly.loadGrammar('source.julia'),
};

const FONT_STYLES = ['', 'i', 'b', 'bi', 'u', 'iu', 'bu', 'biu'];

/** Per line, per character: `color/style` and the scopes. */
function colorize(reg, grammar, source) {
  const colorMap = reg.getColorMap();
  let state = vsctm.INITIAL;
  return source.split('\n').map((text) => {
    const binary = grammar.tokenizeLine2(text, state);
    const { tokens } = grammar.tokenizeLine(text, state);
    state = binary.ruleStack;
    const chars = [];
    for (let i = 0; i < binary.tokens.length; i += 2) {
      const end = binary.tokens[i + 2] ?? text.length;
      const metadata = binary.tokens[i + 1];
      const color = colorMap[(metadata >>> 15) & 511] + (FONT_STYLES[(metadata >>> 11) & 7] ? '/' + FONT_STYLES[(metadata >>> 11) & 7] : '');
      for (let c = binary.tokens[i]; c < end; c++) {
        chars[c] = { color, scopes: tokens.find((t) => t.startIndex <= c && c < t.endIndex)?.scopes ?? [] };
      }
    }
    return { text, chars };
  });
}

// ------------------------------------------------------------------ check

let failing = 0;
const themes = installedThemes();
for (const theme of themes) {
  let tm;
  try {
    tm = textmateTheme(theme);
  } catch (error) {
    console.log(`${theme.label}: cannot read ${theme.file}: ${error.message}`);
    continue;
  }
  withInjection.setTheme(tm);
  hostOnly.setTheme(tm);
  const doc = colorize(withInjection, grammars.julia, JL);
  const host = colorize(hostOnly, grammars.host, JL);
  const code = colorize(withInjection, grammars.julia, codeLines.map((c) => c.text).join('\n'));
  const md = colorize(withInjection, grammars.markdown, MD);

  const problems = [];
  const compare = (what, line, col, expected) => {
    const actual = doc[line].chars[col];
    if (/\s/.test(doc[line].text[col]) || actual?.color === expected?.color) return;
    problems.push({ what, at: `${line}:${col}`, ch: doc[line].text[col], actual, expected });
  };
  codeLines.forEach((c, i) => {
    for (let col = 0; col < c.text.length; col++) compare('code', c.line, col + c.offset, code[i].chars[col]);
  });
  BODY.forEach(([kind, text], i) => {
    if (kind === 'code' || kind === 'admonition') return;
    // A fence line whose label the Markdown grammar does not know: only the backticks are compared.
    const end = kind === 'fence' ? text.indexOf('`') + 3 : text.length;
    for (let col = 0; col < end; col++) compare('markdown', i + 1, col, md[i].chars[col]);
  });
  const closing = doc.length - AFTER.length - 1;
  for (const [line, from] of [
    [0, 0],
    [closing, doc[closing].text.indexOf(Q)],
    ...AFTER.map((_, i) => [closing + 1 + i, 0]),
  ]) {
    for (let col = from; col < doc[line].text.length; col++) compare('host', line, col, host[line].chars[col]);
  }

  const prose = doc[3].chars[0].color;
  const count = (what) => problems.filter((p) => p.what === what).length;
  if (problems.length > 0) failing++;
  console.log(
    `${problems.length ? '✗' : '✓'} ${theme.label.padEnd(40)} prose ${prose.padEnd(9)} .md text ${md[2].chars[0].color.padEnd(9)} ` +
      `code ${count('code')}  markdown ${count('markdown')}  host ${count('host')}`,
  );
  if (verbose) {
    for (const p of problems.slice(0, 40)) {
      console.log(`    ${p.what} ${p.at} ${JSON.stringify(p.ch)} ${p.actual?.color} ≠ ${p.expected?.color}`);
      console.log(`      docstring: ${p.actual?.scopes.join(' ')}`);
      console.log(`      reference: ${p.expected?.scopes.join(' ')}`);
    }
  }
}
console.log(`\n${themes.length} themes, ${failing} with differences`);
process.exitCode = failing > 0 ? 1 : 0;
