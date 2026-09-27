// Scan scheduling: a 100 ms debounce per document and a cache keyed by uri + version.
// Several editors showing the same document share one cached result.
import * as vscode from 'vscode';
import { scan, type ScanResult } from './detector';

const EMPTY: ScanResult = { docstrings: [], inlineCode: [], durationMs: 0 };

export class Scheduler implements vscode.Disposable {
  private readonly cache = new Map<string, { version: number; result: ScanResult }>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly log: vscode.LogOutputChannel,
    private readonly delayMs = 100,
  ) {}

  /** The result for the document's current version; scans now when it is not cached. */
  resultFor(document: vscode.TextDocument): ScanResult {
    const key = document.uri.toString();
    const cached = this.cache.get(key);
    if (cached !== undefined && cached.version === document.version) return cached.result;
    const result = this.scan(document);
    this.cache.set(key, { version: document.version, result });
    return result;
  }

  /** Runs `callback` once edits to the document have paused for the debounce delay. */
  schedule(document: vscode.TextDocument, callback: () => void): void {
    const key = document.uri.toString();
    const pending = this.timers.get(key);
    if (pending !== undefined) clearTimeout(pending);
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        callback();
      }, this.delayMs),
    );
  }

  forget(uri: vscode.Uri): void {
    const key = uri.toString();
    const pending = this.timers.get(key);
    if (pending !== undefined) clearTimeout(pending);
    this.timers.delete(key);
    this.cache.delete(key);
  }

  clear(): void {
    for (const pending of this.timers.values()) clearTimeout(pending);
    this.timers.clear();
    this.cache.clear();
  }

  dispose(): void {
    this.clear();
  }

  private scan(document: vscode.TextDocument): ScanResult {
    try {
      const result = scan(document.getText());
      this.log.trace(
        `scanned ${document.uri.toString(true)} v${document.version}: ${result.docstrings.length} docstrings, ` +
          `${result.inlineCode.length} inline code spans in ${result.durationMs.toFixed(2)} ms`,
      );
      return result;
    } catch (error) {
      // A detector bug must not break other documents: log it and leave this one undecorated.
      this.log.error(`scan failed for ${document.uri.toString(true)}`, error);
      return EMPTY;
    }
  }
}
