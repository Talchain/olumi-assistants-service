/**
 * PR2 COMPLETE LOOP — L1 at the BLOCK MINT, and L3's directive beside it.
 *
 * Design: `olumi-docs/parallel-briefs/PR2-COMPLETE-LOOP-DESIGN.md` §2.1 / §2.3.
 *
 * WHAT CHANGED IN BEHAVIOUR, STATED PLAINLY. CEE #907 shipped the two judgement
 * lenses with NO action fields and said so in the interface comment ("no action
 * fields in v1 … no chip, so no inert chip"), and
 * `next-best-judgement-tier.test.ts` pinned `action_label` as `undefined`. That
 * v1 decision is DELIBERATELY superseded here — the code comment at
 * `phase3-blocks.ts` minting the composite edge id already named this slice
 * ("should a later slice add an action chip") — so that pin is updated in the
 * same commit rather than left to fail. It is a behavioural pin of a design
 * decision, not a historic capture, so updating it is honest (trap 14b applies
 * to recorded EVIDENCE, not to superseded intent).
 *
 * FIXTURE STATE-CLASS: the ANALYSIS side is the two COMMITTED live captures; the
 * judgement/graph side has no in-repo capture (CEE-internal state), so those are
 * named single-purpose constructions mirroring the producer shapes — the same
 * disclosure `next-best-judgement-tier.test.ts` makes, for the same reason.
 *
 * ⚠ WHAT THIS FILE CANNOT PROVE: that a user sees the button, clicks it, and the
 * model changes. That is a LIVE STAGING WITNESS. Everything here is the
 * producer side of the seam.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import type { OlumiResponse } from '@talchain/schemas/boundary';

import { deriveJudgementSignals, type JudgementSignals } from '../judgement-signals.js';
import { buildLensSurface, type BlockBuildCtx } from '../phase3-blocks.js';
import { buildFocusInspectorDirective } from '../ui-directive.js';
import {
  composeDisagreementActionPrompt,
  composeOverrideActionPrompt,
  DISAGREEMENT_ACTION_LABEL,
  OVERRIDE_STRESS_TEST_ACTION_LABEL,
} from '../../coaching/judgement-offer-text.js';
import { setTestSink } from '../../../utils/telemetry.js';

type Enrichment = Record<string, unknown>;

function loadCapture(file: string): Enrichment {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/dsk-walk/${file}`, import.meta.url), 'utf8'),
  ) as Enrichment;
}
const SESSION_B2 = loadCapture('session-b2.enrichment.json');

/** A sparse-but-contract-legal enrichment: the analysis-derived tiers stay
 *  silent so the judgement tier can be observed. (The higher-tier collision
 *  behaviour is `next-best-judgement-tier.test.ts` §9's subject, not this
 *  file's.) */
const SPARSE: Enrichment = { confidence_tier: 'strong' };

function makeFact(
  enrichment: Enrichment,
  mayNameLeadingOption = true,
): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-pr2-l1',
      leading_option_id: 'opt_leader',
      summary: 'Ran analysis.',
      graph_hash_at_run: 'gh_pr2l100000000001',
      computed_at: '2026-08-10T00:00:00.000Z',
      constraint_verdict: { may_name_leading_option: mayNameLeadingOption },
      enrichment,
    },
  } as unknown as RunAnalysisHandlerFact;
}

const CTX: BlockBuildCtx = {
  created_at: '2026-08-10T12:00:00.000Z',
  graph_hash_at_generation: 'gh_pr2l100000000001',
};

interface EdgeSpec {
  readonly from: string;
  readonly to: string;
  readonly status?: 'agreed' | 'contested';
  readonly maxDivergence?: number;
}

/** Persisted-graph shape (nodes + edges with validation), producer-shaped. */
function makeGraph(edges: readonly EdgeSpec[], labels: Record<string, string>): unknown {
  const ids = new Set<string>();
  for (const e of edges) {
    ids.add(e.from);
    ids.add(e.to);
  }
  return {
    nodes: [...ids].map((id) => ({ id, kind: 'factor', label: labels[id] ?? id })),
    edges: edges.map((e) => ({
      from: e.from,
      to: e.to,
      ...(e.status !== undefined
        ? {
            validation: {
              status: e.status,
              contested_reasons: e.status === 'contested' ? ['raw_magnitude'] : [],
              max_divergence: e.maxDivergence ?? 0.5,
            },
          }
        : {}),
    })),
  };
}

