import { it, expect } from 'vitest';
import hashes from './fixtures/staging-turn-sha256.json';
import { capture, type Turn } from './provider-harness.js';
const turns: Turn[] = ['ordinary-converse','selected-converse','chip-converse','drawn-link','pre-mortem','widen-options','widen-risks','tool-continuation'];
for (const turn of turns) it(`capture ${turn} base parity`, async () => { const w = await capture(turn,'run2'); expect(w.calls.map(c => c.sha256)).toEqual(hashes[turn as keyof typeof hashes]); },60000);
