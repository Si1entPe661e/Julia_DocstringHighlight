// Opens a file in a real VS Code window for the screenshot scripts (screenshots.mjs, readme-images.mjs).
//
// Uses the VS Code build that the integration tests download into .vscode-test (run
// `npm run test:integration` once) and Playwright's Electron driver. Each session gets fresh,
// throwaway user data and extensions directories. The extension (built with `npm run compile`) and
// theme extensions are copied in as ordinary installed extensions: `--extensionDevelopmentPath` is
// not used because VS Code 1.139 gives Extension Development Host windows their own theme (Abyss)
// regardless of `workbench.colorTheme`.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const log = (...args) => process.env.DEBUG_SCREENSHOTS && console.error(new Date().toISOString().slice(11, 19), ...args);

/** A quiet editor: no tabs, breadcrumbs, minimap, sticky scroll, tips, updates or telemetry. */
const BASE_SETTINGS = {
  'workbench.startupEditor': 'none',
  'workbench.editor.showTabs': 'none',
  'workbench.secondarySideBar.defaultVisibility': 'hidden',
  'workbench.tips.enabled': false,
  'breadcrumbs.enabled': false,
  'editor.minimap.enabled': false,
  'editor.stickyScroll.enabled': false,
  'editor.fontSize': 14,
  'editor.lineHeight': 21,
  'editor.cursorBlinking': 'solid',
  'security.workspace.trust.enabled': false,
  'telemetry.telemetryLevel': 'off',
  'update.mode': 'none',
  'chat.disableAIFeatures': true,
};

/** The newest VS Code build in .vscode-test that has an executable (VSCODE_PATH overrides). */
export function vscodeExecutable() {
  if (process.env.VSCODE_PATH) return process.env.VSCODE_PATH;
  const dir = path.join(root, '.vscode-test');
  const builds = fs.existsSync(dir) ? fs.readdirSync(dir).filter((d) => d.startsWith('vscode-')) : [];
  builds.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const build of builds) {
    for (const exe of ['Visual Studio Code.app/Contents/MacOS/Code', 'code', 'Code.exe']) {
      const candidate = path.join(dir, build, exe);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error('No VS Code build in .vscode-test; run `npm run test:integration` first.');
}

/**
 * Opens `file` with `settings` on top of the quiet ones, and `keybindings`. `extensions` are
 * extension directories to install; `withExtension` installs this extension as well. Resolves once
 * the editor is tokenized and decorated, with the window, its editor and a function that closes both.
 */
export async function openInVSCode({ file, settings = {}, keybindings = [], extensions = [], withExtension = false }) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jdh-shot-'));
  fs.mkdirSync(path.join(userData, 'User'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'User/settings.json'), JSON.stringify({ ...BASE_SETTINGS, ...settings }, null, 2));
  fs.writeFileSync(path.join(userData, 'User/keybindings.json'), JSON.stringify(keybindings, null, 2));
  const extensionsDir = path.join(userData, 'extensions');
  fs.mkdirSync(extensionsDir);
  if (withExtension) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const target = path.join(extensionsDir, `${manifest.publisher}.${manifest.name}-${manifest.version}`);
    for (const entry of ['package.json', 'dist', 'syntaxes', 'README.md', 'LICENSE']) {
      if (fs.existsSync(path.join(root, entry))) fs.cpSync(path.join(root, entry), path.join(target, entry), { recursive: true });
    }
  }
  for (const dir of extensions) fs.cpSync(dir, path.join(extensionsDir, path.basename(dir)), { recursive: true });
  log('launch', path.basename(file), settings['workbench.colorTheme'], withExtension ? 'with extension' : 'without extension');
  const app = await electron.launch({
    executablePath: vscodeExecutable(),
    args: [
      `--user-data-dir=${userData}`,
      `--extensions-dir=${extensionsDir}`,
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-workspace-trust',
      '--disable-telemetry',
      '--disable-updates',
      '--force-disable-user-env',
      '--use-inmemory-secretstorage',
      file,
    ],
    timeout: 60_000,
  });
  const close = async () => {
    // app.close() can hang on VS Code; Electron's app.exit() skips the shutdown handshake. Helper
    // processes are then killed by their unique profile path so none outlives the run.
    const child = app.process();
    const exited = child.exitCode !== null ? Promise.resolve() : new Promise((resolve) => child.once('exit', resolve));
    // Schedule the exit so that the evaluation itself returns before the app goes away.
    await app
      .evaluate(({ app: electronApp }) => {
        setTimeout(() => electronApp.exit(0), 100);
      })
      .catch(() => {});
    await Promise.race([exited, sleep(5000)]);
    spawnSync('pkill', ['-9', '-f', userData]);
    fs.rmSync(userData, { recursive: true, force: true });
  };
  try {
    const window = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) w.setBounds({ x: 0, y: 0, width: 1180, height: 1340 });
    });
    log('window');
    const editor = window.locator('.editor-instance .monaco-editor').first();
    await editor.locator('.view-lines .view-line').first().waitFor({ timeout: 30_000 });
    log('editor rendered');
    // Tokenization, extension activation and the first decoration pass.
    await window.waitForTimeout(5000);
    return { window, editor, close };
  } catch (error) {
    await close();
    throw error;
  }
}
