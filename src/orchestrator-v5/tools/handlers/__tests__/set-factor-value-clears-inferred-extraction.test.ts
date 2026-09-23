/**
 * ⭐⭐ A NUMBER THE USER TYPED MUST NOT GO ON SAYING OLUMI INFERRED IT.
 *
 * ── THE WITNESSED DEFECT (served CEE `e0fd1c9` + UI `fa84d226`, 23 Sep 2026) ──
 * Guest, saved example. The user set `fac_enterprise_revenue_risk` 0 → 0.3 on
 * the canvas (a `factor_value_edit` system event → `set_factor_value`). CEE
 * stored:
 *
 *     observed_state: { value: 0.3, raw_value: 0.3, source: "user_override",
 *                       extractionType: "inferred", factor_type, uncertainty_drivers }
 *
 * `source` says the user wrote the number; `extractionType` — the PRODUCER's
 * marker for how the draft pipeline read the brief — still says Olumi inferred
 * it. After a reload the UI hydrates that field and its est. predicate
 * (`factorValueIsUnconfirmedEstimate`, DGAI `canvas/domain/valueProvenance.ts`:
 * `obs?.extractionType === 'inferred' || d?.extractionType === 'inferred'`)
 * decides: the card read **"0.3 est."** — "Estimate not yet confirmed — this
 * value was filled in for you" — while the inspector said "Set by you".
 *
 * The UI already withdraws the marker on its LIVE apply path
 * (`applyV5State.ts`, "CLEARED, NOT RE-AUTHORED … the field is the SERVER's to
 * write"), so the stale marker only returns from the server's stored copy. This
 * file pins the server half.
 *
 * ── WHY CLEARED, NOT SET TO A "USER" VALUE ────────────────────────────────
 * `ObservedStateV3.extractionType` is `z.enum(["explicit","inferred","range",
 * "observed"])`. No member means "the user typed it in the product": every
 * member describes how the PIPELINE read the BRIEF, and `explicit`/`observed`
 * are read as BRIEF-backed by `nodeProvenanceDisplay` (→ `from_brief`) and
 * `classifyFactorValueTier` (→ `explicit`, so `mayClaimFromBrief` true), neither
 * of which consults `source`. Stamping one would trade "Olumi inferred your
 * number" for "your number came from your brief" — a different untruth.
 * Absence is the shape the UI's own `USER_VALUE_STAMP` (`{ source:
 * 'user_override' }`) already writes, and CEE's authorship authorities
 * (`structureProvenance`, `compactGraph`) consult `observed_state.source` FIRST,
 * so absence cannot demote the value.
 *
 * ── RUNS THE REAL CHAIN ───────────────────────────────────────────────────
 * `applyFactorValueEdit` is called for real: validator → `set_factor_value` →
 * `mergeMutatedGraphForPersistence` → `GraphV3.safeParse`. A deletion that the
 * persistence merge re-added from the base would pass a handler-only test and
 * still ship the defect, so every assertion reads the MERGED graph that is
 * committed (`mutatedGraph`) as well as its parse (`graph`).
 */

import { describe, expect, it } from 'vitest';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';

import { applyFactorValueEdit } from '../../../system-events/factor-value-edit.js';
import type {
  CollabParticipant,
  CollabRound,
  CollabStore,
  ElicitationEventRow,
} from '../../../../collab/types.js';
import {
  mayClaimFromBrief,
  readFactorValueView,
} from '../../../../cee/provenance/factor-value-provenance.js';
import { structureProvenance } from '../../../../cee/graph-readiness/obligation-provenance.js';
import { projectEntity } from '../../../agent-lane/runtime/agent-capabilities.js';

const SCENARIO_ID = '11111111-1111-4111-8111-111111111111';
const ROUND_ID = '33333333-3333-4333-8333-333333333333';
const GRACE_ID = '55555555-5555-4555-8555-555555555555';

