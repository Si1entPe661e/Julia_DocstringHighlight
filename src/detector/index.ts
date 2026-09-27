// Layer 1 entry point: text → ScanResult. Pure; no dependency on vscode (02 §4).

import { findDocstrings } from './docstrings';
import { extractInlineCode, lineOf } from './inlineCode';
import type { Docstring, Pos, RawDocstring, ScanResult } from './types';

export type { Docstring, InlineCodeSpan, Pos, ScanResult } from './types';

export function scan(text: string): ScanResult {
  const t0 = performance.now();
  const raw = findDocstrings(text);
  if (raw.length === 0) return { docstrings: [], inlineCode: [], durationMs: performance.now() - t0 };
  const lineStarts = computeLineStarts(text);
  const docstrings = raw.map((d) => toDocstring(text, lineStarts, d));
  const inlineCode = extractInlineCode(text, lineStarts, raw);
  return { docstrings, inlineCode, durationMs: performance.now() - t0 };
}

/** Offsets at which lines start; `\n`, `\r\n` and a lone `\r` each end a line, as in VS Code. */
export function computeLineStarts(text: string): number[] {
  const starts = [0];
  if (text.indexOf('\r') < 0) {
    for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
    return starts;
  }
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x0a) {
      starts.push(i + 1);
    } else if (c === 0x0d) {
      if (text.charCodeAt(i + 1) === 0x0a) i++;
      starts.push(i + 1);
    }
  }
  return starts;
}

function toDocstring(text: string, lineStarts: readonly number[], d: RawDocstring): Docstring {
  const pos = (offset: number): Pos => {
    const line = lineOf(lineStarts, offset);
    return { line, col: offset - (lineStarts[line] ?? 0) };
  };
  const openQuote = d.contentStart - (d.triple ? 3 : 1);
  return {
    kind: d.kind,
    quote: d.triple ? 'triple' : 'single',
    prefix: d.prefixStart >= 0 ? text.slice(d.prefixStart, openQuote) : null,
    start: pos(d.start),
    end: pos(d.end),
    contentStart: pos(d.contentStart),
    contentEnd: pos(d.contentEnd),
    targetLine: lineOf(lineStarts, d.targetOffset),
  };
}
