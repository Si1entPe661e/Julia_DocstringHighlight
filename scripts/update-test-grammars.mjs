// Refreshes the grammar copies used by the grammar snapshot tests from local installations
// and records where they came from. The copies are MIT licensed, live in test/grammars/ only and are
// never packaged (.vscodeignore excludes test/).
//
//   JULIA_EXTENSION_DIR  official Julia extension directory
//                        (default: the newest ~/.vscode/extensions/julialang.language-julia-*)
//   VSCODE_APP_DIR       VS Code's resources/app directory
//                        (default: /Applications/Visual Studio Code.app/Contents/Resources/app)
//
// After refreshing, run `npm run test:grammar` and review snapshot changes (UPDATE_SNAPSHOTS=1).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'test/grammars');

function newestJuliaExtension() {
  const dir = path.join(os.homedir(), '.vscode/extensions');
  const candidates = fs
    .readdirSync(dir)
    .filter((d) => /^julialang\.language-julia-\d/.test(d))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (candidates.length === 0) throw new Error(`no julialang.language-julia-* in ${dir}; set JULIA_EXTENSION_DIR`);
  return path.join(dir, candidates[candidates.length - 1]);
}

const juliaDir = process.env.JULIA_EXTENSION_DIR ?? newestJuliaExtension();
const appDir = process.env.VSCODE_APP_DIR ?? '/Applications/Visual Studio Code.app/Contents/Resources/app';

const juliaPackage = JSON.parse(fs.readFileSync(path.join(juliaDir, 'package.json'), 'utf8'));
const vscodePackage = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
const markdownSource = path.join(appDir, 'extensions/markdown-basics/syntaxes/markdown.tmLanguage.json');
const markdownGrammar = JSON.parse(fs.readFileSync(markdownSource, 'utf8'));

fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(juliaDir, 'syntaxes/julia_vscode.json'), path.join(out, 'julia_vscode.json'));
fs.copyFileSync(markdownSource, path.join(out, 'markdown.tmLanguage.json'));

// License texts: julia-vscode ships LICENSE.txt; the Markdown grammar's MIT notice is in VS Code's
// ThirdPartyNotices.txt (microsoft/vscode-markdown-tm-grammar).
const juliaLicense = fs.readFileSync(path.join(juliaDir, 'LICENSE.txt'), 'utf8').trim();
const notices = fs.readFileSync(path.join(appDir, 'ThirdPartyNotices.txt'), 'utf8');
const start = notices.indexOf('microsoft/vscode-markdown-tm-grammar');
const end = notices.indexOf('---------------------------------------------------------', start);
if (start < 0 || end < 0) throw new Error('vscode-markdown-tm-grammar notice not found in ThirdPartyNotices.txt');
const markdownLicense = notices.slice(start, end).trim();

fs.writeFileSync(
  path.join(out, 'LICENSES.md'),
  [
    '# Licenses of the vendored test grammars',
    '',
    'These files are used by the grammar tests only and are not part of the extension package.',
    '',
    '## julia_vscode.json',
    '',
    `From the official Julia extension (\`julialang.language-julia\` ${juliaPackage.version}),`,
    'https://github.com/julia-vscode/julia-vscode (grammar maintained in https://github.com/JuliaEditorSupport/atom-language-julia).',
    '',
    '```',
    juliaLicense,
    '```',
    '',
    '## markdown.tmLanguage.json',
    '',
    `From VS Code ${vscodePackage.version} (\`extensions/markdown-basics\`), converted from`,
    'https://github.com/microsoft/vscode-markdown-tm-grammar.',
    '',
    '```',
    markdownLicense,
    '```',
    '',
  ].join('\n'),
);

const sources = {
  updated: new Date().toISOString().slice(0, 10),
  julia: {
    file: 'julia_vscode.json',
    extension: `${juliaPackage.publisher}.${juliaPackage.name}`,
    version: juliaPackage.version,
    // Every grammar the official extension registers: the grammar tests check that none of them
    // injects into docstrings as well, which would compete with this extension's injection.
    contributedGrammars: juliaPackage.contributes?.grammars ?? [],
  },
  markdown: {
    file: 'markdown.tmLanguage.json',
    vscodeVersion: vscodePackage.version,
    grammarVersion: markdownGrammar.version ?? null,
  },
};
fs.writeFileSync(path.join(out, 'SOURCES.json'), JSON.stringify(sources, null, 2) + '\n');

console.log(`test/grammars updated: ${sources.julia.extension} ${sources.julia.version}, VS Code ${sources.markdown.vscodeVersion}`);
