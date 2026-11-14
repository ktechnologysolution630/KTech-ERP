import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Remaining cases are object-URL previews, data loading on mount and syncing a controlled
      // value; keep them visible as warnings rather than failing lint.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    // Plain Node scripts run by npm (predev/prebuild) are CommonJS
    files: ['scripts/**/*.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Local databases, uploads and copied OCR assets
    '.pglite/**',
    '.pglite-*/**',
    '.uploads/**',
    '.superpowers/**',
    'public/ocr/**',
    // Claude Code worktrees are whole checkouts with their own .next builds
    '.claude/**',
  ]),
]);

export default eslintConfig;
