/**
 * ContextPack `readiness` projection — the readiness verdict the model reads.
 *
 * DEFECT THIS PINS (deployed staging, Aug 2026): the assistant told a user
 * *"so nothing there is blocking analysis"* while two factors were the ONLY
 * blockers. The ContextPack carried a readiness STATUS and a blocker COUNT
 * (`coaching_context.readiness_status` / `.actionable_blocker_count`) but
 * never the blocker IDENTITY or the route out, so the model could not name
 * what was blocking even when it knew something was.
 *
 * These tests bind BY IDENTITY (field name + typed `kind` + `option_label`),
 * never by prose matching — prose is exactly the wrong key here.
 *
 * CANONICAL OWNER: `summariseReadiness` (routing/readiness-summary.ts), which
 * itself delegates to `projectReadinessRecovery`. This suite asserts the pack
 * carries that projection VERBATIM; it never re-derives readiness.
 */
import { describe, it, expect } from 'vitest';

import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { assembleContextPack } from '../context-pack-assembler.js';
import { ContextPackSchema } from '../context-pack-schema.js';
import {
  projectContextPackReadiness,
  READINESS_MAX_OPEN_ITEMS,
} from '../../routing/readiness-summary.js';

const PAYLOAD = makeMessagePayload();

/**
 * Canonical `analysis_ready` payload with TWO human-input blockers — the
 * shape of the deployed defect (two factors, both blocking, `may_run` false).
 */
const READINESS_TWO_BLOCKERS = {
  status: 'needs_user_input',
  options: [],
  repair_proposal: { kind: 'noop' },
  readiness_issues: [
    {
      code: 'OPTION_VALUE_MISSING',
      category: 'option_values',
      repairability: 'human_input_required',
      message: 'Next, give "Churn rate" a value so the model can run',
      option_label: 'Churn rate',
    },
    {
      code: 'OPTION_VALUE_MISSING',
      category: 'option_values',
      repairability: 'human_input_required',
      message: 'Next, give "Onboarding time" a value so the model can run',
      option_label: 'Onboarding time',
    },
  ],
} as unknown as Parameters<typeof projectContextPackReadiness>[0];

describe('ContextPack readiness — the blocker identity reaches the pack', () => {
  it('carries each canonical blocker BY IDENTITY, not merely a count', () => {
    const pack = assembleContextPack({
      payload: PAYLOAD,
      priorTurns: [],
      readiness: projectContextPackReadiness(READINESS_TWO_BLOCKERS)!,
    });

    expect(pack.readiness).toBeDefined();
    expect(pack.readiness!.status).toBe('needs_user_input');
    // BY IDENTITY: the option labels, not the prose.
    expect(pack.readiness!.open_items.map((i) => i.option_label)).toEqual([
      'Churn rate',
      'Onboarding time',
    ]);
    expect(pack.readiness!.open_items.map((i) => i.kind)).toEqual([
      'option_needs_encoding',
      'option_needs_encoding',
    ]);
    // The ROUTE out reaches the model, not just the fact of being blocked.
    expect(pack.readiness!.open_items[0].description.length).toBeGreaterThan(0);
    expect(ContextPackSchema.safeParse(pack).success).toBe(true);
  });

  it('ABSENT readiness leaves the key absent — never a fabricated "nothing is blocking"', () => {
    const pack = assembleContextPack({ payload: PAYLOAD, priorTurns: [] });
    expect(pack.readiness).toBeUndefined();
    expect(Object.keys(pack)).not.toContain('readiness');
    expect(ContextPackSchema.safeParse(pack).success).toBe(true);
  });

  it('a non-ready status with ZERO open items still carries the status (empty ≠ unblocked)', () => {
    // Auto-repairable issues are filtered out of `open_items` by the canonical
    // projection, so an EMPTY list can coexist with a non-ready status. The
    // pack must carry `status` so a consumer cannot read [] as "may run".
    const autoRepairable = {
      status: 'needs_encoding',
      options: [],
      repair_proposal: { kind: 'auto' },
      readiness_issues: [
        { code: 'X', category: 'other', repairability: 'auto_repairable', message: 'a' },
        { code: 'Y', category: 'other', repairability: 'auto_repairable', message: 'b' },
      ],
    } as unknown as Parameters<typeof projectContextPackReadiness>[0];
    const projected = projectContextPackReadiness(autoRepairable)!;
    expect(projected.open_items).toHaveLength(0);
    expect(projected.status).toBe('needs_encoding');
  });

  it('DEDUPES byte-identical items, and does NOT count them as omissions', () => {
    // The measured live case: 49 items of which 24 were exact duplicates
    // carrying no identity. A copy loses no fact, so it is removed SILENTLY —
    // disclosing it as withheld would overstate the loss.
    const dupes = {
      status: 'blocked',
      options: [],
      readiness_issues: [
        { code: 'ORPHAN_NODE', category: 'graph_structure', repairability: 'human_input_required', message: 'This change would leave a node with no connections' },
        { code: 'ORPHAN_NODE', category: 'graph_structure', repairability: 'human_input_required', message: 'This change would leave a node with no connections' },
        { code: 'NO_GOAL', category: 'graph_structure', repairability: 'human_input_required', message: 'The model would have no goal' },
      ],
    } as unknown as Parameters<typeof projectContextPackReadiness>[0];
    const projected = projectContextPackReadiness(dupes)!;
    const ids = projected.open_items.map((i) => `${i.kind}|${i.description}|${i.option_label ?? ''}`);
    expect(new Set(ids).size).toBe(ids.length);
    expect(projected.open_items).toHaveLength(2);
    expect(projected.items_omitted).toBeUndefined();
  });

  it('DISTINCT items beyond the cap are dropped WITH disclosure', () => {
    const many = {
      status: 'blocked',
      options: [],
      readiness_issues: Array.from({ length: READINESS_MAX_OPEN_ITEMS + 5 }, (_, i) => ({
        code: 'NO_GOAL',
        category: 'graph_structure',
        repairability: 'human_input_required',
        // DISTINCT text, so dedupe cannot absorb these — the cap must.
        message: `Distinct open item number ${i}`,
      })),
    } as unknown as Parameters<typeof projectContextPackReadiness>[0];
    const projected = projectContextPackReadiness(many)!;
    expect(projected.open_items).toHaveLength(READINESS_MAX_OPEN_ITEMS);
    expect(projected.items_omitted).toBe(5);
    // Canonical order preserved — first occurrences win, never a reorder.
    expect(projected.open_items[0].description).toContain('number 0');
  });

  it('exact status "ready" projects no open items', () => {
    const ready = {
      status: 'ready',
      options: [],
      readiness_issues: [],
    } as unknown as Parameters<typeof projectContextPackReadiness>[0];
    const projected = projectContextPackReadiness(ready)!;
    expect(projected.status).toBe('ready');
    expect(projected.open_items).toHaveLength(0);
  });
});
