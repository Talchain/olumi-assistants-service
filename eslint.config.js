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
      // All production code now uses centralized config (src/config/index.ts)
      'no-restricted-syntax': [
        'error',
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
      // Co-located tests alongside production code also need direct process.env
      // access for the same reason as tests/ — setting/deleting env vars to
      // exercise timeout + budget paths. Without this, every src/**/__tests__/
      // test that calls `delete process.env.X` trips no-restricted-syntax.
      'src/**/__tests__/**/*.ts',
      'src/**/*.test.ts',
      'playwright.config.ts',
      'vitest.config.ts',
    ],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  // Structural guard: route-v2.ts must invoke the three shared pre-flight
  // primitives (validateIngress, parseRequestExtensions, preflightEnsureScenario)
  // ONLY via the runPreFlight helper in route-v2-preflight.ts. This keeps the
  // "all dispatch branches share pre-flight" invariant structurally enforced
  // rather than preserved by convention. Selectors cover the three escape
  // routes: direct call, imported symbol, namespace-import member access.
  // See Docs/v5/route-v2-branch-audit.md.
  {
    files: ['src/orchestrator/route-v2.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.name="validateIngress"]',
          message:
            'route-v2.ts must invoke ingress validation via runPreFlight only. See Docs/v5/route-v2-branch-audit.md.',
        },
        {
          selector: 'CallExpression[callee.name="parseRequestExtensions"]',
          message:
            'route-v2.ts must invoke extension parsing via runPreFlight only. See Docs/v5/route-v2-branch-audit.md.',
        },
        {
          selector: 'CallExpression[callee.name="preflightEnsureScenario"]',
          message:
            'route-v2.ts must invoke scenario pre-flight via runPreFlight only. See Docs/v5/route-v2-branch-audit.md.',
        },
        {
          selector: 'ImportSpecifier[imported.name="validateIngress"]',
          message:
            'route-v2.ts must not import validateIngress directly; use runPreFlight.',
        },
        {
          selector: 'ImportSpecifier[imported.name="parseRequestExtensions"]',
          message:
            'route-v2.ts must not import parseRequestExtensions directly; use runPreFlight.',
        },
        {
          selector: 'ImportSpecifier[imported.name="preflightEnsureScenario"]',
          message:
            'route-v2.ts must not import preflightEnsureScenario directly; use runPreFlight.',
        },
        {
          selector: 'MemberExpression[property.name="validateIngress"]',
          message:
            'route-v2.ts must not access validateIngress via namespace import; use runPreFlight.',
        },
        {
          selector: 'MemberExpression[property.name="parseRequestExtensions"]',
          message:
            'route-v2.ts must not access parseRequestExtensions via namespace import; use runPreFlight.',
        },
        {
          selector: 'MemberExpression[property.name="preflightEnsureScenario"]',
          message:
            'route-v2.ts must not access preflightEnsureScenario via namespace import; use runPreFlight.',
        },
      ],
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
