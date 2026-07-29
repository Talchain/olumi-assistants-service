/**
 * `GET /admin/prompts/inventory` — the data path behind the one derivable
 * answer to "how many prompts do we have, which, what hash".
 *
 * The endpoint's whole value is that it MEASURES rather than records, so these
 * tests check the measuring, not a snapshot of today's numbers:
 *   - the headline total is the sum of its two halves, never a written-down number
 *   - the code-constant half reports a hash computed from the live export
 *   - an unreadable store reports `null`, NEVER `0` — "did not look" and
 *     "looked and found none" must not be the same answer, and `archive_drift`
 *     must stay empty when nothing was read (you cannot observe drift you did
 *     not measure)
 */

import { describe, it, expect } from 'vitest';
import { buildPromptEstateInventory } from '../../src/prompts/inventory.js';
import {
  CODE_CONSTANT_PROMPTS,
  LIVE_PMS_TASKS_AT_DEFAULT_GATES,
  RETIRED_PMS_ROWS,
  RETIRED_PMS_TASKS,
  isCodeConstantLiveNow,
} from '../../src/prompts/estate.js';
import { registerAllDefaultPrompts } from '../../src/prompts/defaults.js';

registerAllDefaultPrompts();

describe('prompt estate inventory', () => {
  it('reports a headline that is the sum of its halves', async () => {
    const inv = await buildPromptEstateInventory();
    expect(inv.totals.live_llm_call_prompts).toBe(
      inv.totals.pms_live + inv.totals.code_constants_live,
    );
    // At default gate state only. `prompt-estate-gates.test.ts` covers the
    // flipped case, where both of these must GROW.
    expect(inv.totals.pms_live).toBe(LIVE_PMS_TASKS_AT_DEFAULT_GATES.length);
    expect(inv.totals.code_constants_declared).toBe(CODE_CONSTANT_PROMPTS.length);
    expect(inv.totals.code_constants_live).toBe(
      CODE_CONSTANT_PROMPTS.filter(isCodeConstantLiveNow).length,
    );
    // The declared registry is strictly larger than the live count — gated and
    // fallback entries are declared precisely so they cannot hide.
    expect(inv.totals.code_constants_declared).toBeGreaterThan(inv.totals.code_constants_live);
  });

  it('includes repair_edit_graph — the prompt the old hand-list omitted', async () => {
    const inv = await buildPromptEstateInventory();
    const row = inv.pms.find((p) => p.key === 'repair_edit_graph');
    expect(row, 'repair_edit_graph is missing from the inventory').toBeDefined();
    expect(row!.disposition).toBe('live');
    expect(row!.critical).toBe(false);
  });

  it('names the gate on every gated prompt', async () => {
    const inv = await buildPromptEstateInventory();
    for (const row of inv.pms.filter((p) => p.disposition === 'gated')) {
      expect(row.gate, `gated prompt '${row.key}' does not name its gate`).toBeTruthy();
    }
  });

  it('hashes every code constant from the live export', async () => {
    const inv = await buildPromptEstateInventory();
    expect(inv.code_constants).toHaveLength(CODE_CONSTANT_PROMPTS.length);
    for (const c of inv.code_constants) {
      expect(c.error, `${c.id}: ${c.error}`).toBeUndefined();
      expect(c.content_hash).toMatch(/^[0-9a-f]{16}$/);
      expect(c.content_chars).toBeGreaterThan(0);
      expect(c.source_file).toMatch(/^src\//);
      expect(['live', 'fallback']).toContain(c.disposition);
      if (c.gate) expect(typeof c.gate_active).toBe('boolean');
    }
  });

  it('lists every declared retirement with a reason', async () => {
    const inv = await buildPromptEstateInventory();
    expect(inv.retired).toHaveLength(
      Object.keys(RETIRED_PMS_TASKS).length + Object.keys(RETIRED_PMS_ROWS).length,
    );
    expect(inv.totals.pms_retired).toBe(inv.retired.length);
    for (const r of inv.retired) {
      expect(r.reason.length).toBeGreaterThan(20);
      if (r.archive === 'blocked') expect(r.blocked_reason).toBeTruthy();
    }
  });

  it('reports null (not zero) when the store cannot be read, and claims no drift', async () => {
    // The absence-assertion discipline at the endpoint level: with no prompt
    // store configured, "0 rows" would be a fabrication. `store_read_ok:false`
    // plus null counts is the honest shape, and archive_drift MUST stay empty
    // because nothing was measured.
    const inv = await buildPromptEstateInventory();
    if (!inv.store_read_ok) {
      expect(inv.totals.pms_rows_total).toBeNull();
      expect(inv.totals.pms_rows_active).toBeNull();
      expect(inv.archive_drift).toEqual([]);
      for (const r of inv.retired) expect(r.store_status).toBeNull();
    } else {
      expect(typeof inv.totals.pms_rows_total).toBe('number');
    }
  });

  it('stamps a generation time', async () => {
    const inv = await buildPromptEstateInventory();
    expect(Number.isNaN(Date.parse(inv.generated_at))).toBe(false);
  });
});
