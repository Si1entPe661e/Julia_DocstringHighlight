// Grammar tests for the docstring injection: snapshots of every case, targeted checks of the scopes
// inside docstrings, the comparison with a .jl file (code) and a .md file (Markdown) that makes every
// theme color them alike, and the comparison with the host grammar alone outside docstrings.
//
// Update snapshots after reviewing a grammar change: UPDATE_SNAPSHOTS=1 npm run test:grammar
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { FIXTURES } from '../fixtureData';
import {
  CASES,
  ROOT,
  TokenType,
  loadJulia,
  loadMarkdown,
  scopesPerCharacter,
  snapshot,
  splitLines,
  tokenTypes,
  tokenize,
  type Token,
} from './harness';

const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';

function caseFiles(): string[] {
  return fs
    .readdirSync(CASES)
    .filter((f) => f.endsWith('.jl'))
    .sort();
}

interface Tokenized {
  source: string;
  tokens: Token[][];
}

async function tokenizeCase(file: string): Promise<Tokenized> {
  const source = fs.readFileSync(path.join(CASES, file), 'utf8');
  return { source, tokens: tokenize(await loadJulia(true), source) };
}

/** Line and column of the nth occurrence of `needle`. */
function find(source: string, needle: string, nth = 0): [number, number] {
  let seen = 0;
  const lines = splitLines(source);
  for (let line = 0; line < lines.length; line++) {
    const text = lines[line] ?? '';
    for (let col = text.indexOf(needle); col >= 0; col = text.indexOf(needle, col + 1)) {
      if (seen++ === nth) return [line, col];
    }
  }
  throw new Error(`"${needle}" (occurrence ${nth}) not found`);
}

/** Scopes of the token covering the first character of the nth occurrence of `needle`. */
function scopesAt({ source, tokens }: Tokenized, needle: string, nth = 0): string[] {
  const [line, col] = find(source, needle, nth);
  const token = tokens[line]?.find((t) => t.start <= col && col < t.end);
  assert.ok(token, `no token at "${needle}" (${line}:${col})`);
  return token.scopes;
}

/** Every scope used on a line. */
function lineScopes({ tokens }: Tokenized, line: number): Set<string> {
  return new Set((tokens[line] ?? []).flatMap((t) => t.scopes));
}

function has(scopes: string[], ...expected: string[]): void {
  for (const e of expected) assert.ok(scopes.includes(e), `expected ${e} in [${scopes.join(' ')}]`);
}

function lacks(scopes: Iterable<string>, ...unexpected: string[]): void {
  const list = [...scopes];
  for (const u of unexpected) {
    assert.ok(!list.some((s) => s === u || s.startsWith(u + '.')), `unexpected ${u} in [${list.join(' ')}]`);
  }
}

/** The scope of a whole docstring, and the one that makes its Markdown parts strings for the editor. */
const DOCSTRING = 'embed.docstring.julia';
const MARKDOWN_STRING = 'embed.docstring.string.julia';
/** Scopes this extension's grammar can introduce. */
const INJECTED = ['embed.docstring', 'text.html.markdown', 'markup', 'meta.paragraph', 'meta.embedded.block.julia', 'punctuation.definition.prompt.julia-repl'];
/** Julia code in a docstring: none of the Markdown or string scopes around it. */
const NOT_IN_CODE = ['string', 'text.html.markdown', MARKDOWN_STRING, 'markup', 'meta.paragraph', 'meta.embedded'];

describe('grammar snapshots', () => {
  for (const file of caseFiles()) {
    it(file, async () => {
      const t = await tokenizeCase(file);
      const actual = snapshot(t.source, t.tokens);
      const snapPath = path.join(CASES, file + '.snap');
      if (UPDATE || !fs.existsSync(snapPath)) {
        fs.writeFileSync(snapPath, actual);
        return;
      }
      assert.equal(actual, fs.readFileSync(snapPath, 'utf8'), `${file}.snap is out of date (UPDATE_SNAPSHOTS=1 to accept)`);
    });
  }
});

