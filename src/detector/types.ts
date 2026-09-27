// Public data types of the docstring detector.
// Positions are 0-based; columns are UTF-16 code units, the same unit as vscode.Position.

export interface Pos {
  line: number;
  col: number;
}

export interface Docstring {
  kind: 'plain' | 'atdoc';
  quote: 'single' | 'triple';
  /** String macro prefix, e.g. "raw" in `@doc raw"""…"""`. Only atdoc docstrings can have one. */
  prefix: string | null;
  /** `@doc` (or the first token of a `Mod.@doc` chain) or the opening quote. */
  start: Pos;
  /** Just after the closing quotes (exclusive). */
  end: Pos;
  contentStart: Pos;
  contentEnd: Pos;
  /** Line of the first token of the documented expression; for tests and debugging. */
  targetLine: number;
}

/** An inline code span inside docstring prose, backticks included. */
export interface InlineCodeSpan {
  line: number;
  startCol: number;
  endCol: number;
}

export interface ScanResult {
  docstrings: Docstring[];
  inlineCode: InlineCodeSpan[];
  durationMs: number;
}

/** Offset-based docstring record used between the detector modules. */
export interface RawDocstring {
  kind: 'plain' | 'atdoc';
  triple: boolean;
  /** Offset of the string macro prefix, or -1. */
  prefixStart: number;
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
  targetOffset: number;
}
