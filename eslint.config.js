import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/coverage/',
      'e2e/.stack/',
      'test-results/',
      'playwright-report/',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },

  // Root config files
  {
    files: ['*.js'],
    languageOptions: { globals: globals.node },
  },

  // Server (Node)
  {
    files: ['server/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      // Use the Pino logger, never console (console is allowed only in config/env.ts before the logger exists).
      'no-console': 'error',
    },
  },
  {
    files: ['server/src/config/env.ts'],
    rules: { 'no-console': 'off' },
  },

  // Client (browser, React)
  {
    files: ['client/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // Accessibility (spec §13.3, §17: WCAG 2.1 AA) – static JSX checks on the app code.
  {
    ...jsxA11y.flatConfigs.recommended,
    files: ['client/src/**/*.tsx'],
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // `role` on our own components is a prop (e.g. <FollowupDetail role="patient" />).
      'jsx-a11y/aria-role': ['error', { ignoreNonDOM: true }],
      // Checkbox labels put their text in nested spans (title + description).
      'jsx-a11y/label-has-associated-control': ['error', { depth: 3 }],
    },
  },

  // Tests (Vitest globals, in case a test uses them without importing)
  {
    files: ['**/*.test.{ts,tsx}', '**/tests/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node, ...globals.vitest } },
  },

  // Must be last: turn off rules that conflict with Prettier.
  prettier,
);
