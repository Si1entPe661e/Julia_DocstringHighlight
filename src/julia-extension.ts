// Soft dependency on the official Julia extension.
//
// VS Code ships a built-in `vscode.julia` extension that registers the `julia` language and the same
// `source.julia` grammar (identical `string.docstring.julia` rules and repository names), so
// this extension works without the official one. Its presence is therefore only logged.
import * as vscode from 'vscode';

const OFFICIAL_IDS = ['julialang.language-julia', 'julialang.language-julia-insider'];

export function reportJuliaGrammar(log: vscode.LogOutputChannel): void {
  for (const id of OFFICIAL_IDS) {
    const extension = vscode.extensions.getExtension(id);
    if (extension !== undefined) {
      const version = (extension.packageJSON as { version?: string }).version ?? 'unknown version';
      log.info(`Julia grammar provided by ${id} ${version}`);
      return;
    }
  }
  log.info('The official Julia extension is not installed; using the built-in Julia grammar (vscode.julia).');
}
