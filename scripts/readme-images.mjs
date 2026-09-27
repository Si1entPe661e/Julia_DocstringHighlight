// Renders the README images (images/readme): excerpts of test/fixtures/showcase.jl in a real VS Code
// window, with and without this extension, framed the way CodeSnap (adpyke.codesnap) frames its
// snapshots with its default settings.
//
// CodeSnap itself is not used: it takes the selection through "Copy With Syntax Highlighting", which
// carries the token colors but no editor decorations, so the docstring region, its guide and the
// inline code chips would be missing. Instead the editor is captured as rendered, in device pixels
// (2× on a Retina display), and the frame is drawn around that image in the same window.
//
// Usage: node scripts/readme-images.mjs   (after `npm run compile`; see vscode-session.mjs)
import path from 'node:path';
import { openInVSCode, root } from './vscode-session.mjs';

/** Excerpts of showcase.jl, as [first, last] line numbers of the gutter. */
const SHOTS = [
  { file: 'hero.png', theme: 'Dark Modern', withExtension: true, lines: [24, 57] },
  { file: 'dark-modern-before.png', theme: 'Dark Modern', withExtension: false, lines: [7, 22] },
  { file: 'dark-modern-after.png', theme: 'Dark Modern', withExtension: true, lines: [7, 22] },
  { file: 'light-modern-before.png', theme: 'Light Modern', withExtension: false, lines: [7, 22] },
  { file: 'light-modern-after.png', theme: 'Light Modern', withExtension: true, lines: [7, 22] },
];

/** CodeSnap's defaults (its webview/style.css and configuration). */
const CODESNAP = {
  background: '#abb8c3',
  padding: '39px', // 3em at the webview's 13px font size
  radius: '4px',
  shadow: 'rgba(0, 0, 0, 0.55) 0px 20px 68px',
  windowPadding: '18px',
  controls: ['#ff5f5a', '#ffbe2e', '#2aca44'],
};

/**
 * No current line, word or bracket highlights, indent guides, folding controls, glyph margin, or the
 * shadow that marks a scrolled editor.
 */
const SETTINGS = {
  'editor.scrollbar.useShadows': false,
  'editor.renderLineHighlight': 'none',
  'editor.occurrencesHighlight': 'off',
  'editor.selectionHighlight': false,
  'editor.matchBrackets': 'never',
  'editor.guides.indentation': false,
  'editor.folding': false,
  'editor.glyphMargin': false,
  'editor.hover.enabled': false,
  'editor.lightbulb.enabled': 'off',
};

async function capture({ file, theme, withExtension, lines: [first, last] }) {
  // The line above the excerpt goes to the top of the editor, whose rounded corner stays out of the image.
  const topLine = Math.max(1, first - 1);
  const { window, close } = await openInVSCode({
    file: path.join(root, 'test/fixtures/showcase.jl'),
    settings: { 'workbench.colorTheme': theme, ...SETTINGS },
    // `revealLine` counts lines from 0.
    keybindings: [{ key: 'ctrl+alt+shift+f9', command: 'revealLine', args: { lineNumber: topLine - 1, at: 'top' } }],
    withExtension,
  });
  try {
    await window.keyboard.press('Control+Alt+Shift+F9');
    await window.waitForFunction(
      (topLine) => {
        const editor = document.querySelector('.editor-instance .monaco-editor');
        const line = [...editor.querySelectorAll('.margin-view-overlays .line-numbers')].find((e) => e.textContent.trim() === String(topLine));
        return line !== undefined && Math.abs(line.getBoundingClientRect().top - editor.getBoundingClientRect().top) < 1;
      },
      topLine,
      { timeout: 10_000 },
    );
    await window.waitForTimeout(300);
    // The excerpt spans the gutter and the text up to just after its longest line.
    const excerpt = await window.evaluate(
      ([first, last]) => {
        const editor = document.querySelector('.editor-instance .monaco-editor');
        const cursors = editor.querySelector('.cursors-layer');
        if (cursors) cursors.style.display = 'none';
        const numbers = [...editor.querySelectorAll('.margin-view-overlays .line-numbers')];
        const lineBox = (n) => numbers.find((e) => e.textContent.trim() === String(n))?.getBoundingClientRect();
        const top = lineBox(first);
        const bottom = lineBox(last);
        if (!top || !bottom) return null;
        const left = editor.getBoundingClientRect().left;
        let right = left;
        for (const line of editor.querySelectorAll('.view-lines .view-line')) {
          const r = line.getBoundingClientRect();
          if (r.top < top.top - 1 || r.bottom > bottom.bottom + 1) continue;
          for (const span of line.children) right = Math.max(right, span.getBoundingClientRect().right);
        }
        const background = getComputedStyle(editor.querySelector('.monaco-editor-background') ?? editor).backgroundColor;
        const x = Math.floor(left);
        const y = Math.round(top.top);
        return { x, y, width: Math.ceil(right) + 8 - x, height: Math.round(bottom.bottom) - y, background };
      },
      [first, last],
    );
    if (!excerpt) throw new Error(`lines ${first}–${last} do not fit in the window`);
    const { background, ...clip } = excerpt;
    const png = await window.screenshot({ clip, scale: 'device' });
    const fits = await window.evaluate(
      async ({ src, width, height, background, style }) => {
        const el = (tag, css, parent) => {
          const e = document.createElement(tag);
          Object.assign(e.style, css);
          parent.appendChild(e);
          return e;
        };
        const container = el('div', { position: 'fixed', left: '0', top: '0', zIndex: '100000', padding: style.padding, background: style.background }, document.body);
        container.id = 'codesnap';
        const frame = el('div', { borderRadius: style.radius, boxShadow: style.shadow, overflow: 'hidden', padding: style.windowPadding, background }, container);
        const controls = el('div', { display: 'flex', marginTop: '2px', marginBottom: '15px' }, frame);
        for (const color of style.controls) el('div', { width: '15px', height: '15px', borderRadius: '50%', marginRight: '10px', background: color }, controls);
        const image = el('img', { display: 'block', width: `${width}px`, height: `${height}px` }, frame);
        image.src = src;
        await image.decode();
        const box = container.getBoundingClientRect();
        return box.right <= innerWidth && box.bottom <= innerHeight;
      },
      { src: `data:image/png;base64,${png.toString('base64')}`, width: clip.width, height: clip.height, background, style: CODESNAP },
    );
    if (!fits) throw new Error('the framed image does not fit in the window');
    await window.locator('#codesnap').screenshot({ path: path.join(root, 'images/readme', file), scale: 'device' });
  } finally {
    await close();
  }
}

let failures = 0;
for (const shot of SHOTS) {
  for (let attempt = 1; ; attempt++) {
    try {
      await capture(shot);
      console.log(`images/readme/${shot.file}`);
      break;
    } catch (error) {
      console.error(`images/readme/${shot.file}: attempt ${attempt} failed: ${error instanceof Error ? error.message : error}`);
      if (attempt === 2) {
        failures++;
        break;
      }
    }
  }
}
process.exit(failures ? 1 : 0);