function adjudicationFact(from: string, to: string): HandlerFact {
  return {
    fact_type: 'edge_adjudication',
    fact_version: 1,
    noop: false,
    result: {
      from,
      to,
      edge_id: null,
      verdict: 'overridden',
      resolved_strength_mean: 0.4,
      provenance: 'user_set',
    },
  } as unknown as HandlerFact;
}

function priorAnalysisFact(): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-pr2-l1',
      summary: 'Prior analysis.',
      graph_hash_at_run: 'gh_pr2l100000000000',
      computed_at: '2026-08-09T00:00:00.000Z',
      enrichment: JSON.parse(JSON.stringify(SESSION_B2)) as Enrichment,
    },
  } as unknown as HandlerFact;
}

// ── The two-edge graph. The SECOND edge is the discrimination control: it is a
//    real, contested, adjacent edge in the same graph, so an assertion that
//    passes on it as well as on the winner is NOT identity-bound (trap 19). ──
const LABELS: Record<string, string> = {
  fac_sales: 'Sales Effort',
  fac_rev: 'Revenue Growth',
  fac_cost: 'Unit Cost Base',
  fac_margin: 'Gross Margin',
};
const WINNER: EdgeSpec = {
  from: 'fac_sales',
  to: 'fac_rev',
  status: 'contested',
  maxDivergence: 0.9,
};
const RIVAL: EdgeSpec = {
  from: 'fac_cost',
  to: 'fac_margin',
  status: 'contested',
  maxDivergence: 0.1,
};
const GRAPH_TWO_CONTESTED = makeGraph([WINNER, RIVAL], LABELS);

function signals(priorFacts: readonly HandlerFact[]): JudgementSignals {
  return deriveJudgementSignals(priorFacts, GRAPH_TWO_CONTESTED);
}

/** T1's feed: an override NEWER than the latest prior analysis (I-B5). */
const T1_FACTS: readonly HandlerFact[] = [
  adjudicationFact(WINNER.from, WINNER.to),
  priorAnalysisFact(),
];
/** T2's feed: no adjudication at all, so the contested join is live. */
const T2_FACTS: readonly HandlerFact[] = [];

interface MintedBlock {
  readonly type: string;
  readonly source: string;
  readonly coaching_kind: string;
  readonly title: string;
  readonly body: string;
  readonly target_refs: readonly { id: string; label: string; kind: string }[];
  readonly action_label?: string;
  readonly action_prompt?: string;
}

function surfaceFor(facts: readonly HandlerFact[], mayName = true) {
  const surface = buildLensSurface(makeFact(SPARSE, mayName), CTX, null, signals(facts));
  expect(surface).not.toBeNull();
  return {
    lens: surface!.selection.lens,
    block: surface!.suggestion as unknown as MintedBlock,
  };
}

let sink: { event: string; data: Record<string, unknown> }[] = [];
beforeEach(() => {
  sink = [];
  setTestSink((event, data) => {
    sink.push({ event, data });
  });
});
afterEach(() => {
  setTestSink(null);
});

// ============================================================================
// §1 — the two tiers carry an action
// ============================================================================

describe('§1 the judgement tiers carry an action', () => {
  it('T1 (override_stress_test) ships the PROBE action', () => {
    const { lens, block } = surfaceFor(T1_FACTS);
    expect(lens).toBe('override_stress_test');
    expect(block.action_label).toBe(OVERRIDE_STRESS_TEST_ACTION_LABEL);
    expect(block.action_prompt).toBe(
      composeOverrideActionPrompt(LABELS.fac_sales!, LABELS.fac_rev!),
    );
  });

  it('T2 (disagreement_resolution) ships the CHANGE action', () => {
    const { lens, block } = surfaceFor(T2_FACTS);
    expect(lens).toBe('disagreement_resolution');
    expect(block.action_label).toBe(DISAGREEMENT_ACTION_LABEL);
    expect(block.action_prompt).toBe(
      composeDisagreementActionPrompt(LABELS.fac_sales!, LABELS.fac_rev!),
    );
  });

  it('the pair ships together or not at all — no inert pill, no captionless turn', () => {
    for (const facts of [T1_FACTS, T2_FACTS]) {
      const { block } = surfaceFor(facts);
      expect(typeof block.action_label === 'string').toBe(
        typeof block.action_prompt === 'string',
      );
    }
  });

  it('`action_intent` stays OMITTED (the closed enum has no edge-mutation member)', () => {
    for (const facts of [T1_FACTS, T2_FACTS]) {
      const { block } = surfaceFor(facts);
      expect((block as unknown as Record<string, unknown>).action_intent).toBeUndefined();
    }
  });
});

