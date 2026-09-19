import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

// Deliberately minimal — this project had no linting at all before, so
// adopting a full opinionated style config in one shot would bury the rules
// that actually matter (no-undef, hook correctness) under hundreds of
// unrelated style warnings across existing files. Scoped to exactly the bug
// class that shipped a production crash: a renamed/removed identifier
// (setPendingImage) still referenced somewhere Vite's bundler doesn't check
// for (it only bundles/transpiles, it doesn't verify every reference
// resolves) — `no-undef` below is the rule that would have caught it.
export default [
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.es2021 },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      // rules-of-hooks only — NOT reactHooks.configs.recommended wholesale:
      // that bundle (v7, the React Compiler-era release) also ships rules
      // like set-state-in-effect that flag this codebase's normal, deliberate
      // `useEffect(() => { load() }, [deps])` data-fetch pattern used on
      // every page — not a bug, just not what the Compiler's stricter rules
      // want to see. rules-of-hooks (conditional/looped/out-of-order hook
      // calls) is the classic, uncontroversial one worth enforcing.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': 'off',
      // Left off — this codebase has many intentionally-unused destructured
      // props/params, and chasing those down is a separate cleanup, not
      // part of catching correctness bugs like today's undefined reference.
      'no-unused-vars': 'off',
    },
  },
];
