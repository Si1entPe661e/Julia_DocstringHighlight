// Renders test/fixtures/showcase.jl in a real VS Code window, with and without this extension, for the
// theme check (05 §8) and the README's before / after images.
//
// Uses the VS Code build that the integration tests download into .vscode-test (run
// `npm run test:integration` once) and Playwright's Electron driver, which captures the editor element
// only. Each run gets fresh, throwaway user data and extensions directories. The extension (built
// with `npm run compile`) and third-party themes are copied in as ordinary installed extensions:
// `--extensionDevelopmentPath` is not used because VS Code 1.139 gives Extension Development Host
// windows their own theme (Abyss) regardless of `workbench.colorTheme`.
//
// Usage: node scripts/screenshots.mjs [--out images/themes] [--themes "Dark Modern,Light Modern"]
//   THEME_EXTENSIONS_DIR  directory with installed theme extensions (default ~/.vscode/extensions)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...args) => process.env.DEBUG_SCREENSHOTS && console.error(new Date().toISOString().slice(11, 19), ...args);
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

/** Theme label → the extension that contributes it (undefined for VS Code's built-in themes). */
const THEMES = {
  'Dark Modern': undefined,
  'Light Modern': undefined,
  'Dark+': undefined,
  'Light+': undefined,
  'Dark 2026': undefined,
  'Light 2026': undefined,
  'Default High Contrast': undefined,
  'Default High Contrast Light': undefined,
  'GitHub Dark Default': 'github.github-vscode-theme',
  'GitHub Light Default': 'github.github-vscode-theme',
  'Atom One Dark': 'akamud.vscode-theme-onedark',
};

/** Themes whose before / after shots are also written to images/readme for the README. */
const README_THEMES = ['Dark Modern', 'Light Modern'];

const outDir = path.resolve(root, arg('--out', 'images/themes'));
const themes = (arg('--themes') ?? Object.keys(THEMES).join(',')).split(',').map((t) => t.trim());
const themeExtensions = process.env.THEME_EXTENSIONS_DIR ?? path.join(os.homedir(), '.vscode/extensions');

/** The newest VS Code build in .vscode-test that has an executable (VSCODE_PATH overrides). */
function vscodeExecutable() {
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

function themeExtensionPath(id) {
  if (id === undefined) return undefined;
  const dir = fs
    .readdirSync(themeExtensions)
    .filter((d) => d.toLowerCase().startsWith(id.toLowerCase() + '-'))
    .sort()
    .pop();
  return dir ? path.join(themeExtensions, dir) : undefined;
}

const slug = (s) => s.toLowerCase().replace(/\+/g, '-plus').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function capture(theme, withExtension, file) {
  const themeExtension = themeExtensionPath(THEMES[theme]);
  if (THEMES[theme] !== undefined && themeExtension === undefined) {
    console.log(`skip ${theme}: ${THEMES[theme]} is not installed in ${themeExtensions}`);
    return false;
  }
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'jdh-shot-'));
  fs.mkdirSync(path.join(userData, 'User'), { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'User/settings.json'),
    JSON.stringify(
      {
        'workbench.colorTheme': theme,
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
      },
      null,
      2,
    ),
  );
  const extensionsDir = path.join(userData, 'extensions');
  fs.mkdirSync(extensionsDir);
  if (withExtension) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const target = path.join(extensionsDir, `${manifest.publisher}.${manifest.name}-${manifest.version}`);
    for (const entry of ['package.json', 'dist', 'syntaxes', 'README.md', 'LICENSE']) {
      if (fs.existsSync(path.join(root, entry))) fs.cpSync(path.join(root, entry), path.join(target, entry), { recursive: true });
    }
  }
  if (themeExtension) fs.cpSync(themeExtension, path.join(extensionsDir, path.basename(themeExtension)), { recursive: true });
  log('launch', theme, withExtension ? 'with extension' : 'without extension');
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
      path.join(root, 'test/fixtures/showcase.jl'),
    ],
    timeout: 60_000,
  });
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
    await editor.screenshot({ path: file });
    if (README_THEMES.includes(theme)) {
      // README images: lines 1–27 at one pixel per CSS pixel.
      const box = await editor.boundingBox();
      const readme = path.join(root, 'images/readme', path.basename(file));
      fs.mkdirSync(path.dirname(readme), { recursive: true });
      await window.screenshot({ path: readme, scale: 'css', clip: { x: box.x, y: box.y, width: 860, height: 21 * 27 + 6 } });
    }
    // With the extension: a close-up of the left edge of the first docstrings (lines 6–21), to check
    // the 1px guide (05 §2), and a view of the examples.
    const lines = withExtension ? await editor.locator('.view-lines').boundingBox() : null;
    if (lines) {
      await window.screenshot({
        path: file.replace(/\.png$/, '-edge.png'),
        clip: { x: lines.x - 30, y: lines.y + 21 * 5, width: 150, height: 21 * 16 },
      });
      // The examples and the code after the docstring, to compare fenced Julia with real code: Go to
      // Line 60 centers the view on the end of the run_mle docstring (synthetic wheel events barely scroll).
      await editor.click({ position: { x: lines.x - (await editor.boundingBox()).x + 400, y: 10 } });
      await window.keyboard.press('Control+G');
      await window.keyboard.type('60');
      await window.keyboard.press('Enter');
      await window.waitForTimeout(800);
      await editor.screenshot({ path: file.replace(/\.png$/, '-examples.png') });
    }
    return true;
  } finally {
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
  }
}

fs.mkdirSync(outDir, { recursive: true });
let failures = 0;
for (const theme of themes) {
  if (!(theme in THEMES)) throw new Error(`unknown theme "${theme}"`);
  for (const withExtension of [false, true]) {
    const file = path.join(outDir, `${slug(theme)}-${withExtension ? 'after' : 'before'}.png`);
    for (let attempt = 1; ; attempt++) {
      try {
        if (await capture(theme, withExtension, file)) console.log(path.relative(root, file));
        break;
      } catch (error) {
        console.error(`${path.relative(root, file)}: attempt ${attempt} failed: ${error instanceof Error ? error.message : error}`);
        if (attempt === 2) {
          failures++;
          break;
        }
      }
    }
  }
}
process.exit(failures ? 1 : 0);
