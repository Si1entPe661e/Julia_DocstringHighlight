// Lexical scanner for the parts of Julia syntax the docstring detector needs (03 §4).
//
// The lexer skips whitespace and comments (trivia) and reports every newline outside strings and
// comments as a NEWLINE token. Strings, command strings and character literals are consumed whole,
// including `$(…)` interpolations with nested strings. It never allocates per character: the hot
// paths use charCodeAt only.

export const enum Tok {
  EOF,
  NEWLINE,
  /** `"…"` or `"""…"""`, optionally prefixed by a string macro name (`raw"…"`). */
  STRING,
  /** `` `…` `` or ```` ```…``` ````, optionally prefixed. */
  CMD,
  CHAR,
  /** Identifier or keyword (see `Lexer.kw`). */
  IDENT,
  NUMBER,
  /** `@name` or `@.` */
  MACRO,
  OPEN,
  CLOSE,
  SEMI,
  COMMA,
  /** A single `.` */
  DOT,
  /** `->` */
  ARROW,
  /** A single `:` */
  COLON,
  /** Postfix `'` (adjoint). */
  PRIME,
  /** Any other operator character. */
  OP,
}

export const enum Kw {
  None,
  End,
  Else,
  Elseif,
  Catch,
  Finally,
  Try,
  Begin,
  Quote,
  In,
  Isa,
  Where,
  Function,
  Macro,
  Struct,
  Mutable,
  Abstract,
  Primitive,
  Type,
  If,
  For,
  While,
  Let,
  Return,
  Const,
  Global,
  Local,
  Using,
  Import,
  Export,
  Module,
  Baremodule,
  Do,
}

const KEYWORDS: ReadonlyArray<readonly [string, Kw]> = [
  ['end', Kw.End],
  ['else', Kw.Else],
  ['elseif', Kw.Elseif],
  ['catch', Kw.Catch],
  ['finally', Kw.Finally],
  ['try', Kw.Try],
  ['begin', Kw.Begin],
  ['quote', Kw.Quote],
  ['in', Kw.In],
  ['isa', Kw.Isa],
  ['where', Kw.Where],
  ['function', Kw.Function],
  ['macro', Kw.Macro],
  ['struct', Kw.Struct],
  ['mutable', Kw.Mutable],
  ['abstract', Kw.Abstract],
  ['primitive', Kw.Primitive],
  ['type', Kw.Type],
  ['if', Kw.If],
  ['for', Kw.For],
  ['while', Kw.While],
  ['let', Kw.Let],
  ['return', Kw.Return],
  ['const', Kw.Const],
  ['global', Kw.Global],
  ['local', Kw.Local],
  ['using', Kw.Using],
  ['import', Kw.Import],
  ['export', Kw.Export],
  ['module', Kw.Module],
  ['baremodule', Kw.Baremodule],
  ['do', Kw.Do],
];

/** Keywords bucketed by first character, so lookups need no substring allocation. */
const KEYWORD_BUCKETS: Array<Array<readonly [string, Kw]> | undefined> = [];
for (const entry of KEYWORDS) {
  const c = entry[0].charCodeAt(0);
  (KEYWORD_BUCKETS[c] ??= []).push(entry);
}

export function keywordAt(text: string, start: number, end: number): Kw {
  const bucket = KEYWORD_BUCKETS[text.charCodeAt(start)];
  if (bucket === undefined) return Kw.None;
  const len = end - start;
  for (const [word, kw] of bucket) {
    if (word.length === len && text.startsWith(word, start)) return kw;
  }
  return Kw.None;
}

// ---------------------------------------------------------------------------------------------
// Character classes

