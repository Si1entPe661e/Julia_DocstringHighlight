// Inline code spans inside docstring prose, for the chip decoration (03 §5.1).
//
// Block structure follows the injection grammar (04 §5) so that chips appear where the grammar
// colours `markup.inline.raw`: fenced code and four-space indented code are skipped; list items and
// admonition bodies are prose. Indentation is measured after Julia's triple-quote dedent, so
// docstrings indented inside a module are classified the same way as top-level ones.

import type { InlineCodeSpan, RawDocstring } from './types';

const CH_TAB = 0x09;
const CH_SPACE = 0x20;
const CH_BANG = 0x21;
const CH_BACKSLASH = 0x5c;
const CH_BACKTICK = 0x60;
const CH_TILDE = 0x7e;

export function extractInlineCode(text: string, lineStarts: readonly number[], docstrings: readonly RawDocstring[]): InlineCodeSpan[] {
  const out: InlineCodeSpan[] = [];
  for (const d of docstrings) extractFromDocstring(text, lineStarts, d, out);
  return out;
}

/** Index of the line containing `offset`. */
export function lineOf(lineStarts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((lineStarts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** End of the line's content, excluding the line break. */
function lineContentEnd(text: string, lineStarts: readonly number[], line: number): number {
  const next = lineStarts[line + 1];
  if (next === undefined) return text.length;
  let e = next;
  if (e > 0 && text.charCodeAt(e - 1) === 0x0a) e--;
  if (e > 0 && text.charCodeAt(e - 1) === 0x0d) e--;
  return e;
}

function indentEnd(text: string, s: number, e: number): number {
  while (s < e) {
    const c = text.charCodeAt(s);
    if (c !== CH_SPACE && c !== CH_TAB) break;
    s++;
  }
  return s;
}

function extractFromDocstring(text: string, lineStarts: readonly number[], d: RawDocstring, out: InlineCodeSpan[]): void {
  const first = lineOf(lineStarts, d.contentStart);
  const last = lineOf(lineStarts, d.contentEnd);
  const segStart = (line: number): number => (line === first ? d.contentStart : lineStarts[line] ?? 0);
  const segEnd = (line: number): number => (line === last ? d.contentEnd : lineContentEnd(text, lineStarts, line));

  // Julia removes the common indentation of triple-quoted strings. The text after the opening
  // quotes does not count; whitespace-only lines do not count except the closing line.
  let dedent = 0;
  if (d.triple && last > first) {
    dedent = Number.MAX_SAFE_INTEGER;
    for (let line = first + 1; line <= last; line++) {
      const s = segStart(line);
      const e = segEnd(line);
      const w = indentEnd(text, s, e);
      if (w === e && line !== last) continue;
      dedent = Math.min(dedent, w - s);
    }
  }

  const blocks = new BlockTracker(text);
  for (let line = first; line <= last; line++) {
    let s = segStart(line);
    const e = segEnd(line);
    if (line !== first) s = Math.min(indentEnd(text, s, e), s + dedent);
    const prose = blocks.feed(s, e);
    if (prose >= 0) scanInline(text, prose, e, line, lineStarts[line] ?? 0, out);
  }
}

const enum Container {
  None,
  List,
  Admonition,
}

const ADMONITION = /^!!![ \t]+[A-Za-z]+(?:[ \t]+"[^"]*")?[ \t]*$/;

/** Line-by-line mirror of the grammar's block rules: fences, indented code, lists, admonitions. */
class BlockTracker {
  private container = Container.None;
  private fenceChar = 0;
  private fenceLen = 0;
  private fenceIndent = '';

  constructor(private readonly text: string) {}

  /** Returns where prose starts on the line [s, e), or -1 if the line holds no prose. */
  feed(s: number, e: number): number {
    const text = this.text;
    const w = indentEnd(text, s, e);
    const blank = w === e;
    let p = s;
    if (this.container !== Container.None && !blank) {
      const consumed = this.containerIndent(s, e);
      if (consumed < 0) {
        // The line is not indented enough: the list / admonition ends, with any fence inside it.
        this.container = Container.None;
        this.fenceChar = 0;
      } else {
        p = s + consumed;
      }
    }
    if (this.fenceChar !== 0) {
      if (this.isClosingFence(p, e)) this.fenceChar = 0;
      return -1;
    }
    if (blank) return -1;
    if (this.openFence(p, e)) return -1;
    if (this.container === Container.None) {
      const c = text.charCodeAt(p);
      if (c === CH_TAB || text.startsWith('    ', p)) return -1; // indented code (signature)
      if (c === CH_BANG && ADMONITION.test(text.slice(p, e))) {
        this.container = Container.Admonition;
        return -1;
      }
      if (isListItem(text, p, e)) this.container = Container.List;
    }
    return p;
  }

  /** Characters consumed by the container's `while` pattern (04 §9), or -1 if it does not match. */
  private containerIndent(s: number, e: number): number {
    const text = this.text;
    if (s < e && text.charCodeAt(s) === CH_TAB) return 1;
    let i = s;
    while (i < e && i - s < 4 && text.charCodeAt(i) === CH_SPACE) i++;
    const n = i - s;
    if (this.container === Container.List) return n >= 2 ? n : -1;
    return n === 4 ? 4 : -1;
  }

  private openFence(p: number, e: number): boolean {
    const text = this.text;
    const w = indentEnd(text, p, e);
    const c = text.charCodeAt(w);
    if (c !== CH_BACKTICK && c !== CH_TILDE) return false;
    let j = w;
    while (j < e && text.charCodeAt(j) === c) j++;
    if (j - w < 3) return false;
    // The info string may not contain backticks (both fence rules end with [^`]*$).
    for (let k = j; k < e; k++) if (text.charCodeAt(k) === CH_BACKTICK) return false;
    this.fenceChar = c;
    this.fenceLen = j - w;
    this.fenceIndent = text.slice(p, w);
    return true;
  }

  /** `(^|\G)(\2|\s{0,3})(\3)\s*$`: same indentation or at most 3, the same fence, nothing after. */
  private isClosingFence(p: number, e: number): boolean {
    const text = this.text;
    const w = indentEnd(text, p, e);
    if (w - p > 3 && text.slice(p, w) !== this.fenceIndent) return false;
    let j = w;
    while (j < e && text.charCodeAt(j) === this.fenceChar) j++;
    return j - w === this.fenceLen && indentEnd(text, j, e) === e;
  }
}

/** `([ ]{0,3})([*+-])([ \t])` or `([ ]{0,3})([0-9]+[.)])([ \t])` */
function isListItem(text: string, p: number, e: number): boolean {
  let i = p;
  while (i < e && i - p < 3 && text.charCodeAt(i) === CH_SPACE) i++;
  const c = text.charCodeAt(i);
  if (c === 0x2a || c === 0x2b || c === 0x2d) {
    i++;
  } else if (c >= 0x30 && c <= 0x39) {
    while (i < e && text.charCodeAt(i) >= 0x30 && text.charCodeAt(i) <= 0x39) i++;
    const d = text.charCodeAt(i);
    if (d !== 0x2e && d !== 0x29) return false;
    i++;
  } else {
    return false;
  }
  const s = text.charCodeAt(i);
  return i < e && (s === CH_SPACE || s === CH_TAB);
}

/**
 * Code spans on one line of prose [s, e): a run of n backticks up to the next run of exactly n. A
 * run preceded by an odd number of backslashes is escaped; spans do not cross lines.
 *
 * Every search stays within the line. A failed search reads the rest of the line; after the second
 * one, the last run of each length is recorded and answers the later searches that cannot succeed,
 * so the work stays linear in the line length however many runs are unmatched.
 */
function scanInline(text: string, s: number, e: number, line: number, lineStart: number, out: InlineCodeSpan[]): void {
  let failed = 0;
  /** Run length → start of the last such run from the second failed search to `e`. */
  let lastRuns: Map<number, number> | undefined;
  let i = s;
  for (;;) {
    const open = nextBacktick(text, i, e);
    if (open < 0) return;
    const j = runEnd(text, open, e);
    const n = j - open;
    i = j;
    let backslashes = 0;
    while (open - backslashes - 1 >= s && text.charCodeAt(open - backslashes - 1) === CH_BACKSLASH) backslashes++;
    if (backslashes % 2 === 1) continue;
    if (lastRuns !== undefined && (lastRuns.get(n) ?? -1) < j) continue;
    const close = closingRun(text, j, e, n);
    if (close < 0) {
      if (++failed === 2) lastRuns = lastRunsFrom(text, j, e);
      continue;
    }
    if (close > j) out.push({ line, startCol: open - lineStart, endCol: close + n - lineStart });
    i = close + n;
  }
}

/** Offset of the first backtick in [i, e), or -1. */
function nextBacktick(text: string, i: number, e: number): number {
  for (; i < e; i++) if (text.charCodeAt(i) === CH_BACKTICK) return i;
  return -1;
}

/** End of the backtick run starting at `i` (at most `e`). */
function runEnd(text: string, i: number, e: number): number {
  while (i < e && text.charCodeAt(i) === CH_BACKTICK) i++;
  return i;
}

/** Start of the first run of exactly `n` backticks in [i, e), or -1. */
function closingRun(text: string, i: number, e: number, n: number): number {
  for (let c = nextBacktick(text, i, e); c >= 0; c = nextBacktick(text, i, e)) {
    i = runEnd(text, c, e);
    if (i - c === n) return c;
  }
  return -1;
}

/** Run length → start of the last run of that length in [i, e). */
function lastRunsFrom(text: string, i: number, e: number): Map<number, number> {
  const last = new Map<number, number>();
  for (let c = nextBacktick(text, i, e); c >= 0; c = nextBacktick(text, i, e)) {
    i = runEnd(text, c, e);
    last.set(i - c, c);
  }
  return last;
}
