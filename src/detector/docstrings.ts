// Docstring detection on top of the lexer.
//
// A string literal is a docstring when it forms a statement of its own (bracket depth 0, after the
// start of the file, a `;`, or a newline that follows a complete expression) in a block where Julia
// parses docstrings, and is followed on the same line, or after exactly one newline, by a token that
// does not close a block. `@doc` forms accept any string literal (including `raw"…"`) and the
// `@doc str ->` newline `target` form. Blocks are tracked by their keywords and `end`.

import {
  isAssignmentAt,
  isPublicKeyword,
  Kw,
  Lexer,
  operatorStandsAlone,
  Prefix,
  prefixOperator,
  startsOperand,
  Tok,
} from './scanner';
import type { RawDocstring } from './types';

/** Category of the previous significant token, for statement-start decisions. */
const enum Prev {
  BOF,
  /** `;`, `begin`, `quote`: a statement starts even without a newline. */
  SEMI,
  /** The previous token can end an expression (identifier, literal, `)`, `end`, …). */
  ENDER,
  /** The expression continues on the next line (operator, `(`, `,`, `function`, …). */
  CONT,
}

/** Tracks `ident(.ident)*.` at the start of a statement, for `Base.@doc` / `Core.@doc`. */
const enum Chain {
  None,
  Start,
  Ident,
  Dot,
}

/** A block that is open at the current token. */
interface OpenBlock {
  /** Its statements can be docstrings: `module`, `baremodule`, `begin`, `quote`. */
  docs: boolean;
  /** Leading whitespace of the line with the block keyword. */
  indent: number;
}

const CH_TAB = 0x09;
const CH_LF = 0x0a;
const CH_CR = 0x0d;
const CH_SPACE = 0x20;
const CH_LPAREN = 0x28;

export function findDocstrings(text: string): RawDocstring[] {
  const first = runPass(text, null);
  if (first.unclosed.length === 0) return first.docstrings;
  // Unbalanced brackets (typically while typing) would hide every docstring after the unclosed
  // opener. Those openers are exactly the ones left on the stack at EOF, so a second pass that does
  // not count them restores the rest of the file without changing any other bracket pairing.
  return runPass(text, new Set(first.unclosed)).docstrings;
}

interface PassResult {
  docstrings: RawDocstring[];
  unclosed: number[];
}

