// Layer 2: three independent decoration types. No color literals here: every color
// is a ThemeColor that refers to a `contributes.colors` slot, so theme switches need no code.
import * as vscode from 'vscode';
import type { Settings } from './configuration';
import type { ScanResult } from './detector';

/** [startLine, startCharacter, endLine, endCharacter] */
export type RangeTuple = [number, number, number, number];

/** What was last applied to an editor, for the debug command used by integration tests. */
export interface AppliedDecorations {
  background: RangeTuple[];
  guide: RangeTuple[];
  inlineCode: RangeTuple[];
}

export class Decorations implements vscode.Disposable {
  private background: vscode.TextEditorDecorationType | undefined;
  private guide: vscode.TextEditorDecorationType | undefined;
  private inlineCode: vscode.TextEditorDecorationType | undefined;
  private applied = new WeakMap<vscode.TextEditor, AppliedDecorations>();
  /**
   * Documents that may carry decorations. A language-mode change keeps the TextDocument object
   * (it is reported as close + open of the same document), so this survives it and lets `clear`
   * find the editors to clean up.
   */
  private decorated = new WeakSet<vscode.TextDocument>();

  constructor(settings: Settings) {
    this.create(settings);
  }

  /** Disposes the current types (VS Code removes their decorations) and creates them anew. */
  rebuild(settings: Settings): void {
    this.disposeTypes();
    this.applied = new WeakMap();
    this.decorated = new WeakSet();
    this.create(settings);
  }

  apply(editor: vscode.TextEditor, result: ScanResult): void {
    // End at the closing quotes, never at (end.line + 1, 0): a whole-line decoration would also
    // cover the next line.
    const regions = result.docstrings.map((d) => new vscode.Range(d.start.line, 0, d.end.line, d.end.col));
    const chips = result.inlineCode.map((s) => new vscode.Range(s.line, s.startCol, s.line, s.endCol));
    this.set(editor, regions, chips);
    this.decorated.add(editor.document);
  }

  /** Removes this extension's decorations from an editor whose document is no longer Julia. */
  clear(editor: vscode.TextEditor): void {
    if (!this.decorated.has(editor.document) && !this.applied.has(editor)) return;
    this.set(editor, [], []);
  }

  /** The decorations last applied to the editor, or undefined if it was never processed. */
  snapshot(editor: vscode.TextEditor): AppliedDecorations | undefined {
    return this.applied.get(editor);
  }

  dispose(): void {
    this.disposeTypes();
  }

  private set(editor: vscode.TextEditor, regions: vscode.Range[], chips: vscode.Range[]): void {
    if (this.background) editor.setDecorations(this.background, regions);
    if (this.guide) editor.setDecorations(this.guide, regions);
    if (this.inlineCode) editor.setDecorations(this.inlineCode, chips);
    this.applied.set(editor, {
      background: this.background ? regions.map(toTuple) : [],
      guide: this.guide ? regions.map(toTuple) : [],
      inlineCode: this.inlineCode ? chips.map(toTuple) : [],
    });
  }

  private create(settings: Settings): void {
    if (!settings.enabled) return;
    this.background = settings.showBackground
      ? vscode.window.createTextEditorDecorationType({
          isWholeLine: true,
          backgroundColor: new vscode.ThemeColor('juliaDocstring.background'),
          rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        })
      : undefined;
    this.guide = settings.showGuide
      ? vscode.window.createTextEditorDecorationType({
          isWholeLine: true,
          borderWidth: '0 0 0 1px',
          borderStyle: 'solid',
          borderColor: new vscode.ThemeColor('juliaDocstring.guide'),
          rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        })
      : undefined;
    this.inlineCode = settings.showInlineCodeBackground
      ? vscode.window.createTextEditorDecorationType({
          backgroundColor: new vscode.ThemeColor('juliaDocstring.inlineCodeBackground'),
          borderRadius: '3px',
          rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        })
      : undefined;
  }

  private disposeTypes(): void {
    this.background?.dispose();
    this.guide?.dispose();
    this.inlineCode?.dispose();
    this.background = this.guide = this.inlineCode = undefined;
  }
}

function toTuple(r: vscode.Range): RangeTuple {
  return [r.start.line, r.start.character, r.end.line, r.end.character];
}
