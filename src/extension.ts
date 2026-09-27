// Activation and wiring only: modules are assembled here and every Disposable goes into
// context.subscriptions. Layer 3 (the injection grammar) is static and needs no code.
import * as vscode from 'vscode';
import { onDidChangeSettings, readSettings } from './configuration';
import { Decorations, type AppliedDecorations } from './decorations';
import { reportJuliaGrammar } from './julia-extension';
import { createLog } from './logging';
import { Scheduler } from './scheduler';

export const DEBUG_GET_REGIONS = 'juliaDocstringHighlight.debug.getRegions';

/** One visible editor's applied decorations, as returned by the hidden debug command. */
export interface DebugEditorState extends AppliedDecorations {
  uri: string;
  viewColumn: number | undefined;
  /** Whether the extension has processed this editor since the decoration types were (re)created. */
  processed: boolean;
}

export function activate(context: vscode.ExtensionContext): void {
  const log = createLog();
  let settings = readSettings();
  const decorations = new Decorations(settings);
  const scheduler = new Scheduler(log);
  context.subscriptions.push(log, decorations, scheduler);

  const refresh = (editor: vscode.TextEditor): void => {
    if (!settings.enabled) return;
    if (editor.document.languageId === 'julia') decorations.apply(editor, scheduler.resultFor(editor.document));
    else decorations.clear(editor);
  };
  const refreshDocument = (document: vscode.TextDocument): void => {
    const uri = document.uri.toString();
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === uri) refresh(editor);
    }
  };

  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((editors) => editors.forEach(refresh)),
    vscode.workspace.onDidChangeTextDocument((event) => {
      const document = event.document;
      if (!settings.enabled || document.languageId !== 'julia' || event.contentChanges.length === 0) return;
      if (!vscode.window.visibleTextEditors.some((editor) => editor.document === document)) return;
      scheduler.schedule(document, () => refreshDocument(document));
    }),
    // Changing a document's language mode closes and reopens it.
    vscode.workspace.onDidOpenTextDocument(refreshDocument),
    vscode.workspace.onDidCloseTextDocument((document) => scheduler.forget(document.uri)),
    onDidChangeSettings((next) => {
      settings = next;
      log.info(`Settings changed: ${JSON.stringify(next)}`);
      decorations.rebuild(next);
      if (next.enabled) vscode.window.visibleTextEditors.forEach(refresh);
      else scheduler.clear();
    }),
    vscode.commands.registerCommand(DEBUG_GET_REGIONS, (uri?: string): DebugEditorState[] => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri.toString();
      return vscode.window.visibleTextEditors
        .filter((editor) => editor.document.uri.toString() === target)
        .map((editor) => {
          const applied = decorations.snapshot(editor);
          return {
            uri: editor.document.uri.toString(),
            viewColumn: editor.viewColumn,
            processed: applied !== undefined,
            ...(applied ?? { background: [], guide: [], inlineCode: [] }),
          };
        });
    }),
  );

  log.info(`Activated with settings ${JSON.stringify(settings)}`);
  reportJuliaGrammar(log);
  vscode.window.visibleTextEditors.forEach(refresh);
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions; disposing the decoration types removes
  // their decorations from all editors.
}
