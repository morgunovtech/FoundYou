// ESLint 10 flat config. Legacy `.eslintrc.cjs` was removed together with
// eslint-plugin-react (React 17+ JSX transform needs neither `react-in-jsx-scope`
// nor `prop-types`, and TypeScript covers the rest).
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['dist', 'node_modules', 'public/**', '.claude/**']),

  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    extends: [js.configs.recommended]
  },

  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommended],
    rules: {
      // Widely used around exifr / libheif payloads; tighten in a follow-up.
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },

  // Browser app code (React 18, Vite HMR).
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: {
      globals: { ...globals.browser }
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      // `npm run lint` fails on errors only, so a rule that is meant to gate a merge must be one.
      'react-hooks/exhaustive-deps': 'error',
      // React Compiler rule (react-hooks v7). Fires on the "reset state when the input
      // disappears" pattern in App / UploadZone / useExifMetadata / useImageAnalysis /
      // useOCR / theme. Kept visible as a warning until those effects are reworked.
      'react-hooks/set-state-in-effect': 'warn',
      // i18n/index.tsx and theme/index.tsx export a Provider next to its hook; Fast Refresh
      // falls back to a full reload for those two modules, which is acceptable.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }]
    }
  },

  // Node-side tooling and Cloudflare Pages Functions (Workers runtime shares the
  // fetch / Request / Response / URL surface with modern Node).
  {
    files: ['scripts/**/*.{js,mjs,cjs,ts}', 'vite.config.ts', 'eslint.config.js', 'functions/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node }
    }
  },

  // Must stay last: disables every formatting rule Prettier owns.
  prettier
]);