function runPass(text: string, ignoredOpeners: ReadonlySet<number> | null): PassResult {
  const lexer = new Lexer(text);
  const docstrings: RawDocstring[] = [];
  const openers: number[] = [];
  const blocks: OpenBlock[] = [];
  const lines = new LineStarts(text);
  let prev = Prev.BOF;
  let newline = false;
  let stmtStart = 0;
  let chain = Chain.None;
  let atDocStart = -1;
  /** Start of the run of operator characters (`==`, `>:`, `.+`) that the last token ends, or -1. */
  let runStart = -1;
  /** That run stands where an operand is expected. */
  let runOperand = false;
  /** The last token completes the expression if the line ends after it. */
  let atomAtLineEnd = false;

  for (;;) {
    const k = lexer.next();
    if (k === Tok.EOF) break;
    if (k === Tok.NEWLINE) {
      // An operator where an operand is expected, with nothing after it on the line, is a value of
      // its own (JuliaSyntax parses `+` followed by a newline as the atom `+`): `==` alone as the
      // target of a docstring, `import Base: ^`, `const ≤ = <=`. The next line starts a statement.
      if (atomAtLineEnd) prev = Prev.ENDER;
      atomAtLineEnd = false;
      runStart = -1;
      newline = true;
      atDocStart = -1;
      continue;
    }
    const depth = openers.length;
    const atStatementStart: boolean =
      depth === 0 && (prev === Prev.BOF || prev === Prev.SEMI || (newline && prev === Prev.ENDER));
    const operandExpected: boolean = atStatementStart || prev !== Prev.ENDER;
    if (atStatementStart) {
      stmtStart = lexer.start;
      chain = Chain.Start;
    }

    let pendingAtDoc = -1;
    let next: Prev;
    switch (k) {
      case Tok.STRING:
        if (depth === 0 && lexer.terminated) {
          if (atDocStart >= 0) {
            addCandidate(docstrings, text, lexer, 'atdoc', atDocStart);
          } else if (atStatementStart && lexer.prefixStart < 0 && inDocstringBlock(blocks, lines, lexer.start)) {
            addCandidate(docstrings, text, lexer, 'plain', lexer.start);
          }
        }
        next = Prev.ENDER;
        break;
      case Tok.MACRO:
        if (lexer.isDocMacro && depth === 0 && (atStatementStart || (chain === Chain.Dot && !lexer.spaceBefore))) {
          const start = atStatementStart ? lexer.start : stmtStart;
          if (text.charCodeAt(lexer.end) === CH_LPAREN) addCallForm(docstrings, text, lexer.end, start);
          else pendingAtDoc = start;
        }
        next = Prev.ENDER;
        break;
      case Tok.IDENT:
        if (depth === 0) trackBlock(blocks, lines, lexer);
        next =
          atStatementStart && lexer.kw === Kw.None && isPublicKeyword(text, lexer.start, lexer.end)
            ? Prev.CONT
            : classifyIdent(lexer.kw);
        break;
      case Tok.OPEN:
        if (ignoredOpeners === null || !ignoredOpeners.has(lexer.start)) openers.push(lexer.start);
        next = Prev.CONT;
        break;
      case Tok.CLOSE:
        openers.pop();
        next = Prev.ENDER;
        break;
      case Tok.SEMI:
        next = Prev.SEMI;
        break;
      case Tok.CMD:
      case Tok.CHAR:
      case Tok.NUMBER:
      case Tok.PRIME:
        next = Prev.ENDER;
        break;
      default:
        // COMMA, DOT, ARROW, COLON, OP
        next = Prev.CONT;
    }

    if (depth > 0) {
      // Inside brackets a line break ends nothing.
      atomAtLineEnd = false;
      runStart = -1;
    } else if (k === Tok.OP || k === Tok.COLON || k === Tok.DOT) {
      if (runStart < 0 || lexer.spaceBefore) {
        // A new run. After an operator standing alone, `=` assigns to it (`const ≤ = <=`):
        // JuliaSyntax takes an operator followed by `=` as an atom, so that `=` is binary.
        runOperand = operandExpected && !(runStart >= 0 && runOperand && isAssignmentAt(text, lexer.start));
        runStart = lexer.start;
      }
      // After a value, the postfix `...` completes it too: `documented_attributes(Lines)...` in a
      // Makie recipe, followed by the docstring of an attribute.
      atomAtLineEnd = runOperand
        ? operatorStandsAlone(text, runStart, lexer.end)
        : runStart === lexer.start && lexer.end - lexer.start === 3 && text.startsWith('...', lexer.start);
    } else {
      // `in`, `isa` and `where` are names where an operand is expected: `in` alone documents `in`.
      atomAtLineEnd =
        k === Tok.IDENT && operandExpected && (lexer.kw === Kw.In || lexer.kw === Kw.Isa || lexer.kw === Kw.Where);
      runStart = -1;
    }

    if (k === Tok.IDENT && lexer.kw === Kw.None && (chain === Chain.Start || chain === Chain.Dot)) {
      chain = Chain.Ident;
    } else if (k === Tok.DOT && chain === Chain.Ident && !lexer.spaceBefore) {
      chain = Chain.Dot;
    } else {
      chain = Chain.None;
    }
    atDocStart = pendingAtDoc;
    prev = next;
    newline = false;
  }
  return { docstrings, unclosed: openers };
}

