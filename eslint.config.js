import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import js from '@eslint/js';

export default [
  // Apply to TypeScript files
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        sourceType: 'module',
        ecmaVersion: 2022,
      },
      globals: {
        // Node.js globals
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        global: 'readonly',
        // ES2022 globals
        globalThis: 'readonly',
        // Timers
        setTimeout: 'readonly',
        setInterval: 'readonly',
        setImmediate: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        clearImmediate: 'readonly',
        // Web APIs (available in Node.js)
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Headers: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        FormData: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        DOMException: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
        // Test globals (vi test framework)
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly',
        test: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      // Flag direct process.env access - use centralized config instead
      // Set to 'warn' for gradual migration; change to 'error' once violations are fixed
      'no-restricted-syntax': [
        'warn',
        {
          selector: 'MemberExpression[object.name="process"][property.name="env"]',
          message:
            'Direct process.env access is discouraged. Import from src/config/index.ts instead.',
        },
      ],
    },
  },
  // Allow process.env in config files, scripts, tests, root config files, and special files
  {
    files: [
      'src/config/**/*.ts',
      'src/version.ts', // Source of SERVICE_VERSION, intentionally reads from package.json with env override
      'scripts/**/*.ts',
      'tests/**/*.ts',
      'playwright.config.ts',
      'vitest.config.ts',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  // Apply to JavaScript files (without TypeScript parser)
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      sourceType: 'module',
      ecmaVersion: 2022,
      globals: {
        // Node.js globals
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        global: 'readonly',
        // ES2022 globals
        globalThis: 'readonly',
        // Timers
        setTimeout: 'readonly',
        setInterval: 'readonly',
        setImmediate: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        clearImmediate: 'readonly',
        // Web APIs
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Headers: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        FormData: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        DOMException: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
    },
  },
  // Ignore patterns
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'tests/perf/**/*.js',
      'examples/**',
      'scripts/**',
      '**/* 2.ts',
      '**/* 3.ts',
      'tests/types/**',
      'perf/**/*.d.ts',
      'perf/**',
      'qa-smoke.mjs',
      'sdk/typescript/dist/**',
      'sdk/typescript/vitest.config.ts',
    ],
  },
];
