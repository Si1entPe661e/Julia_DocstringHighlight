import * as vscode from 'vscode';

/** Log channel: info records activation and settings changes; trace records scan timings. */
export function createLog(): vscode.LogOutputChannel {
  return vscode.window.createOutputChannel('Julia Docstring Highlighter', { log: true });
}
