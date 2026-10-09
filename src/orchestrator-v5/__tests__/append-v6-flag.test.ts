import { afterEach, expect, it } from 'vitest';

import { useAppendV6 } from '../append-v6-flag.js';
import {
  USE_APPEND_V6,
  useAppendV6 as useAppendV6FromStore,
  __setUseAppendV6ForTest,
} from '../session/supabase-store.js';

afterEach(() => {
  __setUseAppendV6ForTest(USE_APPEND_V6);
});

it('shares one flag cell between the store test seam and production flag reader', () => {
  expect(USE_APPEND_V6).toBe(true);
  expect(useAppendV6()).toBe(true);
  expect(useAppendV6FromStore).toBe(useAppendV6);

  __setUseAppendV6ForTest(true);
  expect(useAppendV6()).toBe(true);
  expect(useAppendV6FromStore()).toBe(true);

  __setUseAppendV6ForTest(false);
  expect(useAppendV6()).toBe(false);
  expect(useAppendV6FromStore()).toBe(false);
});