// ============================================================================
// §2 — identity binding, with the discrimination control in the same graph
// ============================================================================

describe('§2 the action binds to THIS edge by identity', () => {
  it('the prompt names the WINNING edge and the target_ref is its composite id', () => {
    const { block } = surfaceFor(T2_FACTS);
    expect(block.target_refs).toHaveLength(1);
    expect(block.target_refs[0]).toMatchObject({
      id: `${WINNER.from}→${WINNER.to}`,
      kind: 'edge',
    });
    // Bound to the ref OBJECT, not to a hand-typed literal: the prompt must be
    // the one composed from the labels the block's own ref names.
    const [fromLabel, toLabel] = block.target_refs[0]!.label.split(' → ');
    expect(block.action_prompt).toBe(composeDisagreementActionPrompt(fromLabel!, toLabel!));
  });

  it('DISCRIMINATION CONTROL: the rival contested edge is NOT named anywhere', () => {
    // The rival is real, contested and in the same graph — an assertion that
    // also held of it would be satisfiable by "an edge", not by "this edge".
    const { block } = surfaceFor(T2_FACTS);
    expect(block.action_prompt).not.toContain(LABELS.fac_cost);
    expect(block.action_prompt).not.toContain(LABELS.fac_margin);
    expect(block.target_refs[0]!.id).not.toBe(`${RIVAL.from}→${RIVAL.to}`);
  });

  it('OPPOSITE DIRECTION: make the rival the winner and the action follows IT', () => {
    // Same code path, higher divergence on the OTHER edge. If the action were
    // bound to anything but the selection's own edge, this stays on fac_sales.
    const flipped = makeGraph(
      [
        { ...WINNER, maxDivergence: 0.1 },
        { ...RIVAL, maxDivergence: 0.9 },
      ],
      LABELS,
    );
    const surface = buildLensSurface(
      makeFact(SPARSE),
      CTX,
      null,
      deriveJudgementSignals([], flipped),
    );
    const block = surface!.suggestion as unknown as MintedBlock;
    expect(block.target_refs[0]!.id).toBe(`${RIVAL.from}→${RIVAL.to}`);
    expect(block.action_prompt).toBe(
      composeDisagreementActionPrompt(LABELS.fac_cost!, LABELS.fac_margin!),
    );
  });
});

// ============================================================================
// §3 — an unphrasable action costs the action, not the card
// ============================================================================

describe('§3 a veto-tripping label drops the action and keeps the card', () => {
  const VETO_LABELS: Record<string, string> = {
    fac_sales: 'Why Customers Churn',
    fac_rev: 'Retention Rate',
    fac_cost: 'Unit Cost Base',
    fac_margin: 'Gross Margin',
  };

  it('T2 still ships its finding, with no action fields at all', () => {
    const graph = makeGraph([WINNER, RIVAL], VETO_LABELS);
    const surface = buildLensSurface(
      makeFact(SPARSE),
      CTX,
      null,
      deriveJudgementSignals([], graph),
    );
    expect(surface).not.toBeNull();
    const block = surface!.suggestion as unknown as MintedBlock;
    expect(surface!.selection.lens).toBe('disagreement_resolution');
    // The CARD survives — the finding is still worth telling the user.
    expect(block.body).toContain(VETO_LABELS.fac_sales);
    expect(block.body).toContain(VETO_LABELS.fac_rev);
    // …and neither action field ships, so there is no inert pill and no button.
    expect(block.action_label).toBeUndefined();
    expect(block.action_prompt).toBeUndefined();
  });

  it('POSITIVE CONTROL: the same path DOES ship the action on ordinary labels', () => {
    // Without this, the assertion above passes on any build where the action was
    // never wired at all — the absence would be proving nothing (trap 13). The
    // ONLY difference between the two cases is the endpoint labels.
    const graph = makeGraph([WINNER, RIVAL], LABELS);
    const surface = buildLensSurface(
      makeFact(SPARSE),
      CTX,
      null,
      deriveJudgementSignals([], graph),
    );
    const block = surface!.suggestion as unknown as MintedBlock;
    expect(block.action_label).toBe(DISAGREEMENT_ACTION_LABEL);
    expect(block.action_prompt).toBeDefined();
  });
});

// ============================================================================
// §4 — L3: the directive points at the edge the card names
// ============================================================================

/** The lookup the ladder is handed. Row 2a must not need it (the ref comes off
 *  the block), so it is deliberately EMPTY here — a directive that resolved
 *  through this map would suppress instead. */
