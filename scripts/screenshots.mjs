// Renders test/fixtures/showcase.jl in a real VS Code window, with and without this extension, for the
// theme check. The README images come from readme-images.mjs.
//
// Captures the editor element only (see vscode-session.mjs for how VS Code is started).
//
// Usage: node scripts/screenshots.mjs [--out images/themes] [--themes "Dark Modern,Light Modern"]
//   THEME_EXTENSIONS_DIR  directory with installed theme extensions (default ~/.vscode/extensions)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openInVSCode, root } from './vscode-session.mjs';

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
  'Catppuccin Macchiato': 'catppuccin.catppuccin-vsc',
  'Tokyo Night Light': 'enkia.tokyo-night',
};

const outDir = path.resolve(root, arg('--out', 'images/themes'));
const themes = (arg('--themes') ?? Object.keys(THEMES).join(',')).split(',').map((t) => t.trim());
const themeExtensions = process.env.THEME_EXTENSIONS_DIR ?? path.join(os.homedir(), '.vscode/extensions');

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
  const { window, editor, close } = await openInVSCode({
    file: path.join(root, 'test/fixtures/showcase.jl'),
    settings: { 'workbench.colorTheme': theme },
    extensions: themeExtension ? [themeExtension] : [],
    withExtension,
  });
  try {
    await editor.screenshot({ path: file });
    // With the extension: a close-up of the left edge of the first docstrings (lines 6–21), to check
    // the 1px guide, and a view of the examples.
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
    await close();
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
