import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { SERVER_BOOT_HOOK_TIMEOUT_MS } from '../../vitest.shared.js';

export default defineConfig({
  root: resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  test: {
    include: ['scripts/parity-evidence/*.evidence.ts'],
    setupFiles: ['./vitest.setup.ts'],
    hookTimeout: SERVER_BOOT_HOOK_TIMEOUT_MS,
  },
});
