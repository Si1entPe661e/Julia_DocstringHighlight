// Detector performance budget (06 §6). Run with `npm run perf` (compiles the tests first).
//
// Generates Julia files of 10k and 50k lines (one docstring with heading / list / fence / inline code
// per ~24 lines, plus ordinary functions and multi-line strings), then measures scan() after warm-up.
// Budget: p50 ≤ 5 ms for 10k lines and ≤ 20 ms for 50k lines. Other input shapes (a long docstring of
// plain prose, sparse or unmatched backticks, many short docstrings, a long tail of code) must meet
// the 50k-line budget too and grow linearly: doubling the input may at most triple the time. Also
// checks that 200 consecutive scans do not grow the heap. Exits non-zero when a budget is exceeded.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { scan } = require(path.join(root, 'out/src/detector/index.js'));

const FENCE = '```';

/** About 24 lines and 1 KB (≈ 40 characters per line, so 50k lines ≈ 2 MB as assumed in 03 §7). */
function block(i) {
  return [
    '"""',
    `    f${i}(x::AbstractVector{<:Real}, y::Real; kw::Int = 1) -> Float64`,
    '',
    `Compute a weighted combination of \`x\` and \`y\`; see [\`g${i}\`](@ref) for the inverse transform.`,
    '',
    '# Arguments',
    '',
    '- `x::AbstractVector{<:Real}`: the observations, one entry per sample',
    '- `y::Real`: the scale parameter; must be positive and finite',
    '',
    '# Examples',
    '',
    `${FENCE}jldoctest`,
    `julia> f${i}([1.0, 2.0, 3.0], 2.0; kw = 3)`,
    '21.0',
    FENCE,
    '"""',
    `function f${i}(x::AbstractVector{<:Real}, y::Real; kw::Int = 1)`,
    '    s = """',
    '    not a docstring: $(length(x)) observations, scale $(y)',
    '    """',
    `    total = sum(xi -> xi * y + kw, x)  # accumulate the weighted observations (${i})`,
    '    return total / length(s)',
    'end',
  ];
}

function generate(lines) {
  const out = [];
  for (let i = 0; out.length < lines; i++) out.push(...block(i));
  return out.slice(0, lines).join('\n') + '\n';
}

function measure(text, runs = 20) {
  for (let i = 0; i < 5; i++) scan(text);
  const times = [];
  let result;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    result = scan(text);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const pick = (q) => times[Math.min(times.length - 1, Math.floor(q * times.length))];
  return { p50: pick(0.5), p95: pick(0.95), docstrings: result.docstrings.length, chips: result.inlineCode.length };
}

const budgets = [
  { lines: 10_000, p50: 5 },
  { lines: 50_000, p50: 20 },
];

let failed = false;
console.log(`node ${process.version}, ${process.arch}`);
for (const { lines, p50 } of budgets) {
  const text = generate(lines);
  const m = measure(text);
  const ok = m.p50 <= p50;
  failed ||= !ok;
  console.log(
    `${String(lines).padStart(6)} lines (${(text.length / 1e6).toFixed(1)} MB): p50 ${m.p50.toFixed(2)} ms, p95 ${m.p95.toFixed(2)} ms ` +
      `(budget p50 ≤ ${p50} ms) ${ok ? 'ok' : 'OVER BUDGET'} — ${m.docstrings} docstrings, ${m.chips} inline code spans`,
  );
}

// Other input shapes, generated for n = 25000 and n = 50000. Inline code search once went to the end
// of the file from every line without a backtick, which is quadratic in the length of a docstring.
// The stress shapes are denser than real code: they get twice the budget but must scale the same way.
const PROSE = 'Documentation text without any inline code.';
const shapes = [
  ['one docstring of plain prose', 20, (n) => ['"""', ...Array(n).fill(PROSE), '"""', 'f(x) = x']],
  ['one docstring, a code span every 50 lines', 20, (n) => ['"""', ...Array.from({ length: n }, (_, i) => (i % 50 === 0 ? 'See `f(x)`.' : PROSE)), '"""', 'f(x) = x']],
  ['a docstring, then only code', 20, (n) => ['"""Docs."""', 'module M', ...Array.from({ length: n }, (_, i) => `    g${i}(x) = x + ${i} # "not docs"`), 'end']],
  ['stress: one-line docstrings on every other line', 40, (n) => Array.from({ length: n }, (_, i) => (i % 2 === 0 ? `"Docs for f${i}."` : `f${i}(x) = x`))],
  ['stress: unmatched backtick runs on every line', 40, (n) => ['"""', ...Array(n).fill('a `` b ``` c ```` d ````` e ` f'), '"""', 'f(x) = x']],
  // One line of 40n characters holding runs of about 2√(20n) different lengths, none of them matched.
  ['stress: one line of unmatched backtick runs', 40, (n) => ['"""', runsOfEveryLength(40 * n), '"""', 'f(x) = x']],
];

function runsOfEveryLength(chars) {
  const parts = [];
  for (let k = 2, length = 0; length < chars; k++, length += k + 1) parts.push('`'.repeat(k));
  return parts.join(' ');
}

for (const [name, budget, lines] of shapes) {
  const half = lines(25_000).join('\n') + '\n';
  const text = lines(50_000).join('\n') + '\n';
  // A second attempt absorbs interference from other processes; a real regression fails both.
  let p50 = 0;
  let growth = 0;
  let ok = false;
  for (let attempt = 0; attempt < 2 && !ok; attempt++) {
    p50 = measure(text, 15).p50;
    growth = p50 / measure(half, 15).p50;
    ok = p50 <= budget && growth <= 3;
  }
  failed ||= !ok;
  console.log(
    `${name} (${(text.length / 1e6).toFixed(1)} MB): p50 ${p50.toFixed(2)} ms, ${growth.toFixed(2)}× the time for half ` +
      `the input (budget p50 ≤ ${budget} ms, ≤ 3×) ${ok ? 'ok' : 'OVER BUDGET'}`,
  );
}

// Worst case while typing: an unclosed bracket near the top triggers the recovery pass.
{
  const text = 'foo((x)\n' + generate(50_000);
  const m = measure(text, 10);
  console.log(`50000 lines with an unclosed bracket (two passes): p50 ${m.p50.toFixed(2)} ms, p95 ${m.p95.toFixed(2)} ms — ${m.docstrings} docstrings`);
}

// Memory: 200 consecutive scans must not grow the heap (needs --expose-gc for a clean reading).
{
  const text = generate(50_000);
  const gc = globalThis.gc ?? (() => {});
  gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 200; i++) scan(text);
  gc();
  const after = process.memoryUsage().heapUsed;
  const growthMb = (after - before) / 1e6;
  const ok = !globalThis.gc || growthMb < 5;
  failed ||= !ok;
  console.log(`heap after 200 scans of 50k lines: ${growthMb >= 0 ? '+' : ''}${growthMb.toFixed(2)} MB ${globalThis.gc ? (ok ? 'ok' : 'GROWING') : '(run with --expose-gc to check)'}`);
}

process.exit(failed ? 1 : 0);
