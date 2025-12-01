module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: "./tsconfig.json",
    sourceType: "module"
  },
  env: {
    es2022: true,
    node: true
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  ignorePatterns: [
    "dist",
    "node_modules",
    "tests/perf/**/*.js",
    "examples",
    "scripts",
    "sdk/typescript/dist/**",
    "**/* 2.ts",
    "**/* 3.ts",
    "tests/types/**",
    "perf/**/*.d.ts",
    "sdk/typescript/vitest.config.ts",
  ],
  rules: {
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        "argsIgnorePattern": "^_",
        "varsIgnorePattern": "^_"
      }
    ]
  }
};
