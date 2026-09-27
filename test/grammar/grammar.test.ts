// Grammar tests for the docstring injection (06 §3): snapshots of every case, the targeted checks of
// 06 §3.2, and the comparison with the host grammar alone (06 §3.3, acceptance J).
//
// Update snapshots after reviewing a grammar change: UPDATE_SNAPSHOTS=1 npm run test:grammar
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { FIXTURES } from '../fixtureData';
import { CASES, ROOT, loadJulia, scopesPerCharacter, snapshot, splitLines, tokenize, type Token } from './harness';

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

/** Scopes of the token covering the first character of the nth occurrence of `needle`. */
function scopesAt({ source, tokens }: Tokenized, needle: string, nth = 0): string[] {
  let seen = 0;
  const lines = splitLines(source);
  for (let line = 0; line < lines.length; line++) {
    const text = lines[line] ?? '';
    for (let col = text.indexOf(needle); col >= 0; col = text.indexOf(needle, col + 1)) {
      if (seen++ !== nth) continue;
      const token = tokens[line]?.find((t) => t.start <= col && col < t.end);
      assert.ok(token, `no token at "${needle}" (${line}:${col})`);
      return token.scopes;
    }
  }
  throw new Error(`"${needle}" (occurrence ${nth}) not found`);
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

/** Scopes this extension's grammar can introduce. */
const INJECTED = ['text.docstring.julia', 'markup', 'meta.embedded.block.julia', 'punctuation.definition.prompt.julia-repl'];

describe('grammar snapshots (06 §3)', () => {
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

describe('grammar: docstring content (06 §3.2)', () => {
  it('heading.jl: headings are markup.heading (acceptance D)', async () => {
    const t = await tokenizeCase('heading.jl');
    has(scopesAt(t, 'Arguments'), 'string.docstring.julia', 'text.docstring.julia', 'markup.heading.markdown', 'entity.name.section.markdown');
    has(scopesAt(t, '# Arguments'), 'punctuation.definition.heading.markdown');
    has(scopesAt(t, 'Details'), 'markup.heading.markdown');
  });

  it('inline-code.jl: inline code is markup.inline.raw (acceptance E)', async () => {
    const t = await tokenizeCase('inline-code.jl');
    has(scopesAt(t, 'θ₀'), 'markup.inline.raw.string.markdown');
    has(scopesAt(t, '\\\\alpha'), 'markup.inline.raw.string.markdown');
    has(scopesAt(t, '`a`'), 'markup.inline.raw.string.markdown');
    has(scopesAt(t, '`b`'), 'markup.inline.raw.string.markdown');
    lacks(scopesAt(t, 'tick stays prose'), 'markup.inline.raw');
    has(scopesAt(t, 'Use '), 'text.docstring.julia');
  });

  it('fence-unlabelled.jl: an unlabelled fence is Julia (acceptance F)', async () => {
    const t = await tokenizeCase('fence-unlabelled.jl');
    has(scopesAt(t, 'optimize'), 'markup.fenced_code.block.markdown', 'meta.embedded.block.julia', 'support.function.julia');
    has(scopesAt(t, '```'), 'punctuation.definition.markdown');
  });

  it('fence-jldoctest.jl: julia> is a prompt, input and output are Julia (acceptance G)', async () => {
    const t = await tokenizeCase('fence-jldoctest.jl');
    has(scopesAt(t, 'jldoctest'), 'fenced_code.block.language.markdown');
    has(scopesAt(t, 'julia>'), 'punctuation.definition.prompt.julia-repl', 'meta.embedded.block.julia');
    has(scopesAt(t, 'foo(1)'), 'meta.embedded.block.julia', 'support.function.julia');
    const output = scopesAt(t, '2');
    has(output, 'meta.embedded.block.julia');
    assert.ok(output.some((s) => s.startsWith('constant.numeric')), `output line: [${output.join(' ')}]`);
  });

  it('fence-julia-repl.jl and fence-at-example.jl are Julia', async () => {
    const repl = await tokenizeCase('fence-julia-repl.jl');
    has(scopesAt(repl, 'julia>'), 'punctuation.definition.prompt.julia-repl');
    has(scopesAt(repl, 'foo(2)'), 'meta.embedded.block.julia', 'support.function.julia');
    const example = await tokenizeCase('fence-at-example.jl');
    has(scopesAt(example, '@example'), 'fenced_code.block.language.markdown');
    has(scopesAt(example, 'foo(3)'), 'meta.embedded.block.julia', 'support.function.julia');
  });

  it('fence-other.jl: other languages are plain text', async () => {
    const t = await tokenizeCase('fence-other.jl');
    has(scopesAt(t, 'math'), 'fenced_code.block.language.markdown');
    for (const needle of ['f(x)', 'print']) {
      const scopes = scopesAt(t, needle);
      has(scopes, 'markup.raw.block.markdown');
      lacks(scopes, 'meta.embedded.block.julia', 'support.function.julia');
    }
  });

  it('signature.jl: the four-space signature is Julia', async () => {
    const t = await tokenizeCase('signature.jl');
    has(scopesAt(t, 'run_mle'), 'markup.raw.block.markdown', 'meta.embedded.block.julia', 'support.function.julia');
    const prose = scopesAt(t, 'Runs MLE');
    has(prose, 'text.docstring.julia');
    lacks(prose, 'markup.raw', 'meta.embedded.block.julia');
  });

  it('admonition.jl: the first line is a heading, the body is prose', async () => {
    const t = await tokenizeCase('admonition.jl');
    has(scopesAt(t, '!!!'), 'punctuation.definition.heading.markdown');
    has(scopesAt(t, 'note'), 'markup.heading.markdown', 'entity.name.section.markdown');
    has(scopesAt(t, '"Title"'), 'markup.heading.markdown');
    const body = scopesAt(t, 'The body');
    has(body, 'text.docstring.julia');
    lacks(body, 'markup.heading', 'markup.raw', 'meta.embedded.block.julia');
    has(scopesAt(t, '`code`'), 'markup.inline.raw.string.markdown');
    has(scopesAt(t, 'warning'), 'markup.heading.markdown');
  });

  it('list.jl: markers, continuation lines and nesting', async () => {
    const t = await tokenizeCase('list.jl');
    has(scopesAt(t, '- first'), 'punctuation.definition.list.begin.markdown', 'markup.list.unnumbered.markdown');
    const continued = scopesAt(t, 'continued');
    has(continued, 'markup.list.unnumbered.markdown', 'text.docstring.julia');
    lacks(continued, 'markup.raw', 'meta.embedded.block.julia');
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
    has(scopesAt(t, 'f(1)'), 'meta.embedded.block.julia', 'support.function.julia');
    has(scopesAt(t, '- next'), 'punctuation.definition.list.begin.markdown');
  });

  it('escape-interp.jl: escapes and interpolation keep their Julia scopes', async () => {
    const t = await tokenizeCase('escape-interp.jl');
    has(scopesAt(t, '$(SIGNATURES)'), 'variable.interpolation.julia');
    has(scopesAt(t, '\\n'), 'constant.character.escape.julia');
    has(scopesAt(t, '\\$'), 'constant.character.escape.julia');
    has(scopesAt(t, '$(x)'), 'variable.interpolation.julia');
    has(scopesAt(t, '$x'), 'variable.interpolation.julia');
  });

  it('atdoc.jl: @doc bodies get the injection, `->` keeps the host scope', async () => {
    const t = await tokenizeCase('atdoc.jl');
    has(scopesAt(t, 'Heading'), 'markup.heading.markdown');
    has(scopesAt(t, '`code`'), 'markup.inline.raw.string.markdown');
    has(scopesAt(t, '->'), 'keyword.operator.arrow.julia');
    lacks(lineScopes(t, 4), 'string', ...INJECTED);
    // A one-line @doc string: the host closes it itself, the body never starts.
    lacks(lineScopes(t, 5), ...INJECTED);
    lacks(lineScopes(t, 6), 'string', ...INJECTED);
  });

  it('body-start.jl: the body starts after a trailing space and after text on the opening line', async () => {
    const t = await tokenizeCase('body-start.jl');
    has(scopesAt(t, 'Heading after'), 'markup.heading.markdown');
    has(scopesAt(t, 'text on the same line'), 'text.docstring.julia');
    has(scopesAt(t, 'Heading', 1), 'markup.heading.markdown');
  });

  it('crlf.jl: same as heading.jl with CRLF line endings', async () => {
    const t = await tokenizeCase('crlf.jl');
    has(scopesAt(t, 'Arguments'), 'markup.heading.markdown');
    has(scopesAt(t, 'heading(x)'), 'meta.embedded.block.julia');
    lacks(lineScopes(t, 7), 'string', ...INJECTED);
  });
});

describe('grammar: safety rules (04 §4, acceptance J)', () => {
  /** The closing quotes on `closingLine` end the string, and `codeLines` are untouched code. */
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
    has(after, 'text.docstring.julia');
    lacks(after, 'string.quoted', 'meta.embedded.block.julia');
    closesCleanly(t, 5, [6]);
  });

  it('escaped-triple-in-example.jl: \\"\\"\\" in an example does not end the docstring', async () => {
    const t = await tokenizeCase('escaped-triple-in-example.jl');
    has(scopesAt(t, 'tail'), 'text.docstring.julia');
    has(scopesAt(t, '`code`'), 'markup.inline.raw.string.markdown');
    closesCleanly(t, 5, [6]);
  });

  it('closing-backslashes.jl: an even number of backslashes before """ does not escape it', async () => {
    const t = await tokenizeCase('closing-backslashes.jl');
    closesCleanly(t, 2, [3]);
    has(scopesAt(t, 'The quotes after one'), 'text.docstring.julia');
    has(scopesAt(t, 'and the docstring goes on'), 'text.docstring.julia');
    closesCleanly(t, 8, [9]);
  });

  it('indented-closing.jl: an indented closing """ ends lists and code blocks', async () => {
    const t = await tokenizeCase('indented-closing.jl');
    has(scopesAt(t, 'item one'), 'markup.list.unnumbered.markdown');
    closesCleanly(t, 3, [4]);
  });

  it('same-line-closing.jl: text before the closing quotes belongs to the host string', async () => {
    const t = await tokenizeCase('same-line-closing.jl');
    const last = scopesAt(t, 'Last line.');
    has(last, 'string.docstring.julia');
    lacks(last, ...INJECTED);
    has(scopesAt(t, 'First line.'), 'text.docstring.julia');
    closesCleanly(t, 2, [3]);
  });

  it('one-liner.jl: a one-line docstring is left to the host', async () => {
    const t = await tokenizeCase('one-liner.jl');
    for (let line = 0; line < 2; line++) lacks(lineScopes(t, line), ...INJECTED);
  });

  it('plain-multiline.jl: an ordinary multi-line string gets nothing', async () => {
    const t = await tokenizeCase('plain-multiline.jl');
    for (let line = 0; line < 5; line++) lacks(lineScopes(t, line), 'string.docstring', ...INJECTED);
    has(scopesAt(t, 'not a heading'), 'string.quoted.triple.double.julia');
  });

  it('indented-docstring.jl: an indented docstring is not injected (03 §8)', async () => {
    const t = await tokenizeCase('indented-docstring.jl');
    for (let line = 0; line < 6; line++) lacks(lineScopes(t, line), ...INJECTED);
  });
});

describe('grammar: backslashes before the closing quotes (04 §4)', () => {
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
        // The host grammar alone closes the string: from the closing line on, every character must
        // have exactly its scopes.
        for (let line = closing; line < lines.length; line++) {
          assert.deepEqual(injected[line], host[line], `line ${line} differs from the host grammar`);
        }
        // Escaped quotes do not end the body.
        for (let line = tail; line < closing; line++) {
          const chars = injected[line]?.slice(line === tail ? (lines[tail] ?? '').indexOf('tail') : 0) ?? [];
          assert.ok(chars.every((s) => s.includes('text.docstring.julia')), `line ${line} is not docstring prose`);
        }
      });
    }
  }
});

