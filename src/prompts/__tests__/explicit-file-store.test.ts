import { afterEach, describe, expect, it, vi } from 'vitest';

const original = {
  storeType: process.env.PROMPTS_STORE_TYPE,
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

afterEach(() => {
  if (original.storeType === undefined) delete process.env.PROMPTS_STORE_TYPE;
  else process.env.PROMPTS_STORE_TYPE = original.storeType;
  if (original.url === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = original.url;
  if (original.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = original.key;
  vi.resetModules();
});

describe('explicit file prompt store', () => {
  it('wins over Supabase credential inference', async () => {
    process.env.PROMPTS_STORE_TYPE = 'file';
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
    vi.resetModules();
    const store = await import('../store.js');
    expect(store.isStoreBackendConfigured()).toBe(false);
    expect(store.getPromptStore()).toBeInstanceOf(store.FilePromptStore);
    store.resetPromptStore();
  });
});
