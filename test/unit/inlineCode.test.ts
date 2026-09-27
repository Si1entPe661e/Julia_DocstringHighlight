import * as assert from 'node:assert/strict';
import { scan } from '../../src/detector';

const Q = '"""';

/** Text of every inline code span found in `body`, wrapped in a top-level docstring. */
function spans(body: string, wrap = (b: string) => `${Q}\n${b}\n${Q}\nf(x) = x\n`): string[] {
  const src = wrap(body);
  const lines = src.split(/\r?\n/);
  return scan(src).inlineCode.map((s) => (lines[s.line] ?? '').slice(s.startCol, s.endCol));
}

describe('inline code spans (06 §2.5)', () => {
  it('one span, backticks included', () => {
    assert.deepEqual(spans('Use `θ₀` as the initial value.'), ['`θ₀`']);
  });
  it('double backticks', () => {
    assert.deepEqual(spans('The ``\\alpha`` symbol.'), ['``\\alpha``']);
  });
  it('an escaped backtick opens no span', () => {
    assert.deepEqual(spans('\\`not code`'), []);
  });
  it('an escaped backslash before a backtick does not escape it', () => {
    assert.deepEqual(spans('\\\\`code`'), ['`code`']);
  });
  it('nothing inside fenced code', () => {
    assert.deepEqual(spans('```julia\nx = `cmd`\n```\nafter `y`'), ['`y`']);
  });
  it('nothing inside a tilde fence', () => {
    assert.deepEqual(spans('~~~\n`a`\n~~~\n`b`'), ['`b`']);
  });
  it('a fence closes only with the same fence string', () => {
    assert.deepEqual(spans('````\n```\n`a`\n````\n`b`'), ['`b`']);
  });
  it('nothing in four-space indented code', () => {
    assert.deepEqual(spans('    f(`x`)\n\ntext `y`'), ['`y`']);
  });
  it('two spans on one line', () => {
    assert.deepEqual(spans('`a` and `b`'), ['`a`', '`b`']);
  });
  it('spans do not cross lines', () => {
    assert.deepEqual(spans('`a\nb`'), []);
  });
  it('an unmatched run is literal and does not block later spans', () => {
    assert.deepEqual(spans('`` one ` two `x`'), ['` two `']);
  });
  it('after an unmatched run, later runs still pair with the next run of the same length', () => {
    assert.deepEqual(spans('```` a `` b ` c `` d `e`'), ['`` b ` c ``', '`e`']);
    assert.deepEqual(spans('``` a ` b ` c ` d `'), ['` b `', '` d `']);
    assert.deepEqual(spans('``` a ` b `` c'), []);
  });
  it('many unmatched runs on one line', () => {
    const line = Array.from({ length: 300 }, (_, i) => '`'.repeat(i + 2)).join(' x ');
    assert.deepEqual(spans(line + ' `y`'), ['`y`']);
  });
  it('an unclosed fence hides the rest of the docstring only', () => {
    assert.deepEqual(spans('`a`\n```julia\n`b`'), ['`a`']);
  });
  it('a line with backticks in the info string is not a fence', () => {
    assert.deepEqual(spans('``` `x` ```'), ['``` `x` ```']);
  });
});

describe('inline code spans: block structure mirrors the grammar (04 §5)', () => {
  it('list items and their indented continuation lines are prose', () => {
    assert.deepEqual(spans('- `a`: item\n    continued `b`\n  1. nested `c`'), ['`a`', '`b`', '`c`']);
  });
  it('a line that is not indented ends the list', () => {
    assert.deepEqual(spans('- item\n    `in list`\ntext\n    `code`'), ['`in list`']);
  });
  it('admonition bodies are prose', () => {
    assert.deepEqual(spans('!!! note "Title"\n    Body with `code`.\n\n    More `text`.'), ['`code`', '`text`']);
  });
  it('fences inside an admonition are code', () => {
    assert.deepEqual(spans('!!! tip\n    ```julia\n    `no`\n    ```\n    `yes`'), ['`yes`']);
  });
  it('fences inside a list item are code', () => {
    assert.deepEqual(spans('- item\n  ```\n  `no`\n  ```\n- `yes`'), ['`yes`']);
  });
  it('headings are prose', () => {
    assert.deepEqual(spans('# Using `f`'), ['`f`']);
  });
  it('an indented docstring is dedented first (module-level indentation)', () => {
    const wrap = (b: string) => `module M\n    ${Q}\n${b}\n    ${Q}\n    f(x) = x\nend\n`;
    assert.deepEqual(spans('        f(`sig`)\n\n    Uses `x`.', wrap), ['`x`']);
  });
  it('text on the opening line of a one-line docstring', () => {
    assert.deepEqual(spans('', () => `${Q}Uses \`x\`.${Q}\nf(x) = x\n`), ['`x`']);
  });
  it('single-quoted docstrings', () => {
    assert.deepEqual(spans('', () => `"Uses \`x\` and \`y\`."\nf(x) = x\n`), ['`x`', '`y`']);
  });
  it('text before the closing quotes on the last line', () => {
    assert.deepEqual(spans('', () => `${Q}\nFirst.\nLast \`z\`.${Q}\nf(x) = x\n`), ['`z`']);
  });
  it('not collected outside docstrings', () => {
    assert.deepEqual(spans('', () => `x = ${Q}\nUses \`x\`.\n${Q}\n`), []);
  });
  it('CRLF line endings', () => {
    assert.deepEqual(spans('', () => `${Q}\r\n- \`a\`\r\n    f(\`b\`)\r\n${Q}\r\nf(x) = x\r\n`), ['`a`', '`b`']);
  });
});