const CH_TAB = 0x09;
const CH_LF = 0x0a;
const CH_CR = 0x0d;
const CH_SPACE = 0x20;
const CH_BANG = 0x21;
const CH_QUOTE = 0x22;
const CH_HASH = 0x23;
const CH_DOLLAR = 0x24;
const CH_PERCENT = 0x25;
const CH_AMP = 0x26;
const CH_APOS = 0x27;
const CH_LPAREN = 0x28;
const CH_RPAREN = 0x29;
const CH_STAR = 0x2a;
const CH_PLUS = 0x2b;
const CH_COMMA = 0x2c;
const CH_MINUS = 0x2d;
const CH_DOT = 0x2e;
const CH_SLASH = 0x2f;
const CH_0 = 0x30;
const CH_9 = 0x39;
const CH_COLON = 0x3a;
const CH_SEMI = 0x3b;
const CH_LT = 0x3c;
const CH_EQ = 0x3d;
const CH_GT = 0x3e;
const CH_AT = 0x40;
const CH_LBRACKET = 0x5b;
const CH_BACKSLASH = 0x5c;
const CH_RBRACKET = 0x5d;
const CH_CARET = 0x5e;
const CH_BACKTICK = 0x60;
const CH_LBRACE = 0x7b;
const CH_PIPE = 0x7c;
const CH_RBRACE = 0x7d;
const CH_TILDE = 0x7e;

function isDigit(c: number): boolean {
  return c >= CH_0 && c <= CH_9;
}

function isAsciiLetter(c: number): boolean {
  return (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a);
}

function isHighSurrogate(c: number): boolean {
  return c >= 0xd800 && c <= 0xdbff;
}

/** Non-newline whitespace outside ASCII (Julia's `isspace` plus the BOM). */
function isUnicodeSpace(c: number): boolean {
  return (
    c === 0x85 ||
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000 ||
    c === 0xfeff
  );
}

const ID_START_CATEGORIES = /^[\p{L}\p{Nl}\p{Sc}\p{So}]$/u;
const ID_CHAR_CATEGORIES = /^[\p{Mn}\p{Mc}\p{Nd}\p{Pc}\p{Sk}\p{Me}\p{No}]$/u;

const CLASS_NONE = 1;
const CLASS_ID_CHAR = 2;
const CLASS_ID_START = 3;

/** Cache for BMP code points: 0 = not yet classified. */
const classCache = new Uint8Array(0x10000);

/** Math symbols Julia accepts at the start of identifiers (∂, ∇, ∑, ∫, …), after `is_wc_cat_id_start`. */
function isMathIdStart(cp: number): boolean {
  return (
    (cp >= 0x2140 && cp <= 0x2144) ||
    cp === 0x223f ||
    cp === 0x22be ||
    cp === 0x22bf ||
    cp === 0x22a4 ||
    cp === 0x22a5 ||
    cp === 0x2202 ||
    cp === 0x2205 ||
    cp === 0x2206 ||
    cp === 0x2207 ||
    cp === 0x220e ||
    cp === 0x220f ||
    cp === 0x2210 ||
    cp === 0x2211 ||
    cp === 0x221e ||
    cp === 0x221f ||
    (cp >= 0x222b && cp <= 0x2233) ||
    (cp >= 0x22c0 && cp <= 0x22c3) ||
    (cp >= 0x25f8 && cp <= 0x25ff) ||
    cp === 0x266f ||
    cp === 0x27d8 ||
    cp === 0x27d9 ||
    cp === 0x27c0 ||
    cp === 0x27c1 ||
    (cp >= 0x29b0 && cp <= 0x29b4) ||
    (cp >= 0x2a00 && cp <= 0x2a06) ||
    (cp >= 0x2a09 && cp <= 0x2a16) ||
    cp === 0x2a1b ||
    cp === 0x2a1c ||
    (cp >= 0x2220 && cp <= 0x2222) ||
    (cp >= 0x299b && cp <= 0x29af) ||
    (cp >= 0x207a && cp <= 0x207e) ||
    (cp >= 0x208a && cp <= 0x208e) ||
    cp === 0x2118 ||
    cp === 0x212e ||
    cp === 0x309b ||
    cp === 0x309c ||
    (cp >= 0x1d7ce && cp <= 0x1d7e1) ||
    cp === 0x1d6c1 ||
    cp === 0x1d6db ||
    cp === 0x1d6fb ||
    cp === 0x1d715 ||
    cp === 0x1d735 ||
    cp === 0x1d74f ||
    cp === 0x1d76f ||
    cp === 0x1d789 ||
    cp === 0x1d7a9 ||
    cp === 0x1d7c3
  );
}

