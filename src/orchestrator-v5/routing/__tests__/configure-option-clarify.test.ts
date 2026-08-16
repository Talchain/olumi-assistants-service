/**
 * L16 / N16 — unit contract for the bare-configure remedy predicate and its
 * composer.
 *
 * The route-level pin lives in
 * `tests/integration/orchestrator/route-v2-configure-option-clarify.test.ts`
 * (that is where the walk's wire body is replayed). This file pins the two
 * things a route test cannot see cheaply: the DECLINE surface — every reason
 * the intercept must keep its hands off a turn — and the copy contract.
 */

import { describe, it, expect } from 'vitest';

import {
  shouldInterceptBeforeEditLane,
  buildConfigureOptionRecoveryCopy,
} from '../configure-option-clarify.js';
import {
  carriesConfigureOptionValuePayload,
  detectConfigureOptionIntent,
} from '../configure-option-intent.js';
import { composeConfigureOptionClarifyResponse } from '../../compose/configure-option-clarify-response.js';
import { findForbiddenPhraseHit } from '../../compose/forbidden-user-facing-phrases.js';
import { buildConfigureOptionChip } from '../../configure-option-chip-text.js';

const OPTION_LABEL = 'Launch Customer Retention Programme';
const FACTOR_LABEL = 'Customer Retention Investment';

function edge(from: string, to: string) {
  return {
    from,
    to,
    strength: { mean: 0.6, std: 0.1 },
    exists_probability: 1,
    effect_direction: 'positive' as const,
  };
}

/** Walk-faithful: complete edges, top-level rich interventions. */
function graph(overrides?: { retentionConfigured?: boolean; secondBlockedOption?: boolean }) {
  const nodes: Record<string, unknown>[] = [
    { id: 'goal_arr', kind: 'goal', label: 'Reach £1,000,000 ARR' },
    { id: 'fac_retention_investment', kind: 'factor', label: FACTOR_LABEL },
    { id: 'fac_content_spend', kind: 'factor', label: 'Content Spend' },
    {
      id: 'opt_retention',
      kind: 'option',
      label: OPTION_LABEL,
      ...(overrides?.retentionConfigured
        ? {
            interventions: {
              fac_retention_investment: { value: 1, source: 'user_specified' },
            },
          }
        : {}),
    },
    {
      id: 'opt_content',
      kind: 'option',
      label: 'Invest in Content Marketing',
      interventions: { fac_content_spend: { value: 1, source: 'brief_extraction' } },
    },
  ];
  const edges = [
    edge('opt_retention', 'fac_retention_investment'),
    edge('opt_content', 'fac_content_spend'),
    edge('fac_retention_investment', 'goal_arr'),
    edge('fac_content_spend', 'goal_arr'),
  ];
  if (overrides?.secondBlockedOption) {
    nodes.push({ id: 'fac_price', kind: 'factor', label: 'Price Point' });
    nodes.push({ id: 'opt_price', kind: 'option', label: 'Cut The Price' });
    edges.push(edge('opt_price', 'fac_price'), edge('fac_price', 'goal_arr'));
  }
  return { nodes, edges };
}

function tryFor(message: string, g: unknown = graph()) {
  // The detection is produced by the REAL detector with the persisted labels,
  // exactly as route-v2 resolves it — not a hand-built stub that could drift
  // from what the route actually passes in.
  const detection = detectConfigureOptionIntent(message, [
    OPTION_LABEL,
    'Invest in Content Marketing',
    'Cut The Price',
  ]);
  return { detection, result: shouldInterceptBeforeEditLane({ message, detection, graph: g }) };
}

