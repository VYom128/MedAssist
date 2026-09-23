import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/', '**/dist/', '**/coverage/'] },

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

  // Must be last: turn off rules that conflict with Prettier.
  prettier,
);