function computeClass(cp: number): number {
  if (cp < 0xa1) return CLASS_NONE;
  if (isMathIdStart(cp)) return CLASS_ID_START;
  // Other symbols are identifiers except arrows and a few replacement characters.
  if ((cp >= 0x2190 && cp <= 0x21ff) || cp === 0xfffc || cp === 0xfffd || cp === 0x233f || cp === 0xa6) {
    return CLASS_NONE;
  }
  const s = String.fromCodePoint(cp);
  if (ID_START_CATEGORIES.test(s)) return CLASS_ID_START;
  if (ID_CHAR_CATEGORIES.test(s) || (cp >= 0x2032 && cp <= 0x2037) || cp === 0x2057) return CLASS_ID_CHAR;
  return CLASS_NONE;
}

function classOf(cp: number): number {
  if (cp < 0x10000) {
    let c = classCache[cp] ?? 0;
    if (c === 0) {
      c = computeClass(cp);
      classCache[cp] = c;
    }
    return c;
  }
  return computeClass(cp);
}

/** Whether an identifier starts at `i` (approximates Julia's `is_id_start_char`). */
export function isIdStartAt(text: string, i: number): boolean {
  const c = text.charCodeAt(i);
  if (c < 0x80) return isAsciiLetter(c) || c === 0x5f;
  if (Number.isNaN(c)) return false;
  return classOf(text.codePointAt(i) ?? 0) === CLASS_ID_START;
}

/** End offset of the identifier starting at `i` (which must satisfy `isIdStartAt`). */
export function skipIdent(text: string, i: number): number {
  const n = text.length;
  i += isHighSurrogate(text.charCodeAt(i)) ? 2 : 1;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c < 0x80) {
      if (isAsciiLetter(c) || isDigit(c) || c === 0x5f) {
        i++;
        continue;
      }
      // `!` belongs to identifiers (`push!`), except in `!=` / `!==`.
      if (c === CH_BANG && text.charCodeAt(i + 1) !== CH_EQ) {
        i++;
        continue;
      }
      break;
    }
    const cp = text.codePointAt(i) ?? 0;
    if (classOf(cp) === CLASS_NONE) break;
    i += cp > 0xffff ? 2 : 1;
  }
  return i;
}

// ---------------------------------------------------------------------------------------------
// Trivia and literals

/** Skips a `#` line comment; returns the offset of the line break (or EOF). */
export function skipLineComment(text: string, i: number): number {
  const n = text.length;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === CH_LF || c === CH_CR) return i;
    i++;
  }
  return n;
}

/** Skips a nestable `#= … =#` block comment starting at `i`; returns its end (or EOF). */
export function skipBlockComment(text: string, i: number): number {
  const n = text.length;
  let depth = 1;
  i += 2;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === CH_HASH && text.charCodeAt(i + 1) === CH_EQ) {
      depth++;
      i += 2;
    } else if (c === CH_EQ && text.charCodeAt(i + 1) === CH_HASH) {
      i += 2;
      if (--depth === 0) return i;
    } else {
      i++;
    }
  }
  return n;
}

/**
 * Scans the body of a string or command literal starting at `i` (just after the opening delimiter).
 * A backslash escapes the next character: for prefixed (raw-like) literals this finds the same end.
 * A triple-quoted literal ends at the first unescaped triple delimiter, as in JuliaSyntax: in
 * `"""a""""` the fourth quote starts a new string (08 §5).
 * Returns the offset after the closing delimiter, or -1 if the literal is not terminated.
 */
