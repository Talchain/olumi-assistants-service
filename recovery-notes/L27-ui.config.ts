import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { alias: { '@': '/private/tmp/cx-l25/src' } },
  define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://localhost:54321'), 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('test-anon-key') },
  test: { include: ['recovery-notes/L27-ui.probe.ts'], environment: 'node' },
});