describe('grammar: docstring content', () => {
  it('heading.jl: headings are markup.heading, not strings', async () => {
    const t = await tokenizeCase('heading.jl');
    const heading = scopesAt(t, 'Arguments');
    has(heading, DOCSTRING, 'text.html.markdown', MARKDOWN_STRING, 'markup.heading.markdown', 'entity.name.section.markdown');
    lacks(heading, 'string');
    has(scopesAt(t, '# Arguments'), 'punctuation.definition.heading.markdown');
    has(scopesAt(t, 'Details'), 'markup.heading.markdown');
  });

  it('inline-code.jl: prose is a Markdown paragraph, inline code is markup.inline.raw', async () => {
    const t = await tokenizeCase('inline-code.jl');
    has(scopesAt(t, 'θ₀'), 'markup.inline.raw.string.markdown');
    has(scopesAt(t, '\\\\alpha'), 'markup.inline.raw.string.markdown');
    has(scopesAt(t, '`a`'), 'markup.inline.raw.string.markdown');
    has(scopesAt(t, '`b`'), 'markup.inline.raw.string.markdown');
    lacks(scopesAt(t, 'tick stays prose'), 'markup.inline.raw');
    const prose = scopesAt(t, 'Use ');
    has(prose, 'text.html.markdown', MARKDOWN_STRING, 'meta.paragraph.markdown');
    lacks(prose, 'string');
  });

  it('fence-unlabelled.jl: an unlabelled fence is Julia code', async () => {
    const t = await tokenizeCase('fence-unlabelled.jl');
    const code = scopesAt(t, 'optimize');
    has(code, DOCSTRING, 'support.function.julia');
    lacks(code, ...NOT_IN_CODE);
    has(scopesAt(t, '```'), 'text.html.markdown', 'markup.fenced_code.block.markdown', 'punctuation.definition.markdown');
  });

  it('fence-jldoctest.jl: julia> is a prompt, input and output are Julia', async () => {
    const t = await tokenizeCase('fence-jldoctest.jl');
    has(scopesAt(t, 'jldoctest'), 'fenced_code.block.language.markdown');
    const prompt = scopesAt(t, 'julia>');
    has(prompt, 'punctuation.definition.prompt.julia-repl');
    lacks(prompt, ...NOT_IN_CODE);
    has(scopesAt(t, 'foo(1)'), 'support.function.julia');
    const output = scopesAt(t, '2');
    lacks(output, ...NOT_IN_CODE);
    assert.ok(output.some((s) => s.startsWith('constant.numeric')), `output line: [${output.join(' ')}]`);
  });

  it('fence-julia-repl.jl and fence-at-example.jl are Julia', async () => {
    const repl = await tokenizeCase('fence-julia-repl.jl');
    has(scopesAt(repl, 'julia>'), 'punctuation.definition.prompt.julia-repl');
    has(scopesAt(repl, 'foo(2)'), 'support.function.julia');
    const example = await tokenizeCase('fence-at-example.jl');
    has(scopesAt(example, '@example'), 'fenced_code.block.language.markdown');
    const code = scopesAt(example, 'foo(3)');
    has(code, 'support.function.julia');
    lacks(code, ...NOT_IN_CODE);
  });

  it('fence-other.jl: other languages are plain text', async () => {
    const t = await tokenizeCase('fence-other.jl');
    has(scopesAt(t, 'math'), 'fenced_code.block.language.markdown');
    for (const needle of ['f(x)', 'print']) {
      const scopes = scopesAt(t, needle);
      has(scopes, 'markup.fenced_code.block.markdown', MARKDOWN_STRING);
      lacks(scopes, 'meta.embedded', 'support.function.julia');
    }
  });

  it('signature.jl: the four-space signature is Julia code', async () => {
    const t = await tokenizeCase('signature.jl');
    const code = scopesAt(t, 'run_mle');
    has(code, DOCSTRING, 'support.function.julia');
    lacks(code, ...NOT_IN_CODE);
    const prose = scopesAt(t, 'Runs MLE');
    has(prose, 'meta.paragraph.markdown');
    lacks(prose, 'markup.raw', 'meta.embedded');
  });

  it('admonition.jl: the first line is a heading, the body is prose', async () => {
    const t = await tokenizeCase('admonition.jl');
    has(scopesAt(t, '!!!'), MARKDOWN_STRING, 'punctuation.definition.heading.markdown');
    has(scopesAt(t, 'note'), 'markup.heading.markdown', 'entity.name.section.markdown');
    has(scopesAt(t, '"Title"'), 'markup.heading.markdown');
    const body = scopesAt(t, 'The body');
    has(body, 'meta.paragraph.markdown');
    lacks(body, 'markup.heading', 'markup.raw', 'meta.embedded');
    has(scopesAt(t, '`code`'), 'markup.inline.raw.string.markdown');
    has(scopesAt(t, 'warning'), 'markup.heading.markdown');
  });

  it('list.jl: markers, continuation lines and nesting', async () => {
    const t = await tokenizeCase('list.jl');
    has(scopesAt(t, '- first'), MARKDOWN_STRING, 'punctuation.definition.list.begin.markdown', 'markup.list.unnumbered.markdown');
    const continued = scopesAt(t, 'continued');
    has(continued, 'markup.list.unnumbered.markdown', 'meta.paragraph.markdown');
    lacks(continued, 'markup.raw', 'meta.embedded');
    has(scopesAt(t, '`item`'), 'markup.inline.raw.string.markdown');
    has(scopesAt(t, '1.'), 'punctuation.definition.list.begin.markdown', 'markup.list.numbered.markdown');
    lacks(scopesAt(t, 'After the list'), 'markup.list');
  });

  it('list-nesting.jl: nested lists, a heading ends the list, fences inside items', async () => {
    const t = await tokenizeCase('list-nesting.jl');
    has(scopesAt(t, '- nested'), 'punctuation.definition.list.begin.markdown');
    has(scopesAt(t, '`c`'), 'markup.inline.raw.string.markdown');
    const heading = scopesAt(t, 'Heading after list');
    has(heading, 'markup.heading.markdown');
    lacks(heading, 'markup.list');
    // Inside a list item, a fence is scoped as in a Markdown file.
    has(scopesAt(t, 'f(1)'), 'markup.list.unnumbered.markdown', 'meta.embedded.block.julia', 'support.function.julia');
    has(scopesAt(t, '- next'), 'punctuation.definition.list.begin.markdown');
  });

  it('escape-interp.jl: escapes and interpolation keep their Julia scopes', async () => {
    const t = await tokenizeCase('escape-interp.jl');
    has(scopesAt(t, '$(SIGNATURES)'), 'variable.interpolation.julia');
    has(scopesAt(t, '\\n'), 'meta.paragraph.markdown', 'constant.character.escape.julia');
    has(scopesAt(t, '\\$'), 'constant.character.escape.julia');
    has(scopesAt(t, '$(x)'), 'variable.interpolation.julia');
    has(scopesAt(t, '$x'), 'variable.interpolation.julia');
  });

  it('atdoc.jl: @doc bodies, `->` and a one-line @doc keep the host scopes on the quotes', async () => {
    const t = await tokenizeCase('atdoc.jl');
    has(scopesAt(t, '@doc'), DOCSTRING, 'string.docstring.julia', 'support.function.macro.julia');
    has(scopesAt(t, 'Heading'), 'markup.heading.markdown');
    has(scopesAt(t, '`code`'), 'markup.inline.raw.string.markdown');
    has(scopesAt(t, '->'), 'string.docstring.julia', 'keyword.operator.arrow.julia');
    lacks(lineScopes(t, 4), 'string', ...INJECTED);
    // A one-line @doc string: the text between the quotes is prose.
    has(scopesAt(t, 'one liner'), 'meta.paragraph.markdown');
    has(scopesAt(t, '`c`'), 'markup.inline.raw.string.markdown');
    has(scopesAt(t, '""" g'), 'punctuation.definition.string.end.julia');
    lacks(scopesAt(t, 'g', 1), 'string', ...INJECTED);
    lacks(lineScopes(t, 6), 'string', ...INJECTED);
  });

  it('body-start.jl: the body starts after a trailing space and after text on the opening line', async () => {
    const t = await tokenizeCase('body-start.jl');
    has(scopesAt(t, 'Heading after'), 'markup.heading.markdown');
    has(scopesAt(t, 'text on the same line'), 'meta.paragraph.markdown');
    has(scopesAt(t, 'Heading', 1), 'markup.heading.markdown');
  });

  it('atdoc-raw.jl: @doc raw has Markdown and Julia but no escapes or interpolation', async () => {
    const t = await tokenizeCase('atdoc-raw.jl');
    has(scopesAt(t, '@doc'), 'embed.docstring.raw.julia', 'string.docstring.julia', 'support.function.macro.julia');
    const code = scopesAt(t, 'kl(p, q)');
    has(code, 'support.function.julia');
    lacks(code, ...NOT_IN_CODE);
    has(scopesAt(t, '``\\sum'), 'markup.inline.raw.string.markdown');
    for (const literal of ['$x$', '\\$', 'dollars', '\\alpha']) {
      const scopes = scopesAt(t, literal);
      has(scopes, 'meta.paragraph.markdown');
      lacks(scopes, 'variable.interpolation', 'constant.character.escape');
    }
    has(scopesAt(t, 'julia>'), 'punctuation.definition.prompt.julia-repl');
    // One line: the quotes after a backslash are escaped, the last ones close the docstring.
    has(scopesAt(t, 'quotes stay inside'), 'meta.paragraph.markdown');
    has(scopesAt(t, '""" g'), 'punctuation.definition.string.end.julia');
    lacks(lineScopes(t, 10), 'string', ...INJECTED);
    lacks(lineScopes(t, 12), 'string', ...INJECTED);
  });

  it('atdoc-single.jl: @doc "…" and @doc raw"…" end at the first unescaped quote', async () => {
    const t = await tokenizeCase('atdoc-single.jl');
    has(scopesAt(t, 'Short'), DOCSTRING, 'meta.paragraph.markdown');
    has(scopesAt(t, '`doc`'), 'markup.inline.raw.string.markdown');
    has(scopesAt(t, '\\"'), 'constant.character.escape.julia');
    has(scopesAt(t, '$(x)'), 'variable.interpolation.julia');
    has(scopesAt(t, '" f'), 'punctuation.definition.string.end.julia');
    has(scopesAt(t, 'Two lines'), 'meta.paragraph.markdown');
    has(scopesAt(t, '`a`'), 'markup.inline.raw.string.markdown');
    has(scopesAt(t, '" g'), 'punctuation.definition.string.end.julia');
    const raw = scopesAt(t, '$x$');
    has(raw, 'embed.docstring.raw.julia', 'meta.paragraph.markdown');
    lacks(raw, 'variable.interpolation');
    lacks(scopesAt(t, '\\alpha'), 'constant.character.escape');
    has(scopesAt(t, '"plain"'), 'string.quoted.double.julia');
    lacks(lineScopes(t, 4), ...INJECTED);
  });

  it('text-after-quotes.jl: text on the line of the opening quotes, at the start of a line', async () => {
    const t = await tokenizeCase('text-after-quotes.jl');
    has(scopesAt(t, 'Starts on the opening line'), DOCSTRING, 'meta.paragraph.markdown');
    has(scopesAt(t, 'Heading'), 'markup.heading.markdown');
    has(scopesAt(t, 'One line with'), 'meta.paragraph.markdown');
    has(scopesAt(t, 'One line.'), 'meta.paragraph.markdown');
    has(scopesAt(t, '# with a comment'), 'comment.line.number-sign.julia');
    // Followed by code, or not at the start of the line: an ordinary string.
    for (const line of [9, 10, 11]) lacks(lineScopes(t, line), ...INJECTED);
    has(scopesAt(t, 'not a docstring'), 'string.quoted.triple.double.julia');
    has(scopesAt(t, 'continues'), 'string.quoted.triple.double.julia');
  });

  it('crlf.jl: same as heading.jl with CRLF line endings', async () => {
    const t = await tokenizeCase('crlf.jl');
    has(scopesAt(t, 'Arguments'), 'markup.heading.markdown');
    const code = scopesAt(t, 'heading(x)');
    has(code, DOCSTRING, 'support.function.julia');
    lacks(code, ...NOT_IN_CODE);
    lacks(lineScopes(t, 7), 'string', ...INJECTED);
  });
});

