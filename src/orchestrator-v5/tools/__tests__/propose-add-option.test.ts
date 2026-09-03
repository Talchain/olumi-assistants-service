/**
 * `propose_add_option` — the CONTRACT and its quality guarantees.
 *
 * ⭐ WHAT THIS FILE IS TRYING TO RULE OUT. Not "does the schema validate", but
 * the four ways a model-authored option could damage a user's model:
 *   1. a link to a factor that is not there            → UNKNOWN_FACTOR_ID
 *   2. a link to a DIFFERENT factor that looks similar → FACTOR_LABEL_MISMATCH
 *   3. an invented size of effect                      → STRUCTURALLY IMPOSSIBLE
 *   4. an option filed under the wrong decision        → label echo + clarify
 * Three of those four are made unreachable rather than merely tested: (3) has
 * no field to travel in, and (1),(2),(4) are rejected by a deterministic
 * validator the model cannot influence. That is the point of the design, so it
 * is what the tests assert.
 *
 * ⭐ THE GRAPHS ARE REAL. Every scenario below runs against a captured
 * strategic model from `cee/context-integrity` fixtures (geographic expansion,
 * cost restructuring, a four-day week), not a hand-built two-node toy — so
 * "the factor exists" and "the label matches" are being asked of genuine
 * modelling vocabulary with near-miss names in it.
 *
 * ⚠ HONEST LIMIT, STATED NOT PAPERED OVER: no live model call happens here.
 * The adapter is scripted, INCLUDING with adversarial payloads a real model
 * could plausibly emit. So this file proves what the SYSTEM does with a given
 * model output; it does not measure how good a real model's output is. The
 * live-model arm below runs only when an API key is present and SKIPS loudly
 * otherwise — and it was skipped when this was written.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  buildAddOptionGrounding,
  buildProposeAddOptionTool,
  composeAddOption,
  validateProposedAddOption,
  renderAddOptionGrounding,
  MAX_ADD_OPTION_LINKS,
  PROPOSE_ADD_OPTION_TOOL_NAME,
  type AddOptionGrounding,
} from '../propose-add-option.js';
import { buildAddOptionTransaction } from '../../routing/add-option-transaction.js';
import type { ChatWithToolsArgs, CallOpts } from '../../../adapters/llm/types.js';

// ---------------------------------------------------------------------------
// Real captured strategic models.
// ---------------------------------------------------------------------------

function loadFixtureGraph(name: string): unknown {
  const path = fileURLToPath(
    new URL(`../../../cee/context-integrity/__tests__/fixtures/${name}.cold-read.json`, import.meta.url),
  );
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as { graph?: unknown };
  return parsed.graph ?? parsed;
}

const GROWTH = loadFixtureGraph('b1-growth');
const RESTRUCTURING = loadFixtureGraph('b2-restructuring');
const FOUR_DAY = loadFixtureGraph('live-4day-week');

function grounded(graph: unknown): AddOptionGrounding {
  const g = buildAddOptionGrounding(graph);
  if (g === null) throw new Error('fixture failed to ground');
  return g;
}

const GROWTH_G = grounded(GROWTH);

describe('buildAddOptionGrounding — the model the proposer is allowed to see', () => {
  it('projects decisions, existing options with their factor links, and factors', () => {
    expect(GROWTH_G.decisions.map((d) => d.id)).toEqual(['dec_expansion']);
    expect(GROWTH_G.options.length).toBeGreaterThanOrEqual(3);
    expect(GROWTH_G.factors.length).toBeGreaterThanOrEqual(10);
    // The modelling PRECEDENT is what makes a proposed link justifiable, so it
    // must survive the projection: at least one existing option shows which
    // factors it changes.
    expect(GROWTH_G.options.some((o) => o.linkedFactorIds.length > 0)).toBe(true);
  });

  it('carries units and categories where the model records them', () => {
    const rendered = renderAddOptionGrounding(GROWTH_G);
    expect(rendered).toContain('DECISIONS');
    expect(rendered).toContain('FACTORS');
    expect(rendered).toContain('OPTIONS ALREADY ON THE MODEL');
    expect(rendered).toContain('dec_expansion');
  });

  it('returns null on an unreadable graph — the tool then does not engage', () => {
    expect(buildAddOptionGrounding(null)).toBeNull();
    expect(buildAddOptionGrounding({})).toBeNull();
    expect(buildAddOptionGrounding({ nodes: 'not-an-array' })).toBeNull();
    expect(buildAddOptionGrounding([])).toBeNull();
  });

  it('every fixture model grounds, with a decision to hang an option off', () => {
    for (const [name, graph] of [
      ['growth', GROWTH],
      ['restructuring', RESTRUCTURING],
      ['four-day week', FOUR_DAY],
    ] as const) {
      const g = buildAddOptionGrounding(graph);
      expect(g, name).not.toBeNull();
      expect(g!.decisions.length, name).toBeGreaterThan(0);
      expect(g!.factors.length, name).toBeGreaterThan(0);
    }
  });
});

describe('the tool schema — the guarantees that are STRUCTURAL, not instructed', () => {
  const tool = buildProposeAddOptionTool(GROWTH_G);

  it('⭐ carries NO field a size-of-effect could travel in', () => {
    // The strongest form of "never invent a numerical effect": there is
    // nowhere to put one. A prompt rule can be out-competed by a model; a
    // missing field cannot. If a `value`/`magnitude`/`strength` field is ever
    // added here, this REDs and the honesty claim must be re-argued.
    const serialised = JSON.stringify(tool.input_schema);
    for (const forbidden of ['value', 'magnitude', 'strength', 'amount', 'percent', 'delta', 'impact']) {
      expect(serialised.toLowerCase()).not.toContain(`"${forbidden}"`);
    }
    // Positive control for the same probe: fields that ARE declared are found
    // by it, so a green result above means absence and not a broken search.
    for (const present of ['label', 'factor_id', 'rationale', 'links', 'unknowns']) {
      expect(serialised).toContain(`"${present}"`);
    }
  });

  it('every object declares additionalProperties:false EXPLICITLY (the 400 guard)', () => {
    // Anthropic rejects `true` AND rejects the key being omitted — both forms
    // 400'd the structural composer in production a fortnight apart.
    const visit = (node: unknown, path: string): void => {
      if (node === null || typeof node !== 'object') return;
      const rec = node as Record<string, unknown>;
      if (rec.type === 'object') {
        expect(rec.additionalProperties, `${path} must declare additionalProperties:false`).toBe(false);
      }
      for (const [k, v] of Object.entries(rec)) visit(v, `${path}.${k}`);
    };
    visit(tool.input_schema, 'input_schema');
  });

  it('advertises the current model, so the ids the model may name are the ids that exist', () => {
    expect(tool.name).toBe(PROPOSE_ADD_OPTION_TOOL_NAME);
    expect(tool.description).toContain('dec_expansion');
    expect(tool.description).toContain(GROWTH_G.factors[0]!.id);
    expect(tool.description).toContain('held for the user to confirm');
  });

  it('caps the link count in the advert as well as in the validator', () => {
    const links = (tool.input_schema as any).properties.links;
    expect(links.maxItems).toBe(MAX_ADD_OPTION_LINKS);
  });
});

// ---------------------------------------------------------------------------
// The validator — the only authority. Realistic + adversarial payloads.
// ---------------------------------------------------------------------------

const F_NRR = 'fac_nrr';
const F_MARKETING = 'fac_marketing_spend';

describe('validateProposedAddOption — a well-formed strategic proposal', () => {
  const good = {
    label: 'Partner with a local distributor',
    parent_decision_id: 'dec_expansion',
    parent_decision_label: GROWTH_G.labelById.get('dec_expansion'),
    links: [
      {
        factor_id: F_NRR,
        factor_label: GROWTH_G.labelById.get(F_NRR),
        rationale: 'A distributor owns the customer relationship, which changes retention.',
      },
      {
        factor_id: F_MARKETING,
        factor_label: GROWTH_G.labelById.get(F_MARKETING),
        rationale: 'The partner carries local marketing rather than us.',
      },
    ],
    unknowns: ['the revenue share the partner would take'],
  };

  it('accepts it, and EVERY intervention is an explicit unknown', () => {
    const v = validateProposedAddOption(good, GROWTH_G);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.proposal.label).toBe('Partner with a local distributor');
    expect(v.proposal.parentDecisionId).toBe('dec_expansion');
    expect(v.proposal.interventions).toEqual([
      { factor_id: F_NRR, value: null },
      { factor_id: F_MARKETING, value: null },
    ]);
    // ⭐ The honesty invariant, asserted over the WHOLE set rather than the
    // members the fixture happens to have (spec, not failure mode).
    expect(v.proposal.interventions.every((i) => i.value === null)).toBe(true);
    expect(v.proposal.unknowns).toHaveLength(1);
  });

  it('feeds straight into the existing transaction: option + parent edge + one edge per link, NO values', () => {
    const v = validateProposedAddOption(good, GROWTH_G);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const built = buildAddOptionTransaction(
      {
        parent_decision_id: v.proposal.parentDecisionId,
        label: v.proposal.label,
        interventions: v.proposal.interventions,
      },
      {
        nodes: [...GROWTH_G.decisions, ...GROWTH_G.factors, ...GROWTH_G.options].map((n) => ({
          id: n.id,
          kind: GROWTH_G.kindById.get(n.id)!,
          label: n.label,
        })),
        edges: [],
      },
    );
    expect(built.matched).toBe(true);
    if (!built.matched) return;
    const ops = built.proposal.operations;
    expect(ops[0]!.op).toBe('add_node');
    expect((ops[0]!.value as any).kind).toBe('option');
    // The interventions bundle is EMPTY — this is what makes the persisted
    // option read back as `needs_encoding` rather than as configured.
    expect((ops[0]!.value as any).interventions).toEqual({});
    expect(ops.filter((o) => o.op === 'add_edge')).toHaveLength(3); // parent + 2 factors
    expect(built.proposal.configured).toBe(false);
    expect(built.proposal.linkedUnvaluedFactorIds).toEqual([F_NRR, F_MARKETING]);
  });
});

describe('validateProposedAddOption — the four damage modes, each refused', () => {
  const base = {
    label: 'Partner with a local distributor',
    parent_decision_id: 'dec_expansion',
    parent_decision_label: GROWTH_G.labelById.get('dec_expansion'),
    links: [],
    unknowns: [],
  };

  it('1. a factor that is not in the model → UNKNOWN_FACTOR_ID, whole proposal', () => {
    const v = validateProposedAddOption(
      { ...base, links: [{ factor_id: 'fac_channel_conflict', factor_label: 'Channel conflict', rationale: 'x' }] },
      GROWTH_G,
    );
    expect(v.ok).toBe(false);
    if (v.ok || v.kind !== 'rejected') throw new Error('expected rejection');
    expect(v.code).toBe('UNKNOWN_FACTOR_ID');
  });

  it('2. ⭐ SUBSTITUTION: a real id with a DIFFERENT factor’s label → FACTOR_LABEL_MISMATCH', () => {
    // The discriminating pair. Same id, same shape, only the echoed label
    // differs — so this cannot pass by accident and cannot fail for an
    // unrelated reason.
    const wrong = validateProposedAddOption(
      { ...base, links: [{ factor_id: F_NRR, factor_label: GROWTH_G.labelById.get(F_MARKETING)!, rationale: 'x' }] },
      GROWTH_G,
    );
    const right = validateProposedAddOption(
      { ...base, links: [{ factor_id: F_NRR, factor_label: GROWTH_G.labelById.get(F_NRR)!, rationale: 'x' }] },
      GROWTH_G,
    );
    expect(wrong.ok).toBe(false);
    if (wrong.ok || wrong.kind !== 'rejected') throw new Error('expected rejection');
    expect(wrong.code).toBe('FACTOR_LABEL_MISMATCH');
    expect(right.ok).toBe(true);
  });

  it('3. an invented value cannot be expressed — it is not in the payload shape', () => {
    // A model that tries anyway: the extra keys are simply not read, and the
    // intervention is STILL an explicit unknown. (`additionalProperties:false`
    // stops most of these at the provider; this is the belt to that braces.)
    const v = validateProposedAddOption(
      {
        ...base,
        links: [
          {
            factor_id: F_NRR,
            factor_label: GROWTH_G.labelById.get(F_NRR)!,
            rationale: 'Retention improves',
            value: 0.42,
            magnitude: '15%',
          } as unknown as Record<string, unknown>,
        ],
      },
      GROWTH_G,
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.proposal.interventions).toEqual([{ factor_id: F_NRR, value: null }]);
    expect(JSON.stringify(v.proposal.interventions)).not.toContain('0.42');
  });

  it('4. a parent that is not a decision → NOT_A_DECISION; one that does not exist → UNKNOWN_DECISION_ID', () => {
    const notDecision = validateProposedAddOption(
      { ...base, parent_decision_id: F_NRR, parent_decision_label: GROWTH_G.labelById.get(F_NRR) },
      GROWTH_G,
    );
    const missing = validateProposedAddOption(
      { ...base, parent_decision_id: 'dec_nope', parent_decision_label: 'Nope' },
      GROWTH_G,
    );
    expect(notDecision.ok).toBe(false);
    expect(missing.ok).toBe(false);
    if (notDecision.ok || notDecision.kind !== 'rejected') throw new Error('expected rejection');
    if (missing.ok || missing.kind !== 'rejected') throw new Error('expected rejection');
    expect(notDecision.code).toBe('NOT_A_DECISION');
    expect(missing.code).toBe('UNKNOWN_DECISION_ID');
  });

  it('4b. a real decision id with the WRONG decision label → DECISION_LABEL_MISMATCH', () => {
    const v = validateProposedAddOption(
      { ...base, parent_decision_label: 'Some other decision entirely' },
      GROWTH_G,
    );
    expect(v.ok).toBe(false);
    if (v.ok || v.kind !== 'rejected') throw new Error('expected rejection');
    expect(v.code).toBe('DECISION_LABEL_MISMATCH');
  });
});

describe('validateProposedAddOption — ambiguity is asked about, never guessed', () => {
  const twoDecisions: AddOptionGrounding = {
    ...GROWTH_G,
    decisions: [
      { id: 'dec_expansion', label: GROWTH_G.labelById.get('dec_expansion')! },
      { id: 'dec_second', label: 'How to fund it' },
    ],
    labelById: new Map([...GROWTH_G.labelById, ['dec_second', 'How to fund it']]),
    kindById: new Map([...GROWTH_G.kindById, ['dec_second', 'decision']]),
  };

  it('no parent + MORE THAN ONE decision → clarify, with the candidates named', () => {
    const v = validateProposedAddOption({ label: 'Partner locally', links: [] }, twoDecisions);
    expect(v.ok).toBe(false);
    if (v.ok || v.kind !== 'clarify') throw new Error('expected clarify');
    expect(v.candidates.map((c) => c.id)).toEqual(['dec_expansion', 'dec_second']);
    expect(v.label).toBe('Partner locally');
  });

  it('no parent + EXACTLY ONE decision → resolved, not asked (there is nothing to clarify)', () => {
    const v = validateProposedAddOption({ label: 'Partner locally', links: [] }, GROWTH_G);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.proposal.parentDecisionId).toBe('dec_expansion');
  });

  it('an explicit clarification request is honoured even with one decision', () => {
    const v = validateProposedAddOption(
      {
        label: 'Partner locally',
        links: [],
        clarification: { question: 'Do you mean a channel partner or a joint venture?', candidate_decision_ids: [] },
      },
      GROWTH_G,
    );
    expect(v.ok).toBe(false);
    if (v.ok || v.kind !== 'clarify') throw new Error('expected clarify');
    expect(v.question).toContain('channel partner');
  });

  it('a model with NO decision at all is refused, not filed somewhere', () => {
    const noDecisions: AddOptionGrounding = { ...GROWTH_G, decisions: [] };
    const v = validateProposedAddOption({ label: 'Partner locally', links: [] }, noDecisions);
    expect(v.ok).toBe(false);
    if (v.ok || v.kind !== 'rejected') throw new Error('expected rejection');
    expect(v.code).toBe('NO_DECISION_IN_MODEL');
  });
});

describe('validateProposedAddOption — the remaining refusals', () => {
  const base = {
    parent_decision_id: 'dec_expansion',
    parent_decision_label: GROWTH_G.labelById.get('dec_expansion'),
    links: [],
    unknowns: [],
  };

  it('a name the model already carries is not a new option → DUPLICATE_OPTION_LABEL', () => {
    const existing = GROWTH_G.options[0]!.label;
    const v = validateProposedAddOption({ ...base, label: existing.toUpperCase() }, GROWTH_G);
    expect(v.ok).toBe(false);
    if (v.ok || v.kind !== 'rejected') throw new Error('expected rejection');
    expect(v.code).toBe('DUPLICATE_OPTION_LABEL');
  });

  it('⭐ named after its own PARENT DECISION → LABEL_COLLIDES_WITH_EXISTING_NODE', () => {
    // The graph-aware second layer under the recogniser's target/label
    // boundary. Every id here resolves and every label echoes perfectly — the
    // id-echo rule cannot see this, which is exactly why this check asks a
    // different question.
    const v = validateProposedAddOption(
      { ...base, label: GROWTH_G.labelById.get('dec_expansion')! },
      GROWTH_G,
    );
    expect(v.ok).toBe(false);
    if (v.ok || v.kind !== 'rejected') throw new Error('expected rejection');
    expect(v.code).toBe('LABEL_COLLIDES_WITH_EXISTING_NODE');
  });

  it('⭐⭐ the parent echo must be PRESENT, not merely correct when offered', () => {
    // The header promises that for each id the model must ALSO echo the exact
    // label, and that failing the echo rejects the whole proposal. Measured
    // before the fix: a WRONG label rejected, an OMITTED one was ACCEPTED —
    // a guard behind an optional field is advisory.
    const v = validateProposedAddOption(
      { label: 'A brand-new option', parent_decision_id: 'dec_expansion', links: [], unknowns: [] },
      GROWTH_G,
    );
    expect(v.ok).toBe(false);
    if (v.ok || v.kind !== 'rejected') throw new Error('expected rejection');
    expect(v.code).toBe('DECISION_LABEL_MISSING');
  });

  it('⭐ the discriminating case: an option filed under the WRONG decision', () => {
    // With two decisions, a WRONG-BUT-VALID id and the label omitted used to be
    // ACCEPTED — filed under "Hiring approach" when it belonged under "Pricing
    // strategy". The echo would have caught it; omission bypassed the echo.
    const g = grounded({
      nodes: [
        { id: 'dec_pricing', kind: 'decision', label: 'Pricing strategy' },
        { id: 'dec_hiring', kind: 'decision', label: 'Hiring approach' },
        { id: 'fac_cost', kind: 'factor', label: 'Payroll cost' },
        { id: 'goal_g', kind: 'goal', label: 'Grow' },
      ],
    });
    const wrong = validateProposedAddOption(
      { label: 'Freemium tier', parent_decision_id: 'dec_hiring', links: [], unknowns: [] },
      g,
    );
    expect(wrong.ok, 'a wrong-but-valid parent with no echo must not be accepted').toBe(false);
    // ...and the intended one, echoed, still works.
    const right = validateProposedAddOption(
      {
        label: 'Freemium tier',
        parent_decision_id: 'dec_pricing',
        parent_decision_label: 'Pricing strategy',
        links: [],
        unknowns: [],
      },
      g,
    );
    expect(right.ok).toBe(true);
  });

  it('⭐ IN-RUN CONTRAST CONTROL: the FACTOR arm rejects all three ways', () => {
    // The factor arm was already symmetric — `links[].required` forces
    // `factor_label` — and that is exactly why the earlier "id echo holds both
    // directions" measurement passed: it exercised only this arm.
    const base = {
      label: 'New option',
      parent_decision_id: 'dec_expansion',
      parent_decision_label: GROWTH_G.labelById.get('dec_expansion')!,
      unknowns: [],
    };
    const fid = GROWTH_G.factors[0]!.id;
    const flabel = GROWTH_G.factors[0]!.label;
    expect(validateProposedAddOption({ ...base, links: [{ factor_id: fid, factor_label: flabel, rationale: 'r' }] }, GROWTH_G).ok).toBe(true);
    expect(validateProposedAddOption({ ...base, links: [{ factor_id: fid, factor_label: 'Wrong', rationale: 'r' }] }, GROWTH_G).ok).toBe(false);
    expect(validateProposedAddOption({ ...base, links: [{ factor_id: fid, rationale: 'r' }] }, GROWTH_G).ok).toBe(false);
  });

  it('⭐ named after the decision MINUS ITS HEAD NOUN → LABEL_IS_THE_PARENT_DECISION', () => {
    // The class the recogniser CANNOT reach. "Add an option for pricing" and
    // "add an option for licensing" are the same shape — a bare gerund after a
    // preposition — so a graph-blind rule can only guess. This one is
    // graph-aware: the parent decision is "Geographic Expansion Strategy", so
    // "Geographic Expansion" is the decision itself, not an option for it.
    const decision = GROWTH_G.labelById.get('dec_expansion')!;
    const subject = decision.replace(/\s+Strategy$/i, '');
    expect(subject, 'the fixture must actually carry a head noun to strip').not.toBe(decision);
    const v = validateProposedAddOption({ ...base, label: subject }, GROWTH_G);
    expect(v.ok, `"${subject}" is the decision itself`).toBe(false);
    if (v.ok || v.kind !== 'rejected') throw new Error('expected rejection');
    expect(v.code).toBe('LABEL_IS_THE_PARENT_DECISION');
  });

  it('...and in the other direction — the label carrying a head noun the decision lacks', () => {
    const decision = GROWTH_G.labelById.get('dec_expansion')!;
    const subject = decision.replace(/\s+Strategy$/i, '');
    for (const head of ['decision', 'choice', 'question']) {
      const v = validateProposedAddOption({ ...base, label: `${subject} ${head}` }, GROWTH_G);
      expect(v.ok, `"${subject} ${head}"`).toBe(false);
      if (v.ok || v.kind !== 'rejected') continue;
      expect(v.code).toBe('LABEL_IS_THE_PARENT_DECISION');
    }
  });

  it('OPPOSITE DIRECTION: a legitimate option that MENTIONS the subject still passes', () => {
    // ⚠ The discriminating twin, and the reason this rule is EQUALITY-after-
    // stripping rather than the broader "whole-word substring of a decision
    // label". Under the substring form every one of these is refused —
    // including the single most useful thing this path produces, an option
    // that answers the decision in its own words. A false refusal here is only
    // a gap, but it is a needless one and it takes the good cases first.
    const decision = GROWTH_G.labelById.get('dec_expansion')!;
    const subject = decision.replace(/\s+Strategy$/i, '');
    for (const label of [
      `${subject} via a joint venture`,
      `Pause ${subject.toLowerCase()} for a year`,
      'Partner with a local distributor',
    ]) {
      const v = validateProposedAddOption({ ...base, label }, GROWTH_G);
      expect(v.ok, `"${label}" is a legitimate option and must survive`).toBe(true);
      // ...and it IS a whole-word substring relationship, so the looser form
      // this rule declines really would have taken it.
      if (label !== 'Partner with a local distributor') {
        expect(label.toLowerCase()).toContain(subject.toLowerCase());
      }
    }
  });

  it('⭐ `plan` is a decision head noun too — "Hiring" under "Hiring plan"', () => {
    // A CLOSED-LIST EXTENSION of an existing enumeration, not a new predicate.
    // `plan` names a decision the same way `strategy` and `decision` do, and it
    // was the one head noun missing from the list. Same safe class as the
    // determiner alphabet: a list may be short, but extending it cannot
    // oscillate, because it adds no judgement over natural language.
    const graph = {
      nodes: [
        { id: 'dec_hiring', kind: 'decision', label: 'Hiring plan' },
        { id: 'goal_growth', kind: 'goal', label: 'Grow the team' },
        { id: 'fac_cost', kind: 'factor', label: 'Payroll cost' },
      ],
    };
    const g = grounded(graph);
    const b = { parent_decision_id: 'dec_hiring', parent_decision_label: 'Hiring plan', links: [], unknowns: [] };
    for (const label of ['Hiring', 'hiring', 'The hiring']) {
      const v = validateProposedAddOption({ ...b, label }, g);
      expect(v.ok, `"${label}" is the decision itself`).toBe(false);
      if (v.ok || v.kind !== 'rejected') continue;
      expect(v.code).toBe('LABEL_IS_THE_PARENT_DECISION');
    }
  });

  it('OPPOSITE DIRECTION: an option that legitimately ENDS in "plan" still passes', () => {
    // The twin. Adding a head noun must not start refusing real option names
    // that happen to carry it.
    const graph = {
      nodes: [
        { id: 'dec_hiring', kind: 'decision', label: 'Hiring plan' },
        { id: 'goal_growth', kind: 'goal', label: 'Grow the team' },
        { id: 'fac_cost', kind: 'factor', label: 'Payroll cost' },
      ],
    };
    const g = grounded(graph);
    const b = { parent_decision_id: 'dec_hiring', parent_decision_label: 'Hiring plan', links: [], unknowns: [] };
    for (const label of ['Contractor-only plan', 'Phased rollout plan', 'Freeze hiring', 'Hire in Berlin']) {
      const v = validateProposedAddOption({ ...b, label }, g);
      expect(v.ok, `"${label}" is a legitimate option and must survive`).toBe(true);
    }
  });

  it('...and after a GOAL or a FACTOR too — same confusion, different kind', () => {
    for (const id of ['goal_arr', F_NRR]) {
      const existing = GROWTH_G.labelById.get(id);
      if (existing === undefined) continue;
      const v = validateProposedAddOption({ ...base, label: existing }, GROWTH_G);
      expect(v.ok, `label "${existing}" must be refused`).toBe(false);
      if (v.ok || v.kind !== 'rejected') throw new Error('expected rejection');
      expect(v.code).toBe('LABEL_COLLIDES_WITH_EXISTING_NODE');
    }
  });

  it('OPPOSITE DIRECTION: a genuinely new name is still accepted (no over-correction)', () => {
    const v = validateProposedAddOption(
      { ...base, label: 'Partner with a local distributor' },
      GROWTH_G,
    );
    expect(v.ok).toBe(true);
  });

  it('the same factor twice → DUPLICATE_FACTOR', () => {
    const link = { factor_id: F_NRR, factor_label: GROWTH_G.labelById.get(F_NRR)!, rationale: 'x' };
    const v = validateProposedAddOption({ ...base, label: 'A new route', links: [link, link] }, GROWTH_G);
    expect(v.ok).toBe(false);
    if (v.ok || v.kind !== 'rejected') throw new Error('expected rejection');
    expect(v.code).toBe('DUPLICATE_FACTOR');
  });

  it('more links than the cap → TOO_MANY_LINKS', () => {
    const links = GROWTH_G.factors.slice(0, MAX_ADD_OPTION_LINKS + 1).map((f) => ({
      factor_id: f.id,
      factor_label: f.label,
      rationale: 'x',
    }));
    const v = validateProposedAddOption({ ...base, label: 'A new route', links }, GROWTH_G);
    expect(v.ok).toBe(false);
    if (v.ok || v.kind !== 'rejected') throw new Error('expected rejection');
    expect(v.code).toBe('TOO_MANY_LINKS');
  });

  it('an unusable name → LABEL_UNUSABLE; an unreadable payload → SCHEMA_INVALID', () => {
    const empty = validateProposedAddOption({ ...base, label: '.' }, GROWTH_G);
    const garbage = validateProposedAddOption({ nope: true }, GROWTH_G);
    expect(empty.ok).toBe(false);
    expect(garbage.ok).toBe(false);
    if (empty.ok || empty.kind !== 'rejected') throw new Error('expected rejection');
    if (garbage.ok || garbage.kind !== 'rejected') throw new Error('expected rejection');
    expect(empty.code).toBe('LABEL_UNUSABLE');
    expect(garbage.code).toBe('SCHEMA_INVALID');
  });

  it('never throws on hostile input', () => {
    for (const hostile of [null, undefined, 0, '', [], { links: 'no' }, { label: 1 }]) {
      expect(() => validateProposedAddOption(hostile, GROWTH_G)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// Transport.
// ---------------------------------------------------------------------------

function adapterReturning(input: Record<string, unknown>) {
  return {
    name: 'test',
    // The parameters are DECLARED so `mock.calls[n][m]` is typed. Without them
    // the call tuple is empty and every argument assertion below is a
    // full-tree typecheck error (the build gate excludes tests and would not
    // have seen it; the Typecheck Drift ratchet does).
    chatWithTools: vi.fn(async (_args: ChatWithToolsArgs, _opts: CallOpts) => ({
      content: [{ type: 'tool_use' as const, id: 't1', name: PROPOSE_ADD_OPTION_TOOL_NAME, input }],
      stop_reason: 'tool_use' as const,
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'test-model',
      latencyMs: 1,
    })),
  };
}

const COMPOSE_ARGS = {
  grounding: GROWTH_G,
  message: 'Add "Partner with a local distributor" as an option',
  detectedLabel: 'Partner with a local distributor',
  requestId: 'req-1',
  scenarioId: 'scn-1',
  timeoutMs: 5_000,
};

describe('composeAddOption — one call, one validation, one answer', () => {
  it('composes from a tool_use block, and forces the tool (no free-text escape)', async () => {
    const adapter = adapterReturning({
      label: 'Partner with a local distributor',
      parent_decision_id: 'dec_expansion',
      parent_decision_label: GROWTH_G.labelById.get('dec_expansion'),
      links: [{ factor_id: F_NRR, factor_label: GROWTH_G.labelById.get(F_NRR), rationale: 'retention' }],
      unknowns: [],
    });
    const out = await composeAddOption({ adapter, ...COMPOSE_ARGS });
    expect(out.status).toBe('composed');
    const args = adapter.chatWithTools.mock.calls[0]![0] as any;
    expect(args.tool_choice).toEqual({ type: 'tool', name: PROPOSE_ADD_OPTION_TOOL_NAME });
    expect(args.temperature).toBe(0);
    expect(args.tools).toHaveLength(1);
    // The deadline is PASSED, never defaulted inside the composer.
    expect((adapter.chatWithTools.mock.calls[0]![1] as any).timeoutMs).toBe(5_000);
  });

  it('makes EXACTLY ONE call — no retry, no corrective round, even on rejection', async () => {
    const adapter = adapterReturning({
      label: 'Partner with a local distributor',
      parent_decision_id: 'dec_expansion',
      parent_decision_label: GROWTH_G.labelById.get('dec_expansion'),
      links: [{ factor_id: 'fac_invented', factor_label: 'Invented', rationale: 'x' }],
      unknowns: [],
    });
    const out = await composeAddOption({ adapter, ...COMPOSE_ARGS });
    expect(out.status).toBe('rejected');
    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
  });

  it('an adapter with no tool support, a throw, or no tool call → unavailable (never a silent no-op)', async () => {
    const noTools = await composeAddOption({ adapter: { name: 'x' }, ...COMPOSE_ARGS });
    expect(noTools).toEqual({ status: 'unavailable', reason: 'no_tool_adapter' });

    const throwing = {
      name: 'x',
      chatWithTools: vi.fn(async () => {
        throw new Error('upstream timeout');
      }),
    };
    const failed = await composeAddOption({ adapter: throwing, ...COMPOSE_ARGS });
    expect(failed).toEqual({ status: 'unavailable', reason: 'call_failed' });

    const textOnly = {
      name: 'x',
      chatWithTools: vi.fn(async () => ({
        content: [{ type: 'text' as const, text: 'I cannot see that factor.' }],
        stop_reason: 'end_turn' as const,
        usage: { input_tokens: 1, output_tokens: 1 },
        model: 'm',
        latencyMs: 1,
      })),
    };
    const declined = await composeAddOption({ adapter: textOnly, ...COMPOSE_ARGS });
    expect(declined).toEqual({ status: 'unavailable', reason: 'no_tool_call' });
  });

  it('passes the user message verbatim and names the detected label', async () => {
    const adapter = adapterReturning({ label: 'Partner with a local distributor' });
    await composeAddOption({ adapter, ...COMPOSE_ARGS });
    const args = adapter.chatWithTools.mock.calls[0]![0] as any;
    expect(args.messages[0].content).toContain(COMPOSE_ARGS.message);
    expect(args.messages[0].content).toContain('Partner with a local distributor');
  });
});

// ---------------------------------------------------------------------------
// Quality across real strategic models — the system's guarantees, per model.
// ---------------------------------------------------------------------------

describe('proposer QUALITY across three captured strategic models', () => {
  /**
   * For each real model: a plausible option a user might ask for, and the
   * proposal a model might return for it — including one that names a factor
   * the model does not have. The assertions are the four quality checks:
   * no unsupported link, no invented value, a sensible parent, and links that
   * are genuinely part of the model.
   */
  const CASES = [
    {
      name: 'geographic expansion',
      graph: GROWTH,
      ask: 'Add "Partner with a local distributor" as an option',
      label: 'Partner with a local distributor',
      linkIds: ['fac_nrr', 'fac_marketing_spend'],
    },
    {
      name: 'cost restructuring',
      graph: RESTRUCTURING,
      ask: 'Add an option called Offshore the support desk',
      label: 'Offshore the support desk',
      linkIds: [] as string[],
    },
    {
      name: 'four-day week',
      graph: FOUR_DAY,
      ask: 'Add a third option: a six-month trial in engineering only',
      label: 'Six-month trial in engineering only',
      linkIds: [] as string[],
    },
  ];

  it.each(CASES)('$name — a grounded proposal is accepted and stays value-free', async (c) => {
    const g = grounded(c.graph);
    const decision = g.decisions[0]!;
    // Pick real factors when the case did not name any, so each model is
    // exercised with links drawn from ITS OWN vocabulary.
    const ids = c.linkIds.length > 0 ? c.linkIds : g.factors.slice(0, 2).map((f) => f.id);
    const adapter = adapterReturning({
      label: c.label,
      parent_decision_id: decision.id,
      parent_decision_label: decision.label,
      links: ids.map((id) => ({
        factor_id: id,
        factor_label: g.labelById.get(id),
        rationale: 'This option changes it.',
      })),
      unknowns: [],
    });
    const out = await composeAddOption({
      adapter,
      grounding: g,
      message: c.ask,
      detectedLabel: c.label,
      requestId: 'req',
      scenarioId: 'scn',
      timeoutMs: 5_000,
    });
    expect(out.status).toBe('composed');
    if (out.status !== 'composed') return;
    // (a) no unsupported factor links
    for (const i of out.proposal.interventions) {
      expect(g.kindById.get(i.factor_id)).toBe('factor');
    }
    // (b) no invented values, over the whole set
    expect(out.proposal.interventions.every((i) => i.value === null)).toBe(true);
    // (c) a sensible parent decision
    expect(g.kindById.get(out.proposal.parentDecisionId)).toBe('decision');
    // (d) useful integration: the option is linked into the model, not a bare label
    expect(out.proposal.interventions.length).toBeGreaterThan(0);
  });

  it.each(CASES)('$name — a proposal naming a factor that model lacks is REFUSED', async (c) => {
    const g = grounded(c.graph);
    const decision = g.decisions[0]!;
    const adapter = adapterReturning({
      label: c.label,
      parent_decision_id: decision.id,
      parent_decision_label: decision.label,
      links: [{ factor_id: 'fac_not_in_this_model', factor_label: 'Something plausible', rationale: 'x' }],
      unknowns: [],
    });
    const out = await composeAddOption({
      adapter,
      grounding: g,
      message: c.ask,
      detectedLabel: c.label,
      requestId: 'req',
      scenarioId: 'scn',
      timeoutMs: 5_000,
    });
    expect(out.status).toBe('rejected');
    if (out.status !== 'rejected') return;
    expect(out.code).toBe('UNKNOWN_FACTOR_ID');
  });
});