export function scanStringBody(text: string, i: number, triple: boolean, delim: number, interpolate: boolean): number {
  const n = text.length;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === CH_BACKSLASH) {
      i += 2;
    } else if (c === delim) {
      if (!triple) return i + 1;
      if (text.charCodeAt(i + 1) === delim && text.charCodeAt(i + 2) === delim) return i + 3;
      i++;
    } else if (interpolate && c === CH_DOLLAR && text.charCodeAt(i + 1) === CH_LPAREN) {
      i = skipInterpolation(text, i + 2);
    } else {
      i++;
    }
  }
  return -1;
}

/** Skips `$( … )` from just after the opening parenthesis; returns the offset after `)` (or EOF). */
export function skipInterpolation(text: string, i: number): number {
  const lexer = new Lexer(text, i);
  let depth = 1;
  for (;;) {
    const k = lexer.next();
    if (k === Tok.EOF) return text.length;
    if (k === Tok.OPEN) depth++;
    else if (k === Tok.CLOSE && --depth === 0) return lexer.end;
  }
}

/**
 * End offset of the character literal whose opening `'` is at `i`, or -1 if there is no closing
 * `'` within a few characters on the same line (then `'` is lexed as an operator instead of
 * swallowing the rest of the line).
 */
export function charLiteralEnd(text: string, i: number): number {
  const n = text.length;
  let j = i + 1;
  if (j >= n) return -1;
  const c = text.charCodeAt(j);
  if (c === CH_LF || c === CH_CR) return -1;
  if (c === CH_BACKSLASH) {
    // '\n', '\'', '\\', '\x41', '∀', '\U1F680', '\101'
    j += 2;
    const limit = Math.min(n, i + 12);
    while (j < limit) {
      const d = text.charCodeAt(j);
      if (d === CH_APOS) return j + 1;
      if (d === CH_LF || d === CH_CR) return -1;
      j++;
    }
    return -1;
  }
  j += isHighSurrogate(c) ? 2 : 1;
  return text.charCodeAt(j) === CH_APOS ? j + 1 : -1;
}

/**
 * Whether `c` continues a dot into `..` or a dotted operator (`.+`, `.==`), so that the dot before it
 * is not part of a number. After `1.` such an operator is an error in Julia (`1.+x` is ambiguous); a
 * non-ASCII one is too, so those need not be listed.
 */
function isDotOperatorStart(c: number): boolean {
  switch (c) {
    case CH_DOT:
    case CH_BANG:
    case CH_PERCENT:
    case CH_AMP:
    case CH_STAR:
    case CH_PLUS:
    case CH_MINUS:
    case CH_SLASH:
    case CH_LT:
    case CH_EQ:
    case CH_GT:
    case CH_BACKSLASH:
    case CH_CARET:
    case CH_PIPE:
    case CH_TILDE:
      return true;
    default:
      return false;
  }
}

function numberEnd(text: string, i: number): number {
  const n = text.length;
  let j = i;
  const c0 = text.charCodeAt(i);
  const c1 = text.charCodeAt(i + 1);
  if (c0 === CH_0 && (c1 === 0x78 || c1 === 0x62 || c1 === 0x6f)) {
    // 0x…, 0b…, 0o…
    j = i + 2;
    while (j < n) {
      const c = text.charCodeAt(j);
      if (isDigit(c) || c === 0x5f || (c >= 0x61 && c <= 0x66) || (c >= 0x41 && c <= 0x46)) j++;
      else break;
    }
    return j;
  }
  const digits = (): void => {
    while (j < n) {
      const c = text.charCodeAt(j);
      if (isDigit(c) || c === 0x5f) j++;
      else break;
    }
  };
  if (c0 === CH_DOT) j++;
  digits();
  if (c0 !== CH_DOT && text.charCodeAt(j) === CH_DOT && !isDotOperatorStart(text.charCodeAt(j + 1))) {
    // `1.5`, and a trailing dot as in `1.`, `1.e3`, `[1., 2.]` (JuliaSyntax's lex_digit).
    j++;
    digits();
  }
  const e = text.charCodeAt(j);
  if (e === 0x65 || e === 0x45 || e === 0x66) {
    // exponent: e, E, f (Float32)
    const s = text.charCodeAt(j + 1);
    if (isDigit(s)) {
      j += 1;
      digits();
    } else if ((s === CH_PLUS || s === CH_MINUS) && isDigit(text.charCodeAt(j + 2))) {
      j += 2;
      digits();
    }
  }
  return j;
}