describe('grammar: scoped like a .jl file and a .md file', () => {
  /** Scopes without the ones this grammar adds around code and Markdown. */
  const bare = (scopes: string[] | undefined): string[] | undefined => scopes?.filter((s) => s !== DOCSTRING && s !== MARKDOWN_STRING);

  it('Julia code has exactly the scopes of the same code in a .jl file', async () => {
    const docstring = [
      '"""',
      '    solve(prob::Problem, x₀; tol = 1e-8) -> Vector{Float64}',
      '',
      '```julia',
      'x = solve(prob, [1.0, 2.0]; tol = 1e-6)',
      'for i in 1:3 # comment',
      '    @show "i = $i" i^2',
      'end',
      '```',
      '',
      '```jldoctest',
      'julia> sum(abs2, [1, 2])',
      '5',
      '```',
      '"""',
      'solve(x) = x',
    ];
    // Code lines and the prefix (indentation, prompt) that is not part of the code.
    const code: Array<[number, number]> = [
      [1, 4],
      [4, 0],
      [5, 0],
      [6, 0],
      [7, 0],
      [11, 7],
      [12, 0],
    ];
    const source = docstring.join('\n');
    const inDocstring = scopesPerCharacter(tokenize(await loadJulia(true), source));
    const jl = code.map(([line, prefix]) => (docstring[line] ?? '').slice(prefix)).join('\n');
    const inJl = scopesPerCharacter(tokenize(await loadJulia(false), jl));
    code.forEach(([line, prefix], i) => {
      const text = docstring[line] ?? '';
      for (let col = prefix; col < text.length; col++) {
        const scopes = inDocstring[line]?.[col];
        assert.equal(scopes?.[1], DOCSTRING, `${line}:${col} is not in the docstring`);
        assert.deepEqual(bare(scopes), inJl[i]?.[col - prefix], `${line}:${col} (${text[col]}) differs from the .jl file`);
      }
    });
  });

  it('Markdown has exactly the scopes of the same Markdown in a .md file', async () => {
    const markdown = [
      'Some *emphasis*, **strong**, `code`, [a link](https://julialang.org) and [`Ref`](@ref).',
      '',
      '# Heading',
      '## Heading with `code`',
      '',
      '- item `a`',
      '  continued *here*',
      '  - nested **b**',
      '1. numbered',
      '2) second',
      '   ```julia',
      '   f(1)',
      '   ```',
      '',
      '```text',
      'plain `x`',
      '```',
      'Last line.',
    ];
    const source = ['"""', ...markdown.slice(0, -1), markdown[markdown.length - 1] + '"""', 'f(x) = x'].join('\n');
    const inDocstring = scopesPerCharacter(tokenize(await loadJulia(true), source));
    const inMd = scopesPerCharacter(tokenize(await loadMarkdown(), markdown.join('\n')));
    markdown.forEach((text, i) => {
      // The Markdown grammar scopes an unknown fence label differently; the label is not compared.
      const skip = text.startsWith('```text') ? [3, text.length] : [0, 0];
      for (let col = 0; col < text.length; col++) {
        if (col >= (skip[0] ?? 0) && col < (skip[1] ?? 0)) continue;
        const scopes = inDocstring[i + 1]?.[col];
        assert.deepEqual(scopes?.slice(0, 2), ['source.julia', DOCSTRING], `${i + 1}:${col} is not in the docstring`);
        assert.deepEqual(bare(scopes)?.slice(1), inMd[i]?.[col], `${i + 1}:${col} (${text[col]}) differs from the .md file`);
      }
    });
  });

  it('Markdown is a string for the editor, code is code', async () => {
    const source = ['"""', '    f(x)', '', 'Text with `code` (and brackets).', '# Heading', '- item', '```julia', 'g(y)', '```', '"""', 'f(x) = x'].join('\n');
    const types = tokenTypes(await loadJulia(true), source);
    const typeAt = (needle: string): number | undefined => {
      const [line, col] = find(source, needle);
      return types[line]?.[col];
    };
    for (const needle of ['"""', 'Text', 'brackets', '`code`', 'Heading', '- item', 'item', '```julia']) {
      assert.equal(typeAt(needle), TokenType.String, `${needle} should be a string`);
    }
    for (const needle of ['f(x)', 'g(y)']) assert.equal(typeAt(needle), TokenType.Other, `${needle} should be code`);
  });
});

