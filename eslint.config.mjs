import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist/', 'out/', 'node_modules/', '.vscode-test/', 'docs/'] },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Node scripts (tools, perf).
    files: ['**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', performance: 'readonly', URL: 'readonly' },
    },
  },
  {
    // Layer 1 is a pure module: it must stay testable in plain Node (02 §4).
    files: ['src/detector/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: [{ name: 'vscode', message: 'src/detector must not depend on vscode.' }] }],
    },
  },
);
