// ESLint の設定（実装計画 §2.1・§3.1）。
// 既存の違反は eslint-suppressions.json に一括で記録している。直したら `pnpm lint:prune` で記録を減らす。
// 新しい違反は CI で落ちる（警告は使わず、すべて error にする）。
import js from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import playwright from 'eslint-plugin-playwright';
import reactHooks from 'eslint-plugin-react-hooks';
import testingLibrary from 'eslint-plugin-testing-library';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** `eslint-disable-next-line` などの書き間違いを見つける（ESLint は知らない指示を黙って無視する） */
const directivePlugin = {
  rules: {
    'valid-directive': {
      meta: {
        type: 'problem',
        docs: { description: 'eslint の指示コメントの書き間違いを見つける' },
        schema: [],
        messages: { invalid: '「{{word}}」は eslint の指示ではありません。eslint-disable-next-line などの書き間違いを確かめてください' },
      },
      create(context) {
        const valid = new Set([
          'eslint',
          'eslint-disable',
          'eslint-enable',
          'eslint-disable-line',
          'eslint-disable-next-line',
          'eslint-env',
        ]);
        return {
          Program() {
            for (const comment of context.sourceCode.getAllComments()) {
              const word = /^\s*(eslint[\w-]*)/.exec(comment.value)?.[1];
              if (word && !valid.has(word)) context.report({ loc: comment.loc, messageId: 'invalid', data: { word } });
            }
          },
        };
      },
    },
  },
};

/** 警告は残さない（一括の抑止は error だけが対象のため） */
const warnToError = (configs) =>
  configs.map((c) =>
    c.rules
      ? {
          ...c,
          rules: Object.fromEntries(
            Object.entries(c.rules).map(([name, v]) => {
              if (v === 'warn' || v === 1) return [name, 'error'];
              if (Array.isArray(v) && (v[0] === 'warn' || v[0] === 1)) return [name, ['error', ...v.slice(1)]];
              return [name, v];
            }),
          ),
        }
      : c,
  );

export default warnToError(
  defineConfig(
    globalIgnores([
      'docs/**',
      '**/dist/**',
      '**/dist-*/**',
      '**/coverage/**',
      '**/test-results/**',
      '**/playwright-report/**',
      'packages/web/public/mockServiceWorker.js',
    ]),

    js.configs.recommended,
    tseslint.configs.strictTypeChecked,
    {
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      },
      linterOptions: { reportUnusedDisableDirectives: 'error' },
      plugins: { local: directivePlugin },
      rules: {
        'local/valid-directive': 'error',
        eqeqeq: ['error', 'smart'],
        '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
        '@typescript-eslint/switch-exhaustiveness-check': ['error', { considerDefaultExhaustiveForUnions: true }],
        // 数値の埋め込みと、アロー関数の省略形（onClick={() => setX(1)}）は認める
        '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
        '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
        ],
      },
    },
    {
      files: ['**/*.js'],
      extends: [tseslint.configs.disableTypeChecked],
      languageOptions: { globals: globals.node },
    },

    // ---- パッケージ間の依存のルール（実装計画 §3.1） ----
    {
      files: ['packages/contracts/src/**/*.ts'],
      ignores: ['**/*.test.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          { patterns: [{ regex: '^(?!zod(/|$)|\\.)', message: 'contracts は zod 以外に依存しない（実装計画 §3.1）' }] },
        ],
      },
    },
    {
      files: ['packages/web/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              { regex: '^@aws-sdk/', message: 'web は AWS SDK を import しない（実装計画 §3.1）' },
              { regex: '^aws-cdk-lib(/|$)', message: 'web は CDK を import しない（実装計画 §3.1）' },
              { regex: '^@factory/(?!contracts$)', message: 'web は @factory/contracts だけに依存する（実装計画 §3.1）' },
            ],
          },
        ],
      },
    },

    // ---- web ----
    {
      files: ['packages/web/src/**/*.{ts,tsx}'],
      extends: [reactHooks.configs.flat['recommended-latest']],
      languageOptions: { globals: globals.browser },
    },
    {
      files: ['packages/web/*.config.ts', 'packages/web/e2e/**/*.ts'],
      languageOptions: { globals: globals.node },
    },

    // ---- テスト ----
    {
      files: ['**/*.test.{ts,tsx}'],
      extends: [vitest.configs.recommended],
    },
    {
      files: ['packages/web/src/**/*.test.tsx', 'packages/web/src/test/**/*.{ts,tsx}'],
      extends: [testingLibrary.configs['flat/react']],
    },
    {
      files: ['packages/web/e2e/**/*.ts'],
      extends: [playwright.configs['flat/recommended']],
    },
  ),
);
