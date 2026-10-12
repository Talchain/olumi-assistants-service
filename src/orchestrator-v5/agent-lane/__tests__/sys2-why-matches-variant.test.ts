/**
 * SYS2 G1 · THE "Why?" UNDER A METHOD IS TRUE OF THE SELECTED VARIANT (core system 7, coaching grounded in the model).
 *
 * Served defect (Paul's hiring transcript, 11 Oct; CEE 50530b5f): a decision with TWO real options ("Hire a Tech lead",
 * "Hire two developers", plus "Continue with current team") got, under "Suggest drivers", the Why?
 *   "Decisions framed with a single alternative ('whether or not') fail more often than ones with real alternatives…"
 * That sentence is RC-WIDEN's science basis and describes ONE case: W2Z (no option) / W2 (one option). The disclosure
 * took the ROW's sentence for every variant (`eligibleInterventionFor`, `why: row.science_basis.summary`), so W1 and
 * W3–W7 made a false claim about the user's own decision. The policy's progressive_detail ties the Why to the variant
 * ("Why: one line on the variant's why_now").
 *
 * Signals are the served hiring model's (live run 2026-10-11T222932Z, hiring/turns/14.json): two non-status-quo options,
 * status quo `continue_with_current_team`, three risks, two goal-path factors, run complete_current withheld
 * `goal_path_unsized`. The real selector picks the variant; nothing is stubbed.
 */
import { describe, expect, it } from 'vitest';
import { POLICY } from '../guidance/policy.js';
import { selectGuidance, type GuidanceSignals } from '../guidance/index.js';
import { eligibleInterventionFor, guidanceWireFor } from '../turn-context/guidance-wire.js';

const WIDEN = POLICY.rows.find(r => r.policy_id === 'RC-WIDEN')!;
const SINGLE_ALTERNATIVE = WIDEN.science_basis.summary;
const WHY_NOW = WIDEN.why_now as Readonly<Record<string, string>>;

const HIRING: GuidanceSignals = {
  'turn.request': 'turn',
  'open.decision_point': false,
  'run.kind': 'complete_current',
  'run.withheld_reason': 'goal_path_unsized',
  'model.goal_present': true,
  'model.goal_label': 'productivity',
  'model.status_quo_option_id': 'continue_with_current_team',
  'model.non_sq_option_ids': ['hire_a_tech_lead', 'hire_two_developers'],
  'model.option_labels': { hire_a_tech_lead: 'Hire a Tech lead', hire_two_developers: 'Hire two developers', continue_with_current_team: 'Continue with current team' },
  'model.same_lever': false,
  'model.risk_ids': ['code_quality_regression', 'developer_candidate_shortage', 'onboarding_drains_team_capacity'],
  'model.goal_path_factor_ids': ['mid_weight_developers', 'tech_leads'],
};

const whyFor = (signals: GuidanceSignals) => {
  const wire = guidanceWireFor(selectGuidance(signals, {}), { nodes: [], edges: [] });
  return { variant: wire?.slot1?.variant, policy: wire?.slot1?.policy_id, why: eligibleInterventionFor(wire)?.why };
};

describe('SYS2 G1 · the Why? is true of the variant the selector picked', () => {
  it('RED on 50530b5f: Paul\'s two-option hiring model (W7, "Suggest drivers") is not told it has a single alternative', () => {
    const got = whyFor(HIRING);
    expect(got).toMatchObject({ policy: 'RC-WIDEN', variant: 'W7' });
    expect(got.why).not.toBe(SINGLE_ALTERNATIVE);
    expect(got.why).toBe(WHY_NOW.W7);
  });

  it('RED on 50530b5f: the same model with one risk (W6, "Suggest risks") gets the risk reason, not "single alternative"', () => {
    const got = whyFor({ ...HIRING, 'model.risk_ids': ['code_quality_regression'] });
    expect(got).toMatchObject({ policy: 'RC-WIDEN', variant: 'W6' });
    expect(got.why).toBe(WHY_NOW.W6);
  });

  it('NEGATIVE (kept): a genuine single-alternative decision (W2: one option) still gets the science sentence', () => {
    const got = whyFor({ ...HIRING, 'model.non_sq_option_ids': ['hire_a_tech_lead'] });
    expect(got).toMatchObject({ policy: 'RC-WIDEN', variant: 'W2' });
    expect(got.why).toBe(SINGLE_ALTERNATIVE);
  });

  it('NEGATIVE (kept): no option at all (W2Z) still gets the science sentence', () => {
    const got = whyFor({ ...HIRING, 'model.non_sq_option_ids': [] });
    expect(got).toMatchObject({ policy: 'RC-WIDEN', variant: 'W2Z' });
    expect(got.why).toBe(SINGLE_ALTERNATIVE);
  });

  it('every RC-WIDEN variant with real alternatives carries its own approved why_now; only W2Z/W2 carry the row sentence', () => {
    const variants = (WIDEN.trigger_predicate as { variants: readonly { id: string }[] }).variants.map(v => v.id);
    expect(variants).toEqual(['W1', 'W2Z', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7']);
    for (const variant of variants) {
      const why = eligibleInterventionFor({ slot1: { policy_id: 'RC-WIDEN', variant } as never })?.why;
      expect(why, variant).toBe(variant === 'W2Z' || variant === 'W2' ? SINGLE_ALTERNATIVE : WHY_NOW[variant]);
      expect(typeof why === 'string' && why.length > 0, variant).toBe(true);
    }
  });

  it('CONTRAST: a row whose sentence holds for every variant keeps it (RC-STRENGTHEN-ITEM S1–S3V, assumption-based planning)', () => {
    const strengthen = POLICY.rows.find(r => r.policy_id === 'RC-STRENGTHEN-ITEM')!;
    for (const variant of ['S1', 'S2', 'S3L', 'S3V']) {
      const why = eligibleInterventionFor({ slot1: { policy_id: 'RC-STRENGTHEN-ITEM', variant } as never })?.why;
      expect(why, variant).toBe(strengthen.science_basis.summary);
    }
  });
});
