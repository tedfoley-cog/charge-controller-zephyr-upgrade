import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['console/**/*.js', 'console/**/*.mjs', 'tests/ui/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser, ...globals.node } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }], eqeqeq: ['error', 'smart'] },
  },
];