describe('shouldInterceptBeforeEditLane — matches only when it can name a concrete next step', () => {
  it("claims the walk's bare configure and names the real linked factor", () => {
    const { detection, result } = tryFor(`Configure ${OPTION_LABEL}`);
    expect(detection.matched).toBe(true);
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.optionId).toBe('opt_retention');
    expect(result.optionLabel).toBe(OPTION_LABEL);
    expect(result.factorLabels).toEqual([FACTOR_LABEL]);
    expect(result.optionSource).toBe('named_in_message');
    // Gate-reason material rides along, carrying the SPECIFIC blocker.
    expect(
      result.readiness.options.find((o) => o.option_id === 'opt_retention')?.status,
    ).toBe('needs_encoding');
  });

  it("claims the chip's own message and resolves the option without it being named", () => {
    // Derived from the chip builder — the click path, byte-for-byte.
    const { result } = tryFor(buildConfigureOptionChip('one of my options').message);
    expect(result.matched).toBe(true);
    if (!result.matched) return;
    expect(result.optionId).toBe('opt_retention');
    expect(result.optionSource).toBe('sole_unconfigured');
  });

  it('DECLINES when the message already carries a factor and a value (walk remedy #5 — the path that worked)', () => {
    const { result } = tryFor(`Under ${OPTION_LABEL}, set ${FACTOR_LABEL} to 1`);
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.reason).toBe('value_payload_present');
  });

  it('DECLINES when every option is already configured', () => {
    const { result } = tryFor(`Configure ${OPTION_LABEL}`, graph({ retentionConfigured: true }));
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.reason).toBe('no_unconfigured_option');
  });

  it('DECLINES rather than guessing when several options are blocked and none is named', () => {
    const { result } = tryFor(buildConfigureOptionChip('one of my options').message, {
      ...graph({ secondBlockedOption: true }),
    });
    expect(result.matched).toBe(false);
    if (result.matched) return;
    // Confidently picking one of two would be exactly the wrong answer this
    // lane exists to remove.
    expect(result.reason).toBe('option_not_identified');
  });

  it('DECLINES on a graph that does not strict-parse', () => {
    const { result } = tryFor(`Configure ${OPTION_LABEL}`, {
      nodes: graph().nodes,
      // Bare edges — non-canonical.
      edges: [{ from: 'opt_retention', to: 'fac_retention_investment' }],
    });
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.reason).toBe('graph_unparseable');
  });

  it('DECLINES when the configure detector itself did not match', () => {
    const message = 'Thanks, that all makes sense so far.';
    const detection = detectConfigureOptionIntent(message, [OPTION_LABEL]);
    expect(detection.matched).toBe(false);
    const result = shouldInterceptBeforeEditLane({ message, detection, graph: graph() });
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.reason).toBe('not_configure_intent');
  });

  it('DECLINES when the blocked option links only to non-factor nodes', () => {
    // Canonical readiness does not treat an option→goal edge as an effect
    // mapping. The option therefore remains needs_user_mapping rather than
    // needs_encoding, and this value-specific intercept must stand down.
    const g = graph();
    const { result } = tryFor(`Configure ${OPTION_LABEL}`, {
      nodes: g.nodes,
      edges: [
        ...g.edges.filter((e) => e.from !== 'opt_retention'),
        edge('opt_retention', 'goal_arr'),
      ],
    });
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.reason).toBe('no_unconfigured_option');
  });

  it('DECLINES for an option with no links at all — that is needs_user_mapping, a different remedy', () => {
    // Measured, not assumed: an option connected to nothing is classified
    // `needs_user_mapping`, not `needs_encoding`. It needs a LINK before a
    // value would mean anything, so "tell me what it changes" would be the
    // wrong ask. Recorded here so the distinction is not re-discovered.
    const g = graph();
    const { result } = tryFor(`Configure ${OPTION_LABEL}`, {
      nodes: g.nodes,
      edges: g.edges.filter((e) => e.from !== 'opt_retention'),
    });
    expect(result.matched).toBe(false);
    if (result.matched) return;
    expect(result.reason).toBe('no_unconfigured_option');
  });
});

describe('carriesConfigureOptionValuePayload — derived from the router\'s own VALUE_SET_PAYLOAD', () => {
  it('is false for the bare shapes and true for the writable ones', () => {
    expect(carriesConfigureOptionValuePayload(`Configure ${OPTION_LABEL}`)).toBe(false);
    expect(carriesConfigureOptionValuePayload(buildConfigureOptionChip(OPTION_LABEL).message)).toBe(
      false,
    );
    expect(
      carriesConfigureOptionValuePayload(`Under ${OPTION_LABEL}, set ${FACTOR_LABEL} to 1`),
    ).toBe(true);
    expect(
      carriesConfigureOptionValuePayload(`Set ${FACTOR_LABEL} to £40,000`),
    ).toBe(true);
  });
});