// ---------------------------------------------------------------------------------------------
// Operators

export const enum Prefix {
  None,
  /** `!` `¬` `√` `∛` `∜` */
  UnaryOnly,
  /** `+` `-` `$` `&` `~` `⋆` `±` `∓`, and `:` (quote or range) */
  UnaryOrBinary,
}

/**
 * How the operator token [start, end) can act as a prefix operator, after JuliaSyntax's
 * `is_unary_op` and `is_both_unary_and_binary`.
 */
export function prefixOperator(text: string, start: number, end: number): Prefix {
  if (end - start !== 1) return Prefix.None; // `::`
  switch (text.charCodeAt(start)) {
    case CH_BANG:
      return text.charCodeAt(end) === CH_EQ ? Prefix.None : Prefix.UnaryOnly; // `!=`, `!==`
    case 0xac: // ¬
    case 0x221a: // √
    case 0x221b: // ∛
    case 0x221c: // ∜
      return Prefix.UnaryOnly;
    case CH_PLUS:
    case CH_MINUS:
    case CH_DOLLAR:
    case CH_AMP:
    case CH_TILDE:
    case CH_COLON:
    case 0x22c6: // ⋆
    case 0xb1: // ±
    case 0x2213: // ∓
      return Prefix.UnaryOrBinary;
    default:
      return Prefix.None;
  }
}

/**
 * Whether the run of operator characters [start, end) can stand alone as a value, as in `x = +` or
 * `==` on a line of its own. Not `::`, which takes its operand from the next line, nor `:`, `'`,
 * `@` or a trailing `.` (`...`), which are errors on their own.
 */
export function operatorStandsAlone(text: string, start: number, end: number): boolean {
  const last = text.charCodeAt(end - 1);
  if (last === CH_DOT || last === CH_APOS || last === CH_AT) return false;
  if (last === CH_COLON) return end - start > 1 && text.charCodeAt(end - 2) !== CH_COLON;
  return true;
}

/** Whether the `=` at `i` is an assignment, not part of `==` or `=>`. */
export function isAssignmentAt(text: string, i: number): boolean {
  const next = text.charCodeAt(i + 1);
  return text.charCodeAt(i) === CH_EQ && next !== CH_EQ && next !== CH_GT;
}

/**
 * Whether the identifier [start, end) is the `public` keyword of a statement that lists names,
 * like `export`: separated from what follows, which is not `(`, `[` or `=` (JuliaSyntax's
 * `parse_public`; before Julia 1.11 `public` was an ordinary identifier).
 */
export function isPublicKeyword(text: string, start: number, end: number): boolean {
  if (end - start !== 6 || !text.startsWith('public', start)) return false;
  let i = end;
  while (text.charCodeAt(i) === CH_SPACE || text.charCodeAt(i) === CH_TAB) i++;
  const c = text.charCodeAt(i);
  if (i === end || Number.isNaN(c) || c === CH_LF || c === CH_CR || c === CH_HASH || c === CH_SEMI) return false;
  return c !== CH_LPAREN && c !== CH_LBRACKET && !isAssignmentAt(text, i);
}

/**
 * Whether an operand starts at `i`, directly after a prefix operator: `+x`, `-1`, `+(x::T)`, `$f`,
 * `:x`. Operator characters do not count, so that `+=`, `&&`, `-->` and suffixed operators such as
 * `+₁` stay single binary operators.
 */
