import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

// Multi-vertical platform audit 2026-08-16: "apps never import each other's src/" was a
// documented convention (e.g. apps/event-service/src/sagas/gstComplianceProxy.ts:5-6) with
// no automated enforcement — a real gap once a second vertical's services get written by
// people without the institutional memory. Cross-service communication must go through
// @erp/* packages, an internal HTTP route (x-internal-key), or the event bus instead.
// Update this list when a new app is added under apps/.
const APP_NAMES = [
  'accounting-service',
  'ai-copilot-service',
  'api-gateway',
  'auth-service',
  'automation-service',
  'customer-portal',
  'docs-site',
  'event-service',
  'gst-service',
  'hr-service',
  'inventory-service',
  'notification-service',
  'pos-frontend',
  'production-service',
  'purchase-service',
  'report-service',
  'sales-service',
  'scheduler-service',
  'search-service',
  'tenant-service',
  'web-frontend',
];

export default [
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs['recommended'].rules,
      // TypeScript's compiler already catches undefined identifiers (incl. ambient
      // DOM/Node/WebUSB globals via tsconfig `lib`); base no-undef false-positives on
      // those. Per typescript-eslint's own guidance: disable it for TS/TSX files.
      'no-undef': 'off',
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    },
  },
  {
    files: ['apps/**/*.ts', 'apps/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: APP_NAMES.map((name) => ({
            group: [`**/${name}/src/**`, `**/${name}/src`],
            message:
              `Apps must not import another service's src/ directly (this codebase's ` +
              `convention: apps communicate via @erp/* packages, an internal HTTP route, or ` +
              `the event bus — see apps/event-service/src/sagas/gstComplianceProxy.ts).`,
          })),
        },
      ],
    },
  },
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.turbo/**',
      'sale-erp-backend/**',
      'sale-erp-froentend/**',
      'eslint.config.mjs',
      'commitlint.config.cjs',
    ],
  },
];
