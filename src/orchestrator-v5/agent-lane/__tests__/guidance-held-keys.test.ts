/**
 * ⛔ Lane A A3(a) (15 Oct): CEE's guidance key list IS the shared store's. #3052 added RC-OUTSIDE-VIEW to CEE alone; the
 * store refused every answer that showed it (Paul's pricing turn b5a28fad, `durability: not_recorded`). The store's check
 * is read from the newest migration that defines it (the live body matched it in the read-only dump of 15 Oct).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isHeldEntryKey } from '../guidance/held-keys.js';
import { POLICY } from '../guidance/policy.js';
import { entryKey } from '../guidance/index.js';
import { guidanceOnAnswer } from '../turn-context/guidance-history.js';
import type { GuidanceWire } from '../turn-context/guidance-wire.js';

const storeEntryKey = (() => {
  const dir = new URL('../../../../supabase/migrations/', import.meta.url);
  for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort().reverse()) {
    const check = /v_entry\.key !~ '(\^\(RC-[^']+)'/.exec(readFileSync(new URL(file, dir), 'utf8'));
    if (check) return new RegExp(check[1]!);
  }
  throw new Error('no guidance entry-key check in supabase/migrations');
})();

describe('A3(a) the guidance entry keys CEE writes are exactly the ones the store holds', () => {
  const keys = POLICY.rows.map(r => entryKey(r.policy_id, r.policy_id === 'RC-STRENGTHEN-ITEM' ? 'opt_a' : undefined));
  it('every policy row: CEE holds it if and only if the store does', () => {
    expect(keys.length, 'vacuity: the policy has rows').toBeGreaterThanOrEqual(6);
    expect(keys.map(k => [k, isHeldEntryKey(k)])).toStrictEqual(keys.map(k => [k, storeEntryKey.test(k)]));
    // Contrast: one row the store holds, one it does not (today).
    expect(isHeldEntryKey('RC-WIDEN')).toBe(true);
    expect(isHeldEntryKey('RC-OUTSIDE-VIEW')).toBe(false);
  });
  it('malformed keys are held by neither', () => {
    for (const k of ['RC-STRENGTHEN-ITEM', 'RC-STRENGTHEN-ITEM:XYZ', 'RC-WIDEN:abcdefabcdef', 'RC-WIDEN:x:y', 'rc-widen', '']) {
      expect([k, isHeldEntryKey(k)]).toStrictEqual([k, storeEntryKey.test(k)]);
    }
  });
  it('the writer never puts an unheld row on the answer (the wire Paul\'s pricing turn b5a28fad carried)', () => {
    const row = (policy_id: string) => ({ policy_id, priority: 'P5', item: 'pro_plan_price', state_key_hash: '5296850c5d6c' });
    const shown = guidanceOnAnswer({ slot1: row('RC-OUTSIDE-VIEW') } as unknown as GuidanceWire, {});
    expect(shown).toBeUndefined();
    // Contrast: a held row on the same wire is recorded as offered.
    expect(guidanceOnAnswer({ slot1: row('RC-PREMORTEM') } as unknown as GuidanceWire, {})?.entries).toStrictEqual({
      'RC-PREMORTEM': { status: 'offered', state_key_hash: '5296850c5d6c', slot: 1 } });
  });
});