/** The witnessed factor, by its witnessed id. */
const TARGET_ID = 'fac_enterprise_revenue_risk';
/** An untouched sibling carrying the same producer marker — the control. */
const SIBLING_ID = 'fac_market_competition';

const USER_VALUE = 0.3;
const GRACE_VALUE = 0.85;

type TargetShape = 'observed_state_only' | 'both_spellings' | 'explicit_from_brief';

/**
 * The persisted graph as the witness read it before the edit: the target is an
 * uncapped model-scale factor at 0 carrying the producer's `cee_inference` +
 * `extractionType: 'inferred'` pair, plus the producer metadata that must
 * SURVIVE the edit (`factor_type`, `uncertainty_drivers`).
 */
function persistedGraph(shape: TargetShape = 'observed_state_only'): Record<string, unknown> {
  const extraction = shape === 'explicit_from_brief' ? 'explicit' : 'inferred';
  const source = shape === 'explicit_from_brief' ? 'brief_extraction' : 'cee_inference';
  return {
    goal_node_id: 'g-revenue',
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      {
        id: TARGET_ID,
        kind: 'factor',
        label: 'Enterprise revenue risk',
        // The node-level spelling — promoted by the repair stages and read by
        // BOTH the UI predicate (`d?.extractionType`) and CEE's own
        // `readFactorValueView` precedence (observed_state → node → data).
        ...(shape === 'both_spellings' ? { extractionType: 'inferred' } : {}),
        observed_state: {
          value: 0,
          source,
          extractionType: extraction,
          factor_type: 'other',
          uncertainty_drivers: ['Market conditions', 'Deal timing'],
        },
      },
      {
        id: SIBLING_ID,
        kind: 'factor',
        label: 'Market competition',
        extractionType: 'inferred',
        observed_state: {
          value: 0.5,
          source: 'cee_inference',
          extractionType: 'inferred',
          factor_type: 'other',
        },
      },
      { id: 'o-hold', kind: 'option', label: 'Hold course' },
    ],
    edges: [
      {
        from: TARGET_ID,
        to: 'g-revenue',
        strength: { mean: -0.4, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'negative',
      },
      {
        from: SIBLING_ID,
        to: 'g-revenue',
        strength: { mean: -0.3, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'negative',
      },
    ],
  };
}

function eventFor(
  value: number,
  appliedFrom?: { round_id: string; participant_id: string },
): Extract<SystemEventTurnPayload['event'], { kind: 'factor_value_edit' }> {
  return {
    kind: 'factor_value_edit',
    target_id: TARGET_ID,
    value,
    field: 'value',
    ...(appliedFrom !== undefined ? { applied_from: appliedFrom } : {}),
  } as Extract<SystemEventTurnPayload['event'], { kind: 'factor_value_edit' }>;
}

function payloadFor(
  event: Extract<SystemEventTurnPayload['event'], { kind: 'factor_value_edit' }>,
): SystemEventTurnPayload {
  return {
    kind: 'system_event',
    scenario_id: SCENARIO_ID,
    turn_id: '77777777-7777-4777-8777-777777777777',
    stage: 'analyse',
    event,
  } as unknown as SystemEventTurnPayload;
}

/** A closed round on THIS scenario in which Grace answered the target. */
function graceRoundStore(): CollabStore {
  const round: CollabRound = {
    round_id: ROUND_ID,
    scenario_id: SCENARIO_ID,
    graph_version_ref: 'mv-1',
    target_manifest: [
      {
        target: { kind: 'factor', id: TARGET_ID },
        label: 'Enterprise revenue risk',
        description: null,
        unit: null,
      },
    ],
    context_note: null,
    status: 'closed',
    created_by: 'owner-user',
    created_at: '2026-09-23T10:00:00.000Z',
  };
  const grace: CollabParticipant = {
    participant_id: GRACE_ID,
    scenario_id: SCENARIO_ID,
    round_id: ROUND_ID,
    display_name: 'Grace',
    supabase_user_id: null,
    token_hash: 'hash-grace',
    status: 'active',
    pseudonym: null,
    created_at: '2026-09-23T10:01:00.000Z',
  };
  const belief: ElicitationEventRow = {
    event_id: 'evt-grace',
    round_id: ROUND_ID,
    participant_id: GRACE_ID,
    event_version: 1,
    kind: 'belief_submitted',
    target: { kind: 'factor', id: TARGET_ID },
    belief: { value: GRACE_VALUE, expression_raw: null, confidence: null },
    evidence: null,
    provenance: {
      authored_by: GRACE_ID,
      method: 'elicited_nl',
      elicitation_version: 'cee-belief-elicitation-v1',
    },
    created_at: '2026-09-23T10:05:00.000Z',
  };
  return {
    getRound: async (id: string) => (id === ROUND_ID ? round : null),
    getParticipant: async (id: string) => (id === GRACE_ID ? grace : null),
    listAllRoundEvents: async () => [structuredClone(belief)],
  } as unknown as CollabStore;
}

type NodeRecord = Record<string, unknown> & {
  id: string;
  observed_state?: Record<string, unknown>;
};

function nodeById(graph: unknown, id: string): NodeRecord {
  const nodes = (graph as { nodes?: NodeRecord[] }).nodes ?? [];
  const node = nodes.find((n) => n.id === id);
  if (!node) throw new Error(`node ${id} missing from graph`);
  return node;
}

async function edit(
  shape: TargetShape,
  value: number,
  opts: { panel?: boolean } = {},
) {
  const event = eventFor(
    value,
    opts.panel ? { round_id: ROUND_ID, participant_id: GRACE_ID } : undefined,
  );
  const result = await applyFactorValueEdit({
    payload: payloadFor(event),
    event,
    requestId: `req-extraction-${shape}-${opts.panel ? 'panel' : 'user'}`,
    persistedGraph: persistedGraph(shape),
    priorFacts: [],
    ...(opts.panel ? { collabStore: graceRoundStore() } : {}),
  });
  expect(result.kind, `edit was not applied: ${JSON.stringify(result)}`).toBe('mutated');
  if (result.kind !== 'mutated') throw new Error('unreachable');
  return result;
}

/** Both carriers of the committed write: the merged graph and its parse. */
function committedTargets(result: Awaited<ReturnType<typeof edit>>): NodeRecord[] {
  return [nodeById(result.mutatedGraph, TARGET_ID), nodeById(result.graph, TARGET_ID)];
}

describe('set_factor_value — a user-authored value withdraws the producer\'s extraction marker', () => {
  it('⭐ the WITNESSED shape: 0 → 0.3 over `extractionType: "inferred"` stores no extraction claim', async () => {
    const result = await edit('observed_state_only', USER_VALUE);

    for (const node of committedTargets(result)) {
      const os = node.observed_state ?? {};
      // The write landed, and it is the user's.
      expect(os.value).toBe(USER_VALUE);
      expect(os.source).toBe('user_override');
      // ⭐ THE FIX. ABSENT, not present-but-undefined: `in` and `Object.keys`
      // read a present key as present, and absence is the declared meaning.
      expect('extractionType' in os).toBe(false);
      // The field the UI est. predicate reads, stated as that predicate does.
      expect(os.extractionType === 'inferred' || node.extractionType === 'inferred').toBe(false);
    }
  });

  it('⭐ readers that classify the committed node no longer see an inference', async () => {
    const result = await edit('observed_state_only', USER_VALUE);
    const node = nodeById(result.mutatedGraph, TARGET_ID);

    // CEE's ONE precedence authority over the three carriers (observed_state →
    // node → data), used by the v5 blocked-slot claim guard.
    expect.soft(readFactorValueView(node).extractionType).toBeUndefined();

    // What the Agent lane hands its model about WHO put this number here.
    // Before the fix it read `{ source: 'user_override', extraction_type:
    // 'inferred' }` — two carriers contradicting each other in one object.
    expect.soft(projectEntity(node as never).value_provenance).toEqual({ source: 'user_override' });

    // CONTROL (not discriminating by design): the authorship authority reads
    // `source` FIRST, so it answered `user_stated` before the fix and must
    // still answer it after — clearing the marker cannot demote the value.
    expect.soft(structureProvenance(node)).toBe('user_stated');
  });

  it('⭐ the NODE-LEVEL spelling is withdrawn too (both carriers the UI predicate ORs)', async () => {
    const result = await edit('both_spellings', USER_VALUE);

    for (const node of committedTargets(result)) {
      expect('extractionType' in node).toBe(false);
      expect('extractionType' in (node.observed_state ?? {})).toBe(false);
      expect(readFactorValueView(node).extractionType).toBeUndefined();
    }
  });

  it('⭐ a brief-extracted (`explicit`) marker is withdrawn as well — a typed number is not "from your brief"', async () => {
    const result = await edit('explicit_from_brief', USER_VALUE);
    const node = nodeById(result.mutatedGraph, TARGET_ID);

    expect.soft('extractionType' in (node.observed_state ?? {})).toBe(false);
    // Discriminating reader: with `explicit` + a value this returned TRUE, i.e.
    // the V3 display path would badge the user's own number `from_brief`.
    expect.soft(mayClaimFromBrief(node)).toBe(false);
    expect(node.observed_state?.source).toBe('user_override');
  });

  it('⭐ the verified PANEL apply is not left "inferred" either — a colleague\'s number is not Olumi\'s', async () => {
    const result = await edit('observed_state_only', GRACE_VALUE, { panel: true });

    for (const node of committedTargets(result)) {
      const os = node.observed_state ?? {};
      expect(os.value).toBe(GRACE_VALUE);
      // The attribution this path exists for is unchanged …
      expect(os.source).toBe('panel_elicited');
      expect(os.elicited_from).toEqual({ round_id: ROUND_ID, participant_id: GRACE_ID });
      // … and the producer's inference marker is gone.
      expect('extractionType' in os).toBe(false);
    }
  });

  it('CONTROL: an UNTOUCHED sibling keeps its producer marker, on both spellings', async () => {
    const result = await edit('both_spellings', USER_VALUE);

    for (const graph of [result.mutatedGraph, result.graph]) {
      const sibling = nodeById(graph, SIBLING_ID);
      expect(sibling.extractionType).toBe('inferred');
      expect(sibling.observed_state?.extractionType).toBe('inferred');
      expect(sibling.observed_state?.source).toBe('cee_inference');
      expect(sibling.observed_state?.value).toBe(0.5);
    }
  });

  it('CONTROL: only the marker goes — producer metadata on the edited node survives', async () => {
    const result = await edit('observed_state_only', USER_VALUE);
    const os = nodeById(result.mutatedGraph, TARGET_ID).observed_state ?? {};

    expect(os.factor_type).toBe('other');
    expect(os.uncertainty_drivers).toEqual(['Market conditions', 'Deal timing']);
  });

  it('CONTROL: the wire `after` is unchanged — the ordinary edit still sends no extraction field', async () => {
    const result = await edit('observed_state_only', USER_VALUE);
    const fact = result.handlerFacts.find((f) => f.fact_type === 'set_factor_value') as
      | { result: { after: Record<string, unknown> } }
      | undefined;
    expect(fact, 'no set_factor_value fact was emitted').toBeDefined();
    expect('extractionType' in (fact?.result.after ?? {})).toBe(false);
    // The ordinary path's `after` carries no provenance keys at all (the
    // handler keeps it byte-identical; the UI stamps its own edits).
    expect('source' in (fact?.result.after ?? {})).toBe(false);
  });
});