describe('grammar: identical to the host grammar outside strings (06 §3.3)', () => {
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
      plain.forEach((chars, line) => {
        chars.forEach((scopes, col) => {
          if (scopes.some((s) => s.startsWith('string.'))) return;
          assert.deepEqual(injected[line]?.[col], scopes, `${name} ${line}:${col} differs from the host grammar`);
        });
      });
    });
  }
});

describe('grammar: no competing docstring injection (07 §9)', () => {
  it('the official extension registers no grammar that injects into Julia strings', () => {
    const sources = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/grammars/SOURCES.json'), 'utf8')) as {
      julia: { contributedGrammars: Array<{ scopeName: string; path: string; injectTo?: string[] }> };
    };
    const offenders = sources.julia.contributedGrammars.filter(
      (g) => g.injectTo?.includes('source.julia') || /docstring/i.test(g.path),
    );
    assert.deepEqual(offenders, [], 'julialang.language-julia registers a docstring injection again: see 07 §9');
  });

  it('the host grammar still provides what the injection relies on (04 §4 rule 5)', () => {
    const julia = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/grammars/julia_vscode.json'), 'utf8')) as {
      repository: Record<string, unknown>;
    };
    const markdown = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/grammars/markdown.tmLanguage.json'), 'utf8')) as {
      repository: Record<string, unknown>;
    };
    for (const rule of ['string_escaped_char', 'string_dollar_sign_interpolate']) assert.ok(julia.repository[rule], rule);
    for (const rule of ['heading', 'inline']) assert.ok(markdown.repository[rule], rule);
    assert.equal(JSON.stringify(julia).match(/"string\.docstring\.julia"/g)?.length, 2, 'two string.docstring.julia rules');
  });
});