function classifyIdent(kw: Kw): Prev {
  switch (kw) {
    case Kw.None:
    case Kw.End:
    case Kw.Else:
    case Kw.Try:
    case Kw.Catch:
    case Kw.Finally:
      return Prev.ENDER;
    case Kw.Begin:
    case Kw.Quote:
      return Prev.SEMI;
    default:
      return Prev.CONT;
  }
}

/**
 * Follows block keywords and `end` at bracket depth 0. Inside brackets `end` is an index and `for` /
 * `if` belong to comprehensions; a block written inside brackets opens and closes there, so it is
 * skipped as a whole.
 */
function trackBlock(blocks: OpenBlock[], lines: LineStarts, lexer: Lexer): void {
  switch (lexer.kw) {
    case Kw.Module:
    case Kw.Baremodule:
    case Kw.Begin:
    case Kw.Quote:
      blocks.push({ docs: true, indent: lines.indent(lexer.start) });
      break;
    case Kw.Struct:
    case Kw.Type: // `abstract type`, `primitive type`
    case Kw.Function:
    case Kw.Macro:
    case Kw.If:
    case Kw.For:
    case Kw.While:
    case Kw.Let:
    case Kw.Try:
    case Kw.Do:
      blocks.push({ docs: false, indent: lines.indent(lexer.start) });
      break;
    case Kw.End:
      blocks.pop();
      break;
  }
}

/**
 * Whether a string statement at `pos` stands where Julia parses docstrings: at the top level or
 * directly in `module`, `baremodule`, `begin` or `quote`, so not in a function, `if` or
 * loop body. Strings in `struct` bodies are not decorated either, although the docsystem collects
 * them as field docs when the struct itself is documented.
 *
 * A block that does not take docstrings contains the string only when the string is indented deeper
 * than the block's first line. Such a block whose `end` is still missing while typing would
 * otherwise take in all the code below it (and the `end` of an enclosing block, shifting the rest):
 * with this rule the code at the block's own indentation is outside it. Blocks that take docstrings
 * need no such rule, and their bodies are often not indented (`@eval begin` in a loop).
 */
function inDocstringBlock(blocks: readonly OpenBlock[], lines: LineStarts, pos: number): boolean {
  const column = pos - lines.of(pos);
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block === undefined || block.docs) return true;
    if (column > block.indent) return false;
  }
  return true;
}

/** Line starts for non-decreasing offsets: a pass looks at each character at most once. */
class LineStarts {
  private last = 0;
  private start = 0;

  constructor(private readonly text: string) {}

  /** Offset of the start of the line containing `pos`. */
  of(pos: number): number {
    for (let i = pos; i > this.last; i--) {
      const c = this.text.charCodeAt(i - 1);
      if (c === CH_LF || c === CH_CR) {
        this.start = i;
        break;
      }
    }
    this.last = pos;
    return this.start;
  }

  /** Length of the leading whitespace of the line containing `pos`. */
  indent(pos: number): number {
    const start = this.of(pos);
    let i = start;
    while (i < pos) {
      const c = this.text.charCodeAt(i);
      if (c !== CH_SPACE && c !== CH_TAB) break;
      i++;
    }
    return i - start;
  }
}

/** Keywords that close a block; a string followed by one of them is not a docstring. */
function isClosingKeyword(kw: Kw): boolean {
  return kw === Kw.End || kw === Kw.Else || kw === Kw.Elseif || kw === Kw.Catch || kw === Kw.Finally;
}

function addCandidate(out: RawDocstring[], text: string, lexer: Lexer, kind: 'plain' | 'atdoc', start: number): void {
  const target = resolveTarget(text, lexer.end, kind === 'atdoc');
  if (target < 0) return;
  out.push({
    kind,
    triple: lexer.triple,
    prefixStart: lexer.prefixStart,
    start,
    end: lexer.end,
    contentStart: lexer.contentStart,
    contentEnd: lexer.contentEnd,
    targetOffset: target,
  });
}

