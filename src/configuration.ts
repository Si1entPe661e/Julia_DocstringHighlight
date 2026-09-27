// The four settings of v0.1 (01 §7). Colors are not settings: they are theme color slots (05 §3).
import * as vscode from 'vscode';

export const SECTION = 'juliaDocstringHighlight';

export interface Settings {
  enabled: boolean;
  showBackground: boolean;
  showGuide: boolean;
  showInlineCodeBackground: boolean;
}

export function readSettings(): Settings {
  const config = vscode.workspace.getConfiguration(SECTION);
  return {
    enabled: config.get<boolean>('enabled', true),
    showBackground: config.get<boolean>('showBackground', true),
    showGuide: config.get<boolean>('showGuide', true),
    showInlineCodeBackground: config.get<boolean>('showInlineCodeBackground', true),
  };
}

export function onDidChangeSettings(listener: (settings: Settings) => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(SECTION)) listener(readSettings());
  });
}
