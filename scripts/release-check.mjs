// Release checks: everything that has to pass before a .vsix is published.
//
//   npm run release-check
//
// Stops at the first failure. The Julia parser oracle is required here: set JULIA=/path/to/julia when
// `julia` is not on PATH or the juliaup launcher cannot run. The integration tests run on the minimum
// VS Code of engines.vscode and on VSCODE_TEST_STABLE (default: the current stable release); an
// existing VSCODE_TEST_PATH is ignored so that both versions are really tested. The package is built
// into the temp directory, not over the .vsix in vsix/.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const minimum = manifest.engines.vscode.replace(/^\^/, '');
const stable = process.env.VSCODE_TEST_STABLE ?? 'stable';
const vsix = path.join(os.tmpdir(), `${manifest.name}-${manifest.version}-release-check.vsix`);

/** Files that must be in the package, and paths that must not. */
const REQUIRED = ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'dist/extension.js', 'syntaxes/julia-docstring.injection.tmLanguage.json'];
const FORBIDDEN = [/^(src|test|out|docs|scripts|node_modules|\.vscode(-test)?)\//, /\.(ts|map|vsix)$/];

function run(title, args, env = {}, capture = false) {
  console.log(`\n=== ${title} ===`);
  const childEnv = { ...process.env, ...env };
  delete childEnv.VSCODE_TEST_PATH;
  const r = spawnSync('npm', args, {
    cwd: root,
    env: childEnv,
    stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    console.error(`\nrelease check failed: ${title}`);
    process.exit(r.status ?? 1);
  }
  return r.stdout ?? '';
}

run('lint', ['run', 'lint']);
run('type check', ['run', 'check-types']);
run('unit tests', ['run', 'test:unit']);
run('grammar tests', ['run', 'test:grammar']);
run(`integration tests, VS Code ${minimum}`, ['run', 'test:integration'], { VSCODE_TEST_VERSION: minimum });
run(`integration tests, VS Code ${stable}`, ['run', 'test:integration'], { VSCODE_TEST_VERSION: stable });
run('Julia parser oracle', ['run', 'test:oracle'], { ORACLE_REQUIRED: '1' });
run('performance budget', ['run', 'perf']);
run('package', ['run', 'package', '--', '--out', vsix]);

const files = run('package contents', ['exec', '--', 'vsce', 'ls'], {}, true)
  .split(/\r?\n/)
  .map((f) => f.trim().replaceAll('\\', '/'))
  .filter(Boolean);
const problems = [
  ...REQUIRED.filter((f) => !files.includes(f)).map((f) => `missing ${f}`),
  ...files.filter((f) => FORBIDDEN.some((re) => re.test(f))).map((f) => `must not ship ${f}`),
];
console.log(files.map((f) => `  ${f}`).join('\n'));
if (problems.length > 0) {
  console.error(`\nrelease check failed: package contents\n${problems.map((p) => `  ${p}`).join('\n')}`);
  process.exit(1);
}

console.log(`\nAll release checks passed. Package: ${vsix} (${(fs.statSync(vsix).size / 1024).toFixed(0)} KiB)`);