export function startsOperand(text: string, i: number): boolean {
  const c = text.charCodeAt(i);
  switch (c) {
    case CH_LPAREN:
    case CH_LBRACKET:
    case CH_LBRACE:
    case CH_QUOTE:
    case CH_BACKTICK:
    case CH_APOS:
    case CH_AT:
    case CH_DOLLAR:
      return true;
    case CH_COLON:
      return text.charCodeAt(i + 1) !== CH_COLON; // `-:x`, not `::`
    case CH_DOT:
      return isDigit(text.charCodeAt(i + 1)); // `-.5`
    default:
      return isDigit(c) || isIdStartAt(text, i);
  }
}

// ---------------------------------------------------------------------------------------------
// Lexer

export class Lexer {
  readonly text: string;
  private readonly n: number;
  private pos: number;

  kind: Tok = Tok.EOF;
  start = 0;
  end = 0;
  /** Whitespace or a comment separates this token from the previous token on the same line. */
  spaceBefore = false;

  // STRING / CMD
  /** Offset of the string macro name, or -1 for a plain literal. */
  prefixStart = -1;
  triple = false;
  terminated = true;
  contentStart = 0;
  contentEnd = 0;

  // IDENT
  kw: Kw = Kw.None;

  // MACRO
  isDocMacro = false;

  private prevKind: Tok = Tok.NEWLINE;
  private prevKw: Kw = Kw.None;
  /** The previous token is a value that a directly following `'` would transpose. */
  private adjoinable: boolean;

  /**
   * @param afterValue the text before `pos` ends with a value (e.g. a string literal), so that a
   * directly following `'` is the adjoint operator.
   */
  constructor(text: string, pos = 0, afterValue = false) {
    this.text = text;
    this.n = text.length;
    this.pos = pos;
    this.adjoinable = afterValue;
  }

  next(): Tok {
    const text = this.text;
    const n = this.n;
    let i = this.pos;
    let space = false;
    for (;;) {
      if (i >= n) {
        this.spaceBefore = space;
        return this.emit(Tok.EOF, n, n, false);
      }
      const c = text.charCodeAt(i);
      if (c === CH_SPACE || c === CH_TAB) {
        i++;
        space = true;
      } else if (c === CH_LF) {
        this.spaceBefore = space;
        return this.emit(Tok.NEWLINE, i, i + 1, false);
      } else if (c === CH_CR) {
        this.spaceBefore = space;
        return this.emit(Tok.NEWLINE, i, text.charCodeAt(i + 1) === CH_LF ? i + 2 : i + 1, false);
      } else if (c === CH_HASH) {
        i = text.charCodeAt(i + 1) === CH_EQ ? skipBlockComment(text, i) : skipLineComment(text, i);
        space = true;
      } else if (c === 0x0b || c === 0x0c || (c >= 0x80 && isUnicodeSpace(c))) {
        i++;
        space = true;
      } else {
        break;
      }
    }
    this.spaceBefore = space;
    const c = text.charCodeAt(i);
    switch (c) {
      case CH_QUOTE:
        return this.lexQuoted(i, -1, CH_QUOTE, Tok.STRING);
      case CH_BACKTICK:
        return this.lexQuoted(i, -1, CH_BACKTICK, Tok.CMD);
      case CH_APOS: {
        if (this.adjoinable && !space) return this.emit(Tok.PRIME, i, i + 1, true);
        const e = charLiteralEnd(text, i);
        return e > 0 ? this.emit(Tok.CHAR, i, e, true) : this.emit(Tok.OP, i, i + 1, false);
      }
      case CH_LPAREN:
      case CH_LBRACKET:
      case CH_LBRACE:
        return this.emit(Tok.OPEN, i, i + 1, false);
      case CH_RPAREN:
      case CH_RBRACKET:
      case CH_RBRACE:
        return this.emit(Tok.CLOSE, i, i + 1, true);
      case CH_SEMI:
        return this.emit(Tok.SEMI, i, i + 1, false);
      case CH_COMMA:
        return this.emit(Tok.COMMA, i, i + 1, false);
      case CH_AT:
        return this.lexMacro(i);
      case CH_DOT: {
        const d = text.charCodeAt(i + 1);
        if (d === CH_DOT) {
          let j = i + 2;
          while (text.charCodeAt(j) === CH_DOT) j++;
          return this.emit(Tok.OP, i, j, false);
        }
        if (isDigit(d) && !(this.adjoinable && !space)) return this.emit(Tok.NUMBER, i, numberEnd(text, i), true);
        return this.emit(Tok.DOT, i, i + 1, true);
      }
      case CH_MINUS:
        if (text.charCodeAt(i + 1) === CH_GT) return this.emit(Tok.ARROW, i, i + 2, false);
        return this.emit(Tok.OP, i, i + 1, false);
      case CH_COLON:
        if (text.charCodeAt(i + 1) === CH_COLON) return this.emit(Tok.OP, i, i + 2, false);
        return this.emit(Tok.COLON, i, i + 1, false);
    }
    if (isDigit(c)) return this.emit(Tok.NUMBER, i, numberEnd(text, i), true);
    if (isIdStartAt(text, i)) return this.lexIdent(i);
    return this.emit(Tok.OP, i, i + (isHighSurrogate(c) ? 2 : 1), false);
  }