// ---------------------------------------------------------------------------
// Live model — runs only with a key; SKIPS LOUDLY otherwise.
// ---------------------------------------------------------------------------

const LIVE_KEY = process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY;

describe.skipIf(!LIVE_KEY)('proposer quality against the REAL model (key-gated)', () => {
  it('proposes a grounded, value-free option for a real strategic ask', async () => {
    const { getAdapter } = await import('../../../adapters/llm/router.js');
    const out = await composeAddOption({
      adapter: getAdapter('edit_graph'),
      grounding: GROWTH_G,
      message: 'Add "Partner with a local distributor" as an option',
      detectedLabel: 'Partner with a local distributor',
      requestId: 'live-req',
      scenarioId: 'live-scn',
      timeoutMs: 30_000,
    });
    expect(['composed', 'clarify']).toContain(out.status);
    if (out.status !== 'composed') return;
    expect(out.proposal.interventions.every((i) => i.value === null)).toBe(true);
    for (const i of out.proposal.interventions) {
      expect(GROWTH_G.kindById.get(i.factor_id)).toBe('factor');
    }
  }, 45_000);

  it('⭐⭐ LABEL FIDELITY — the question this PR has priced on an assumption for ten rounds', async () => {
    // WHY THIS EXISTS. Every declared-open class in this module ships on the
    // basis that a bad label reaches the user as a HELD PROPOSAL they can
    // reject — never as a canonical write. That rests on what the composer does
    // with a detected label, and until now the only key-gated arm fed it a
    // LEGITIMATE name ("Partner with a local distributor") and asserted
    // interventions and factor kinds — nothing about the label at all. The one
    // instrument that could settle the question was pointed away from it.
    //
    // Two changes: feed a DECLARED-OPEN fragment, and assert the LABEL.
    //
    // ⚠ THIS CANNOT RUN WITHOUT A KEY AND IT SETTLES NOTHING UNTIL IT DOES.
    // Local execution against a stub that obeys the system prompt literally
    // turns 10 of 10 declared-open fragments into the canonical label, and a
    // substituted or inverted label passes untouched in both directions —
    // there is no label-fidelity guard, the advertised echo is id-scoped only.
    // That is LOCAL EXECUTION, not a wire witness. This arm is what makes the
    // next run with a key answer it.
    const { getAdapter } = await import('../../../adapters/llm/router.js');
    const out = await composeAddOption({
      adapter: getAdapter('edit_graph'),
      grounding: GROWTH_G,
      message: 'Add an option called TBD',
      detectedLabel: 'TBD',
      requestId: 'live-req-label',
      scenarioId: 'live-scn-label',
      timeoutMs: 30_000,
    });
    // Record the answer whichever way it falls — this arm exists to MEASURE,
    // not to be green.
    console.log(
      `[propose-add-option] LABEL FIDELITY: status=${out.status} label=${
        out.status === 'composed' ? JSON.stringify(out.proposal.label) : 'n/a'
      }`,
    );
    expect(['composed', 'clarify', 'rejected', 'unavailable']).toContain(out.status);
    if (out.status !== 'composed') return;
    // If the model echoes the hedge, the label IS "TBD" and the declared-open
    // hedge class reaches the user as a held proposal named "TBD" — which is
    // exactly what the pins say and what no wire capture has yet confirmed.
    expect(typeof out.proposal.label).toBe('string');
    expect(out.proposal.label.length).toBeGreaterThan(0);
  }, 45_000);
});

it('DISCLOSURE: whether the live-model arm ran in this run', () => {
  // Not a pass/fail — a record in the output, so a green suite can never be
  // read as "the real model was measured" when no key was present.
  console.log(
    LIVE_KEY
      ? '[propose-add-option] live-model arm RAN'
      : '[propose-add-option] live-model arm SKIPPED — no ANTHROPIC_API_KEY/OPENAI_API_KEY in this environment',
  );
  expect(true).toBe(true);
});
