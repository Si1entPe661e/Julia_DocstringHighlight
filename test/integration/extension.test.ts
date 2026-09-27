// Integration tests in the Extension Host (06 §4). Decorations cannot be read back through the API,
// so the hidden command juliaDocstringHighlight.debug.getRegions reports what was applied.
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { DebugEditorState } from '../../src/extension';
import { FIXTURES, readExpected } from '../fixtureData';

const EXTENSION_ID = 'lizhicheng.julia-docstring-highlighter';
const COMMAND = 'juliaDocstringHighlight.debug.getRegions';
const SECTION = 'juliaDocstringHighlight';

async function getRegions(uri?: vscode.Uri): Promise<DebugEditorState[]> {
  return (await vscode.commands.executeCommand<DebugEditorState[]>(COMMAND, uri?.toString())) ?? [];
}

/** Polls until `check` passes (the debounce is 100 ms; configuration events are asynchronous). */
async function eventually(check: () => Promise<void>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await check();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

function lines(ranges: number[][]): Array<[number, number]> {
  return ranges.map((r) => [r[0] ?? -1, r[2] ?? -1]);
}

function expectedLines(fixture: string): Array<[number, number]> {
  return readExpected(fixture).docstrings.map((d) => [d.start, d.end]);
}

async function open(fixture: string, column = vscode.ViewColumn.One): Promise<vscode.TextEditor> {
  const document = await vscode.workspace.openTextDocument(path.join(FIXTURES, fixture));
  return vscode.window.showTextDocument(document, { viewColumn: column, preview: false });
}

async function setSetting(key: string, value: boolean | undefined): Promise<void> {
  await vscode.workspace.getConfiguration(SECTION).update(key, value, vscode.ConfigurationTarget.Global);
}

describe('extension (06 §4)', function () {
  this.timeout(20000);

  before(async () => {
    // Recent VS Code builds open the Chat view on startup; keep the focus in the editor area.
    await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
    await vscode.commands.executeCommand('workbench.action.closePanel');
  });

  afterEach(async () => {
    for (const key of ['enabled', 'showBackground', 'showGuide', 'showInlineCodeBackground']) await setSetting(key, undefined);
    // Revert every modified document so that no hot-exit backup survives into the next run.
    for (const document of vscode.workspace.textDocuments.filter((d) => d.isDirty)) {
      await vscode.window.showTextDocument(document);
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    }
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  it('1. activates for a Julia document', async () => {
    const editor = await open('basic.jl');
    assert.equal(editor.document.languageId, 'julia');
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} is not installed in the test instance`);
    await eventually(async () => assert.ok(extension.isActive));
  });

  it('2. applies the regions of the fixture', async () => {
    const editor = await open('basic.jl');
    await eventually(async () => {
      const [state] = await getRegions(editor.document.uri);
      assert.ok(state);
      assert.deepEqual(lines(state.background), expectedLines('basic.jl'));
      assert.deepEqual(state.guide, state.background);
    });
    const [state] = await getRegions(editor.document.uri);
    // The first region ends right after the closing quotes of line 6, not at the start of line 7.
    assert.deepEqual(state?.background[0], [2, 0, 6, 3]);
  });

  it('2b. applies inline code chips', async () => {
    const editor = await open('markdown.jl');
    await eventually(async () => {
      const [state] = await getRegions(editor.document.uri);
      assert.deepEqual(
        state?.inlineCode,
        readExpected('markdown.jl').inlineCode.map(([line, start, end]) => [line, start, line, end]),
      );
    });
  });

  it('3. updates after an edit that breaks a docstring', async () => {
    const editor = await open('basic.jl');
    const before = expectedLines('basic.jl');
    await eventually(async () => assert.deepEqual(lines((await getRegions(editor.document.uri))[0]?.background ?? []), before));

    // A blank line between the closing quotes (line 6) and `function foo() end` breaks the first docstring.
    assert.ok(await editor.edit((edit) => edit.insert(new vscode.Position(7, 0), '\n')), 'edit was not applied');
    assert.equal(editor.document.lineAt(7).text, '');
    const after = before.slice(1).map(([s, e]): [number, number] => [s + 1, e + 1]);
    await eventually(async () => assert.deepEqual(lines((await getRegions(editor.document.uri))[0]?.background ?? []), after));

    // Remove the blank line again: the docstring comes back.
    assert.ok(await editor.edit((edit) => edit.delete(new vscode.Range(7, 0, 8, 0))), 'edit was not applied');
    await eventually(async () => assert.deepEqual(lines((await getRegions(editor.document.uri))[0]?.background ?? []), before));
  });

  it('4. enabled = false clears everything; true restores it', async () => {
    const editor = await open('basic.jl');
    const uri = editor.document.uri;
    await eventually(async () => assert.equal((await getRegions(uri))[0]?.background.length, 12));

    await setSetting('enabled', false);
    await eventually(async () => {
      const [state] = await getRegions(uri);
      assert.deepEqual(state?.background, []);
      assert.deepEqual(state?.guide, []);
      assert.deepEqual(state?.inlineCode, []);
    });

    await setSetting('enabled', true);
    await eventually(async () => assert.deepEqual(lines((await getRegions(uri))[0]?.background ?? []), expectedLines('basic.jl')));
  });

  it('4b. each decoration can be switched off on its own', async () => {
    const editor = await open('markdown.jl');
    const uri = editor.document.uri;
    await setSetting('showBackground', false);
    await eventually(async () => {
      const [state] = await getRegions(uri);
      assert.deepEqual(state?.background, []);
      assert.equal(state?.guide.length, 1);
      assert.equal(state?.inlineCode.length, 7);
    });
    await setSetting('showGuide', false);
    await setSetting('showInlineCodeBackground', false);
    await eventually(async () => {
      const [state] = await getRegions(uri);
      assert.deepEqual([state?.background, state?.guide, state?.inlineCode], [[], [], []]);
    });
  });

  it('5. a non-Julia document gets nothing', async () => {
    const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '"""\ndocs\n"""\nf(x) = x\n' });
    await vscode.window.showTextDocument(document);
    const [state] = await getRegions(document.uri);
    assert.ok(state);
    assert.equal(state.processed, false);
    assert.deepEqual([state.background, state.guide, state.inlineCode], [[], [], []]);
  });

  it('5b. switching the language mode away from Julia removes the decorations', async () => {
    const document = await vscode.workspace.openTextDocument({ language: 'julia', content: '"""\ndocs\n"""\nf(x) = x\n' });
    await vscode.window.showTextDocument(document);
    await eventually(async () => assert.equal((await getRegions(document.uri))[0]?.background.length, 1));
    const plain = await vscode.languages.setTextDocumentLanguage(document, 'plaintext');
    await eventually(async () => {
      const states = await getRegions(plain.uri);
      assert.ok(states.length > 0);
      for (const state of states) assert.deepEqual(state.background, []);
    });
  });

  it('6. both editors of a split file are decorated', async () => {
    const editor = await open('basic.jl');
    await vscode.window.showTextDocument(editor.document, { viewColumn: vscode.ViewColumn.Two, preview: false });
    await eventually(async () => {
      const states = await getRegions(editor.document.uri);
      assert.equal(states.length, 2);
      assert.deepEqual(lines(states[0]?.background ?? []), expectedLines('basic.jl'));
      assert.deepEqual(states[1]?.background, states[0]?.background);
    });
  });

  it('false positives stay undecorated in the editor', async () => {
    const editor = await open('multiline-string.jl');
    await eventually(async () => assert.equal((await getRegions(editor.document.uri))[0]?.processed, true));
    const [state] = await getRegions(editor.document.uri);
    assert.deepEqual([state?.background, state?.guide, state?.inlineCode], [[], [], []]);
  });
});