describe('composeConfigureOptionClarifyResponse — copy contract', () => {
  const response = composeConfigureOptionClarifyResponse({
    optionLabel: OPTION_LABEL,
    factorLabels: [FACTOR_LABEL],
    stage: 'analyse',
  });

  it('names the option, the factor, and the phrasing that routes back to the writer', () => {
    expect(response.assistant_text).toContain(OPTION_LABEL);
    expect(response.assistant_text).toContain(FACTOR_LABEL);
    expect(response.assistant_text).toContain(
      `Set the ${OPTION_LABEL} option's effect on ${FACTOR_LABEL} to`,
    );
  });

  it('the phrasing it advises is one the router actually accepts — the loop closes', () => {
    // ⭐ The 2.11 defect in one assertion: "the assistant suggests phrasings
    // that cannot return to the lane that suggested them". Extract the advised
    // sentence from the live copy, complete it with a value, and feed it back
    // through the REAL detector.
    const advised = `Set the ${OPTION_LABEL} option's effect on ${FACTOR_LABEL} to 1`;
    expect(response.assistant_text).toContain(advised.slice(0, advised.lastIndexOf(' to ') + 4));
    const back = detectConfigureOptionIntent(advised, [OPTION_LABEL]);
    expect(back.matched).toBe(true);
  });

  it('passes the egress forbidden-phrase guard (derived check, not a re-listed table)', () => {
    expect(findForbiddenPhraseHit(response.assistant_text)).toBeNull();
  });

  it('leaks no internal identifiers', () => {
    expect(response.assistant_text).not.toMatch(/\b(?:opt|fac|goal)_[a-z0-9_]+/);
  });

  it('offers no chips — completing one would mean choosing the user\'s number', () => {
    expect(response.suggested_actions).toEqual([]);
  });

  it('reads as one option, not a list, when several factors are unset', () => {
    const multi = composeConfigureOptionClarifyResponse({
      optionLabel: OPTION_LABEL,
      factorLabels: [FACTOR_LABEL, 'Churn Rate', 'Support Cost'],
      stage: 'analyse',
    });
    expect(multi.assistant_text).toContain(`${FACTOR_LABEL}, Churn Rate and Support Cost`);
    expect(findForbiddenPhraseHit(multi.assistant_text)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ⭐⭐ ROADMAP 2.427 — TRAP 21: the two predicates answer DIFFERENT questions.
// ---------------------------------------------------------------------------

/**
 * Before 2.427 there was ONE predicate here, and route-v2 consumed it for ONE
 * question: *should the deterministic remedy answer this turn INSTEAD of the
 * edit lane?* Its `value_payload_present` decline is exactly right for that.
 *
 * 2.427 needed an answer to a second question — *the edit lane already ran and
 * did NOT record this option; can we name what the user should type now?* — on
 * which that same decline is precisely inverted, because every failure capture
 * that motivated the row CARRIES a value payload.
 *
 * These tests are the discrimination. They are written as a PAIR on one input,
 * so the file fails loudly if the two predicates are ever "reconciled" back
 * into agreement — which is what trap 21 says the next reader will be tempted
 * to do, seeing two functions with different defaults side by side.
 */
describe('ROADMAP 2.427 — intercept vs recovery are not the same question', () => {
  const VALUE_BEARING = `Under the ${OPTION_LABEL} option, set its effect on ${FACTOR_LABEL} to 0.7.`;

  it('a value-bearing configure: intercept DECLINES, recovery RESOLVES', () => {
    const detection = detectConfigureOptionIntent(VALUE_BEARING, [OPTION_LABEL]);
    expect(detection.matched, 'precondition: the message must reach the edit lane').toBe(true);

    // BEFORE the edit lane — must not pre-empt a turn that has something to
    // write. Unchanged behaviour.
    const intercept = shouldInterceptBeforeEditLane({
      message: VALUE_BEARING,
      detection,
      graph: graph(),
    });
    expect(intercept).toEqual({ matched: false, reason: 'value_payload_present' });

    // AFTER the edit lane failed — the value payload says nothing about
    // whether the user needs the copy, so it is not consulted.
    const recovery = buildConfigureOptionRecoveryCopy({
      message: VALUE_BEARING,
      detection,
      graph: graph(),
    });
    expect(recovery.matched).toBe(true);
    if (!recovery.matched) return;
    expect(recovery.optionId).toBe('opt_retention');
    expect(recovery.factorLabels).toEqual([FACTOR_LABEL]);
  });

  it('the two agree on everything that is NOT the value payload', () => {
    // A bare configure carries no value, so both questions have the same
    // answer — proving the split introduced ONE difference, not a fork.
    const bare = `Configure ${OPTION_LABEL}`;
    const detection = detectConfigureOptionIntent(bare, [OPTION_LABEL]);
    expect(
      shouldInterceptBeforeEditLane({ message: bare, detection, graph: graph() }),
    ).toEqual(buildConfigureOptionRecoveryCopy({ message: bare, detection, graph: graph() }));
  });

  it('recovery still refuses to guess between two blocked options', () => {
    // The safety that must NOT be relaxed along with the value-payload gate.
    const detection = detectConfigureOptionIntent(VALUE_BEARING, []);
    const recovery = buildConfigureOptionRecoveryCopy({
      message: 'Help me configure one of my options.',
      detection: detectConfigureOptionIntent('Help me configure one of my options.', []),
      graph: graph({ secondBlockedOption: true }),
    });
    expect(recovery).toEqual({ matched: false, reason: 'option_not_identified' });
    expect(detection.matched).toBe(true);
  });
});
