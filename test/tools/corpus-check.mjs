// Compares the detector with the Julia parser on real code: every .jl file under the given
// directories, except in test/ and deps/ directories. Good corpora are Julia's own base/ and
// stdlib/ (share/julia in a Julia installation) and ~/.julia/packages. Some differences are expected:
// strings in block bodies that are not indented (blocks are recognized by indentation while their
// `end` is missing), and `@doc` forms whose docstring is not a string literal (`@doc $str f`); review
// the rest. Run `npm run compile-tests` first; needs Julia (JULIA=/path/to/julia).
//
// Usage: node test/tools/corpus-check.mjs <dir> [<dir> ...]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { scan } = require(path.join(root, 'out/src/detector/index.js'));
const julia = process.env.JULIA ?? 'julia';

const SKIP = new Set(['test', 'deps', 'node_modules', '.git']);

function* juliaFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) yield* juliaFiles(p);
    } else if (entry.isFile() && entry.name.endsWith('.jl')) {
      yield p;
    }
  }
}

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error('usage: node test/tools/corpus-check.mjs <dir> [<dir> ...]');
  process.exit(2);
}
/** Every file, with its path from the given directory on (`base/int.jl`) for the report. */
const shown = new Map();
for (const d of dirs) {
  const dir = path.resolve(d);
  for (const file of juliaFiles(dir)) shown.set(file, path.relative(path.dirname(dir), file));
}
const files = [...shown.keys()];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jdh-corpus-'));
const list = path.join(tmp, 'files.txt');
fs.writeFileSync(list, files.join('\n') + '\n');
const r = spawnSync(julia, ['--startup-file=no', path.join(root, 'test/tools/parser-oracle.jl'), '--list', list], {
  encoding: 'utf8',
  maxBuffer: 1 << 28,
});
fs.rmSync(tmp, { recursive: true, force: true });
if (r.status !== 0) {
  console.error(r.error?.message ?? r.stderr);
  process.exit(1);
}
const oracle = JSON.parse(r.stdout);

let total = 0;
let unparsed = 0;
const missing = [];
const extra = [];
for (const file of files) {
  const truth = oracle[file];
  if (!Array.isArray(truth)) {
    unparsed++;
    continue;
  }
  const text = fs.readFileSync(file, 'utf8');
  const found = scan(text).docstrings.map((d) => d.start.line);
  const lines = text.split(/\r\n|\r|\n/);
  const reported = new Set(truth);
  const decorated = new Set(found);
  total += truth.length;
  for (const line of truth) if (!decorated.has(line)) missing.push([file, line, lines[line]]);
  for (const line of found) if (!reported.has(line)) extra.push([file, line, lines[line]]);
}

function show(title, items) {
  console.log(`\n${title}: ${items.length}`);
  for (const [file, line, text] of items) console.log(`  ${shown.get(file)}:${line + 1}  ${String(text).trim().slice(0, 80)}`);
}

console.log(`${files.length} files (${unparsed} not parsed), ${total} docstrings reported by the parser`);
show('Reported by the parser, not decorated', missing);
show('Decorated, not reported by the parser', extra);
