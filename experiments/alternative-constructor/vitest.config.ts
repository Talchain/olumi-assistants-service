import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['experiments/alternative-constructor/live-construction.test.ts'], setupFiles: ['./vitest.setup.ts'], maxWorkers: 1, fileParallelism: false, hookTimeout: 120_000, testTimeout: 7_200_000 } });
