// Regenerates test/fixtures/<name>.expected.json from the current detector (run `npm run compile-tests`
// first). Existing `oracle` annotations are kept, matched by start line. The expected files are the
// detector's specification: review every change in the diff before committing it.
//
// Usage: node test/tools/update-expected.mjs [fixture.jl ...]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtures = path.join(root, 'test/fixtures');
const { scan } = require(path.join(root, 'out/src/detector/index.js'));

const names = process.argv.slice(2).map((f) => path.basename(f));
const files = names.length > 0 ? names : fs.readdirSync(fixtures).filter((f) => f.endsWith('.jl')).sort();

for (const file of files) {
  const expectedPath = path.join(fixtures, file.replace(/\.jl$/, '.expected.json'));
  const previous = fs.existsSync(expectedPath) ? JSON.parse(fs.readFileSync(expectedPath, 'utf8')) : { docstrings: [] };
  const annotations = new Map(previous.docstrings.filter((d) => d.oracle).map((d) => [d.start, d.oracle]));
  const result = scan(fs.readFileSync(path.join(fixtures, file), 'utf8'));
  const docstrings = result.docstrings.map((d) => {
    const entry = {
      start: d.start.line,
      end: d.end.line,
      kind: d.kind,
      quote: d.quote,
      prefix: d.prefix,
      targetLine: d.targetLine,
    };
    const oracle = annotations.get(entry.start);
    return oracle ? { ...entry, oracle } : entry;
  });
  const inlineCode = result.inlineCode.map((s) => [s.line, s.startCol, s.endCol]);
  const list = (items) => (items.length ? '[\n' + items.map((x) => '    ' + JSON.stringify(x)).join(',\n') + '\n  ]' : '[]');
  const body = `{\n  "docstrings": ${list(docstrings)},\n  "inlineCode": ${list(inlineCode)}\n}\n`;
  fs.writeFileSync(expectedPath, body);
  console.log(`${path.relative(root, expectedPath)}: ${docstrings.length} docstrings, ${inlineCode.length} inline code spans`);
}