/**
 * Finds the documented expression after a candidate string ending at `from`: on the same line, or
 * after exactly one newline (comments are trivia; a blank line or a comment line means two
 * newlines). Returns the offset of its first token, or -1 if the string is not a docstring.
 */
export function resolveTarget(text: string, from: number, atDoc: boolean): number {
  const lexer = new Lexer(text, from, true);
  let k = lexer.next();
  let newlines = 0;
  while (k === Tok.NEWLINE) {
    if (++newlines > 1) return -1;
    k = lexer.next();
  }
  if (atDoc && newlines === 0 && k === Tok.ARROW) {
    // `@doc str ->` newline `target`: the docsystem expands the anonymous-function form.
    do k = lexer.next();
    while (k === Tok.NEWLINE);
    newlines = 1;
  }
  if (k === Tok.EOF || k === Tok.SEMI || k === Tok.COMMA || k === Tok.CLOSE) return -1;
  if (k === Tok.IDENT && isClosingKeyword(lexer.kw)) return -1;
  // An unterminated literal swallows the rest of the file; Julia reports a syntax error.
  if ((k === Tok.STRING || k === Tok.CMD) && !lexer.terminated) return -1;
  if (newlines === 0 && continuesExpression(text, lexer, atDoc)) return -1;
  return lexer.start;
}

/**
 * On the same line, an operator after the string makes it part of a larger expression. This
 * includes `$`: JuliaSyntax parses `"doc" $f(x) = x` as a binary `$` call. An operator that is only
 * unary cannot continue it and starts the target instead: `"doc" !(x::T) = x`.
 *
 * `@doc` arguments are parsed space-sensitively, like the elements of `[a +b]`: an operator that is
 * both unary and binary starts the next argument when whitespace precedes it and its operand follows
 * directly. `@doc "doc" +(x::T) = x` documents a method of `+`; `@doc "doc" + x` does not.
 */
function continuesExpression(text: string, lexer: Lexer, atDoc: boolean): boolean {
  switch (lexer.kind) {
    case Tok.OP:
    case Tok.COLON:
      switch (prefixOperator(text, lexer.start, lexer.end)) {
        case Prefix.UnaryOnly:
          return false;
        case Prefix.UnaryOrBinary:
          return !(atDoc && lexer.spaceBefore && startsOperand(text, lexer.end));
        default:
          return true;
      }
    case Tok.DOT:
    case Tok.ARROW:
    case Tok.PRIME:
      return true;
    case Tok.OPEN:
      return !lexer.spaceBefore; // `"doc"(x)`, `"doc"[1]`
    case Tok.IDENT:
      return lexer.kw === Kw.In || lexer.kw === Kw.Isa || lexer.kw === Kw.Where;
    default:
      return false;
  }
}

/** `@doc(str, target)`: the first argument must be a string literal followed by a comma. */
function addCallForm(out: RawDocstring[], text: string, paren: number, start: number): void {
  const lexer = new Lexer(text, paren + 1);
  const nextSignificant = (): Tok => {
    let k = lexer.next();
    while (k === Tok.NEWLINE) k = lexer.next();
    return k;
  };
  if (nextSignificant() !== Tok.STRING || !lexer.terminated) return;
  const triple = lexer.triple;
  const prefixStart = lexer.prefixStart;
  const end = lexer.end;
  const contentStart = lexer.contentStart;
  const contentEnd = lexer.contentEnd;
  if (nextSignificant() !== Tok.COMMA) return;
  const k = nextSignificant();
  if (k === Tok.EOF || k === Tok.CLOSE || k === Tok.SEMI || k === Tok.COMMA) return;
  if (k === Tok.IDENT && isClosingKeyword(lexer.kw)) return;
  out.push({ kind: 'atdoc', triple, prefixStart, start, end, contentStart, contentEnd, targetOffset: lexer.start });
}