describe('grammar: safety rules', () => {
  /** The closing quotes on `closingLine` end the docstring, and `codeLines` are untouched code. */
  const closesCleanly = (t: Tokenized, closingLine: number, codeLines: number[]): void => {
    has(scopesAt(t, '"""', countQuotesBefore(t, closingLine)), 'punctuation.definition.string.end.julia');
    for (const line of codeLines) lacks(lineScopes(t, line), 'string.docstring', ...INJECTED);
  };
  /** Index of the `"""` occurrence that starts on `line`, counting from the top of the file. */
  const countQuotesBefore = (t: Tokenized, line: number): number =>
    splitLines(t.source)
      .slice(0, line)
      .reduce((n, text) => n + (text.match(/"""/g)?.length ?? 0), 0);

  it('closing-delimiter.jl: the code after the docstring is plain Julia', async () => {
    const t = await tokenizeCase('closing-delimiter.jl');
    closesCleanly(t, 2, [3, 4, 5]);
    has(scopesAt(t, 'function'), 'keyword.other.julia');
  });

  it('unclosed-fence.jl: an open fence ends with the docstring', async () => {
    const t = await tokenizeCase('unclosed-fence.jl');
    closesCleanly(t, 5, [6, 7, 8]);
    has(scopesAt(t, '"abc"'), 'string.quoted.double.julia');
  });

  it('unclosed-quote-in-example.jl: an open quote in an example ends with the fence', async () => {
    const t = await tokenizeCase('unclosed-quote-in-example.jl');
    const after = scopesAt(t, 'After fence.');
    has(after, 'meta.paragraph.markdown');
    lacks(after, 'string.quoted', 'meta.embedded');
    closesCleanly(t, 5, [6]);
  });

  it('escaped-triple-in-example.jl: \\"\\"\\" in an example does not end the docstring', async () => {
    const t = await tokenizeCase('escaped-triple-in-example.jl');
    has(scopesAt(t, 'tail'), 'meta.paragraph.markdown');
    has(scopesAt(t, '`code`'), 'markup.inline.raw.string.markdown');
    closesCleanly(t, 5, [6]);
  });

  it('closing-backslashes.jl: an even number of backslashes before """ does not escape it', async () => {
    const t = await tokenizeCase('closing-backslashes.jl');
    closesCleanly(t, 2, [3]);
    has(scopesAt(t, 'The quotes after one'), 'meta.paragraph.markdown');
    has(scopesAt(t, 'and the docstring goes on'), 'meta.paragraph.markdown');
    closesCleanly(t, 8, [9]);
  });

  it('indented-closing.jl: an indented closing """ ends lists and code blocks', async () => {
    const t = await tokenizeCase('indented-closing.jl');
    has(scopesAt(t, 'item one'), 'markup.list.unnumbered.markdown');
    closesCleanly(t, 3, [4]);
  });

  it('same-line-closing.jl: text before the closing quotes is prose', async () => {
    const t = await tokenizeCase('same-line-closing.jl');
    const last = scopesAt(t, 'Last line.');
    has(last, DOCSTRING, 'meta.paragraph.markdown');
    lacks(last, 'string');
    has(scopesAt(t, 'First line.'), 'meta.paragraph.markdown');
    closesCleanly(t, 2, [3]);
  });

  it('one-liner.jl: a one-line """…""" at the start of a line is a docstring', async () => {
    const t = await tokenizeCase('one-liner.jl');
    has(scopesAt(t, 'doc with'), DOCSTRING, 'meta.paragraph.markdown');
    has(scopesAt(t, '`code`'), 'markup.inline.raw.string.markdown');
    lacks(lineScopes(t, 1), ...INJECTED);
  });

  it('plain-multiline.jl: an ordinary multi-line string gets nothing', async () => {
    const t = await tokenizeCase('plain-multiline.jl');
    for (let line = 0; line < 5; line++) lacks(lineScopes(t, line), 'string.docstring', ...INJECTED);
    has(scopesAt(t, 'not a heading'), 'string.quoted.triple.double.julia');
  });

  it('indented-docstring.jl: an indented docstring is left to the host, as in the Julia grammar', async () => {
    const t = await tokenizeCase('indented-docstring.jl');
    for (let line = 0; line < 6; line++) lacks(lineScopes(t, line), ...INJECTED);
  });
});

describe('grammar: backslashes before the closing quotes', () => {
  // `tail`, n backslashes, `"""`. With an even n the backslashes escape each other and the quotes close
  // the string on that line; with an odd n the first quote is escaped and the string goes on to the
  // `"""` in the last line, which is a comment when the string is already closed.
  const contexts: Array<[string, string]> = [
    ['prose', '"""\ntext\ntail{}"""'],
    ['fence', '"""\n```julia\nx = 1\ntail{}"""'],
    ['list', '"""\n- item\n  tail{}"""'],
    ['@doc on one line', '@doc """tail{}""" f'],
  ];
  for (const [context, template] of contexts) {
    for (let n = 0; n <= 4; n++) {
      it(`${context}, ${n} backslash${n === 1 ? '' : 'es'}`, async () => {
        const source = template.replace('{}', '\\'.repeat(n)) + '\nf(x) = x\nafter = 42 # """\n';
        const lines = splitLines(source);
        const tail = lines.findIndex((l) => l.includes('tail'));
        const closing = n % 2 === 0 ? tail : lines.length - 2;
        const host = scopesPerCharacter(tokenize(await loadJulia(false), source));
        const injected = scopesPerCharacter(tokenize(await loadJulia(true), source));
        // The host grammar alone closes the string at the same quotes: from there on, every character
        // has its scopes (the quotes themselves inside this grammar's docstring scope).
        const quotes = n % 2 === 0 ? (lines[tail] ?? '').lastIndexOf('"""') : (lines[closing] ?? '').indexOf('"""');
        for (let line = closing; line < lines.length; line++) {
          const from = line === closing ? quotes : 0;
          const actual = (injected[line] ?? []).slice(from).map((s) => s.filter((x) => x !== DOCSTRING));
          assert.deepEqual(actual, (host[line] ?? []).slice(from), `line ${line} differs from the host grammar`);
        }
        has(injected[closing]?.[quotes] ?? [], DOCSTRING, 'punctuation.definition.string.end.julia');
        // Escaped quotes do not end the docstring.
        for (let line = tail; line <= closing; line++) {
          const start = line === tail ? (lines[tail] ?? '').indexOf('tail') : 0;
          const chars = injected[line]?.slice(start, line === closing ? quotes : undefined) ?? [];
          assert.ok(chars.every((s) => s.includes(DOCSTRING)), `line ${line} is not in the docstring`);
        }
      });
    }
  }
});

describe('grammar: identical to the host grammar outside docstrings', () => {
  const sources = (): Array<[string, string]> => [
    ['showcase.jl', path.join(FIXTURES, 'showcase.jl')],
    ['markdown.jl', path.join(FIXTURES, 'markdown.jl')],
    ['doctest.jl', path.join(FIXTURES, 'doctest.jl')],
    ['atdoc.jl', path.join(FIXTURES, 'atdoc.jl')],
    ...caseFiles().map((f): [string, string] => [f, path.join(CASES, f)]),
  ];
  for (const [name, file] of sources()) {
    it(name, async () => {
      const source = fs.readFileSync(file, 'utf8');
      const plain = scopesPerCharacter(tokenize(await loadJulia(false), source));
      const injected = scopesPerCharacter(tokenize(await loadJulia(true), source));
      const lines = splitLines(source);
      plain.forEach((chars, line) => {
        chars.forEach((scopes, col) => {
          const taken = injected[line]?.[col]?.[1]?.startsWith('embed.docstring') ?? false;
          if (scopes.includes('string.docstring.julia')) {
            // Taken over: the same docstring, under this grammar's scope.
            assert.ok(taken, `${name} ${line}:${col} is not in a docstring`);
          } else if (taken) {
            // A docstring form that the host leaves to its string rules: a string, @doc before it, or spaces.
            assert.ok(
              scopes.some((s) => s.startsWith('string.') || s.startsWith('support.function.macro')) || /\s/.test(lines[line]?.[col] ?? ''),
              `${name} ${line}:${col} is taken over but is not a string: [${scopes.join(' ')}]`,
            );
          } else {
            assert.deepEqual(injected[line]?.[col], scopes, `${name} ${line}:${col} differs from the host grammar`);
          }
        });
      });
    });
  }
});

describe('grammar: the host grammar', () => {
  interface RawRule {
    name?: string;
    begin?: string;
    end?: string;
  }
  const read = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')) as T;

  it('the official extension registers no grammar that injects into Julia strings', () => {
    const sources = read<{ julia: { contributedGrammars: Array<{ scopeName: string; path: string; injectTo?: string[] }> } }>(
      'test/grammars/SOURCES.json',
    );
    const offenders = sources.julia.contributedGrammars.filter(
      (g) => g.injectTo?.includes('source.julia') || /docstring/i.test(g.path),
    );
    assert.deepEqual(offenders, [], 'julialang.language-julia registers a docstring injection again, which would compete with this one');
  });

  it('still has the two docstring rules that this grammar takes over, with the same begin and end', () => {
    const julia = read<{ repository: { string: { patterns: RawRule[] } } }>('test/grammars/julia_vscode.json');
    const ours = read<{ repository: Record<string, RawRule> }>('syntaxes/julia-docstring.injection.tmLanguage.json');
    const hostRules = julia.repository.string.patterns.filter((r) => r.name === 'string.docstring.julia');
    assert.deepEqual(
      hostRules.map((r) => [r.begin, r.end]),
      ['docstring-macro', 'docstring'].map((k) => [ours.repository[k]?.begin, ours.repository[k]?.end]),
    );
  });

  it('still provides what this grammar includes', () => {
    const julia = read<{ repository: Record<string, unknown> }>('test/grammars/julia_vscode.json');
    const markdown = read<{ repository: Record<string, unknown> }>('test/grammars/markdown.tmLanguage.json');
    for (const rule of ['string_escaped_char', 'string_dollar_sign_interpolate']) assert.ok(julia.repository[rule], rule);
    for (const rule of ['heading', 'inline']) assert.ok(markdown.repository[rule], rule);
    assert.equal(JSON.stringify(julia).match(/"string\.docstring\.julia"/g)?.length, 2, 'two string.docstring.julia rules');
  });
});