const EMPTY_LOOKUP = new Map<string, { id: string; label: string; kind: string }>();

function directiveFor(facts: readonly HandlerFact[], mayName = true) {
  const { block } = surfaceFor(facts, mayName);
  const blocks = [block] as unknown as OlumiResponse['blocks'];
  return {
    block,
    directive: buildFocusInspectorDirective(
      makeFact(SPARSE, mayName),
      EMPTY_LOOKUP as never,
      blocks,
      null,
      undefined,
      signals(facts),
    ),
  };
}

describe('§4 the card points at what it names (open_inspector, not focus)', () => {
  it('T2 emits `open_inspector` at the block’s OWN edge ref', () => {
    const { block, directive } = directiveFor(T2_FACTS);
    expect(directive).not.toBeNull();
    expect(directive!.verb).toBe('open_inspector');
    expect(directive!.targets).toHaveLength(1);
    // ONE derivation, two read points: string equality with the card's ref.
    expect(directive!.targets[0]!.id).toBe(block.target_refs[0]!.id);
    expect(directive!.targets[0]!.kind).toBe('edge');
  });

  it('T1 does too', () => {
    const { block, directive } = directiveFor(T1_FACTS);
    expect(directive!.verb).toBe('open_inspector');
    expect(directive!.targets[0]!.id).toBe(block.target_refs[0]!.id);
  });

  it('`focus` is NOT used — the viewport must not move under a card being read', () => {
    for (const facts of [T1_FACTS, T2_FACTS]) {
      expect(directiveFor(facts).directive!.verb).not.toBe('focus');
    }
  });

  it('DROPS WITH ITS HOST: no surviving lens block ⇒ no edge directive', () => {
    // Same fact, same signals — only the surviving-blocks list differs. Without
    // the card there is nothing the assistant is demonstrably discussing, so the
    // ladder must fall through to its existing rows rather than point at an edge.
    const directive = buildFocusInspectorDirective(
      makeFact(SPARSE),
      EMPTY_LOOKUP as never,
      [] as unknown as OlumiResponse['blocks'],
      null,
      undefined,
      signals(T2_FACTS),
    );
    expect(directive?.verb).not.toBe('open_inspector');
  });

  it('the HOST must be the lens block — a non-lens card carrying an edge ref is not one', () => {
    // ⚠ THIS CASE EXISTS BECAUSE A MUTANT SURVIVED THE ONE ABOVE. Falling back
    // to `freshBlocks[0]` is invisible to an EMPTY block list — the absence
    // proved nothing about which block the row reads (trap 13). Here the list is
    // non-empty and carries a perfectly good edge ref on a block that is NOT the
    // σ-gated lens card, so a row that took "the first block with an edge" would
    // point at it. The gesture's whole safety story is that it inherits the lens
    // card's prose/schema gate; a directive sourced from anything else is a
    // "look here" with no card behind it.
    const impostor = {
      type: 'coaching',
      source: 'llm',
      coaching_kind: 'reframe',
      title: 'Not the lens card',
      body: 'A different card that happens to name an edge.',
      target_refs: [
        { id: `${RIVAL.from}→${RIVAL.to}`, label: 'Unit Cost Base → Gross Margin', kind: 'edge' },
      ],
    };
    const directive = buildFocusInspectorDirective(
      makeFact(SPARSE),
      EMPTY_LOOKUP as never,
      [impostor] as unknown as OlumiResponse['blocks'],
      null,
      undefined,
      signals(T2_FACTS),
    );
    expect(directive?.verb).not.toBe('open_inspector');
  });

  it('an EDGE target asserts no leader, so a withheld turn still gets its pointer', () => {
    // Today this turn suppresses entirely (`leading_option_claim_withheld`) and
    // the user reading a judgement card gets no pointer at all. An edge names no
    // option, so the withheld gate must not bite here — the same scoping row 3's
    // own comment sets out for row 2.
    const { block, directive } = directiveFor(T2_FACTS, false);
    expect(directive).not.toBeNull();
    expect(directive!.verb).toBe('open_inspector');
    expect(directive!.targets[0]!.id).toBe(block.target_refs[0]!.id);
  });

  it('the directive is stamped `ladder` and telemetered as an edge gesture', () => {
    directiveFor(T2_FACTS);
    const emitted = sink.filter((e) => e.event.includes('ui_directive'));
    expect(emitted.length).toBeGreaterThanOrEqual(1);
    const last = emitted[emitted.length - 1]!;
    expect(last.data.verb).toBe('open_inspector');
    expect(last.data.target_kind).toBe('edge');
  });
});