  private emit(kind: Tok, start: number, end: number, adjoinable: boolean, kw: Kw = Kw.None): Tok {
    this.kind = kind;
    this.start = start;
    this.end = end;
    this.pos = end;
    this.kw = kw;
    this.prevKind = kind;
    this.prevKw = kw;
    this.adjoinable = adjoinable;
    return kind;
  }

  private lexQuoted(q: number, prefixStart: number, delim: number, kind: Tok): Tok {
    const text = this.text;
    const triple = text.charCodeAt(q + 1) === delim && text.charCodeAt(q + 2) === delim;
    const contentStart = q + (triple ? 3 : 1);
    const end = scanStringBody(text, contentStart, triple, delim, prefixStart < 0);
    this.prefixStart = prefixStart;
    this.triple = triple;
    this.contentStart = contentStart;
    this.terminated = end >= 0;
    this.contentEnd = end >= 0 ? end - (triple ? 3 : 1) : this.n;
    return this.emit(kind, prefixStart >= 0 ? prefixStart : q, end >= 0 ? end : this.n, true);
  }

  private lexIdent(i: number): Tok {
    const text = this.text;
    const e = skipIdent(text, i);
    const next = text.charCodeAt(e);
    if (next === CH_QUOTE) return this.lexQuoted(e, i, CH_QUOTE, Tok.STRING);
    if (next === CH_BACKTICK) return this.lexQuoted(e, i, CH_BACKTICK, Tok.CMD);
    let kw = keywordAt(text, i, e);
    if (kw !== Kw.None) {
      if ((this.prevKind === Tok.DOT || this.prevKind === Tok.COLON) && !this.spaceBefore) {
        // `x.end`, `:function`: a field name or a symbol, not a keyword.
        kw = Kw.None;
      } else if (kw === Kw.Type && this.prevKw !== Kw.Abstract && this.prevKw !== Kw.Primitive) {
        // `type` is only a keyword in `abstract type` / `primitive type`.
        kw = Kw.None;
      }
    }
    return this.emit(Tok.IDENT, i, e, kw === Kw.None || kw === Kw.End, kw);
  }

  private lexMacro(i: number): Tok {
    const text = this.text;
    const j = i + 1;
    if (isIdStartAt(text, j)) {
      const e = skipIdent(text, j);
      const kind = this.emit(Tok.MACRO, i, e, false);
      this.isDocMacro = e - j === 3 && text.startsWith('doc', j);
      return kind;
    }
    this.isDocMacro = false;
    if (text.charCodeAt(j) === CH_DOT) return this.emit(Tok.MACRO, i, j + 1, false);
    return this.emit(Tok.OP, i, j, false);
  }
}
