// Integration test configuration for @vscode/test-cli.
//
// VS Code ships a built-in `vscode.julia` extension that registers the `julia` language and the same
// `source.julia` grammar as the official extension, so the official Julia extension is not required
// here. Set VSCODE_TEST_INSTALL_JULIA=1 to install it anyway (it also starts the language server).
//
//   VSCODE_TEST_VERSION   VS Code version to download (default: stable; e.g. 1.108.0 = engines minimum)
//   VSCODE_TEST_PATH      use an existing VS Code executable instead of downloading one
import { defineConfig } from '@vscode/test-cli';

const installJulia = Boolean(process.env.VSCODE_TEST_INSTALL_JULIA);

export default defineConfig({
  label: 'integration',
  files: 'out/test/integration/**/*.test.js',
  version: process.env.VSCODE_TEST_VERSION ?? 'stable',
  ...(process.env.VSCODE_TEST_PATH ? { useInstallation: { fromPath: process.env.VSCODE_TEST_PATH } } : {}),
  workspaceFolder: 'test/fixtures',
  installExtensions: installJulia ? ['julialang.language-julia'] : [],
  // --disable-extensions keeps built-in extensions (including vscode.julia) and the extension under test.
  // --force-disable-user-env skips resolving the login shell environment, which is slow on some setups.
  launchArgs: [
    ...(installJulia ? [] : ['--disable-extensions']),
    '--skip-welcome',
    '--skip-release-notes',
    '--force-disable-user-env',
  ],
  mocha: {
    ui: 'bdd',
    timeout: 20000,
  },
});
