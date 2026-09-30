/**
 * Agent lane — per-role, per-model call budgets.
 *
 * ⛔ DO NOT GIVE EVERY REASONING CALL 6,000 OUTPUT TOKENS. Sol High needed that
 * headroom; giving it to every model and role would buy latency and spend we
 * have no evidence we need.
 *
 * These are the BANKED MEASURED configurations, per model and role, and they are
 * raised only where evidence requires it. Each entry carries the measurement it
 * came from so a future change has to argue with data.
 */

export interface CallBudget {
  readonly model: string;
  readonly role: 'faithful' | 'widening' | 'whole' | 'conversation';
  readonly max_output_tokens: number;
  /** Omitted means "model default", which is what the banked sessions used. */
  readonly reasoning_effort?: 'low' | 'medium' | 'high';
  readonly temperature?: number;
  /** The measurement this budget is set from. */
  readonly evidence: string;
}

export const BANKED_BUDGETS: readonly CallBudget[] = [
  {
    model: 'gpt-4.1',
    role: 'faithful',
    max_output_tokens: 1800,
    temperature: 0,
    evidence:
      'Banked manifest faithful_builder. Re-measured 22 Sep on the live API: in 568 / out 442 — ' +
      '25% of the budget used, so 1800 has ample margin.',
  },
  {
    model: 'gpt-5.6-terra',
    role: 'widening',
    max_output_tokens: 2600,
    reasoning_effort: 'high',
    evidence:
      'Banked manifest terra_widener measured out 2495 against max 2600 (96%). Re-measured 22 Sep ' +
      'at a 6000 ceiling: out 2409 incl. 475 reasoning. So 2600 fits, but the margin is ~100-200 ' +
      'tokens and a slightly longer critique would truncate. Watch this one; raise on a measured ' +
      'truncation, not on suspicion.',
  },
  {
    model: 'gpt-5.6-sol',
    role: 'widening',
    max_output_tokens: 6000,
    reasoning_effort: 'high',
    evidence:
      'Banked manifest sol_widener_retest. At 2600 Sol consumed the entire budget on reasoning and ' +
      'emitted NO structured answer; at 6000 it produced a valid result (out 2264 incl. 1002 ' +
      'reasoning). The headroom is required for this model, and for this model only.',
  },
  {
    model: 'gpt-5.6-terra',
    role: 'whole',
    // Was 6000: raised on a MEASURED truncation (see RAISED 27 Sep below), not on suspicion.
    max_output_tokens: 12000,
    reasoning_effort: 'medium',
    evidence:
      'EFFORT: MEDIUM per OpenAI Technical Architecture ruling (#63 5798194848), measured 23 Sep ' +
      'through the real buildModelFromBrief + admission on the compact builder (#1736): median ' +
      '40\u201344 s at medium vs 62\u201370 s at high on both canonical briefs, 0/8 structurally ' +
      'blocked at medium (#63 5797881172). Held-out fidelity (3 other briefs, n=2 + a warehouse ' +
      'n=3 recheck, output/paul-test-20260923/construction-witness/raw/fidelity-*.jsonl): medium ' +
      '6/6 built vs high 5/6 (one model_too_large refusal); options and structure intact at both; ' +
      'a stated budget cap reached goal_constraints 3/4 at high vs 2/5 at medium on the warehouse ' +
      'brief and 100% at both elsewhere \u2014 stochastic at BOTH efforts, not a medium regression ' +
      '(a construction-contract gap, not an effort one). High is the fallback on a material ' +
      'fidelity regression. ' +
      'BUDGET: measured 22 Sep on the live API against the real buildCandidateSchema(), at a 6000 ceiling: ' +
      'status "completed", in 838 / out 3404 incl. 2070 reasoning, 54.4 s. It returned 4 options, ' +
      '11 factors, 6 risks, 6 outcomes, 18 links (5 of them direction "unknown", i.e. withheld ' +
      'rather than guessed), 1 constraint and 4 interventions. ' +
      'The measured output EXCEEDS the 2600 widening ceiling, so this role cannot borrow that ' +
      'budget; 6000 leaves ~1.8x margin over the measurement. ' +
      'NOTE: a one-pass vs two-pass comparison has NOT been re-derived this session \u2014 this ' +
      'entry justifies the budget only, not a choice between the two chains. ' +
      'RAISED 27 Sep, 6000 -> 12000, on a MEASURED truncation: on served CEE 770a477, 2 of 14 ' +
      'first-brief turns failed ("technical error") because this call stopped at output_tokens ' +
      '6000 EXACTLY (reasoning 4406 and 4896): reasoning spent the budget and the strict-schema ' +
      'JSON was cut off (DL acceptance runs pj-20260927T162124Z C01, pj-20260927T162916Z A01). ' +
      'Across 119 banked construction calls: median out 2926 incl. 2061 reasoning, largest ' +
      'successful out 5573, largest visible answer 2040, reasoning 0 to at least 4896. So the ' +
      'served need is >= 4896 + 2040 = 6936, and 12000 is ~1.7x that (the ~1.8x convention ' +
      'above). Not higher: at the measured ~76-87 output tokens/s, ~8.7k tokens is all that can ' +
      'finish inside the 125 s browser proxy less 10 s response headroom, so a larger ceiling ' +
      'buys spend, not a model the user receives. The ceiling costs a call that finishes below ' +
      'it nothing; only a call that would otherwise have been cut off runs longer.',
  },
  {
    model: 'gpt-5.6-terra',
    role: 'conversation',
    max_output_tokens: 3400,
    // PJ-C1 (DL #72 5860966219, batch 5): served journey A (pj-20260927T233309Z) spent 2,127 of 5,367 conversation
    // output tokens on reasoning at the model default, ≈ 17 s at the measured 8.1 ms per output token.
    reasoning_effort: 'low',
    evidence:
      'Banked managed_agent_terra 6 turns: out 3389 TOTAL across six turns incl. 615 reasoning, ' +
      'reasoning effort omitted (model default). Per-turn need is far below this; the figure is the ' +
      'six-turn total and is deliberately generous for one turn. Effort LOW from 28 Sep: served journey A ' +
      '(pj-20260927T233309Z, 20 calls) measured call ms = 1,395 + 8.1 x output tokens (r 0.89), with 40% of output ' +
      'tokens reasoning at the default; accepted only on a served journey-A run passing AIQ\'s truth rows (#72 5860911820).',
  },
  {
    model: 'gpt-6.1-sol',
    role: 'conversation',
    max_output_tokens: 3400,
    reasoning_effort: 'high',
    evidence:
      'Selected Sol-high coach v0.2 by AI Experience/DL (programme-docs #78 5915140232 / 5915156800). ' +
      'Real-route paired gate at docs 50ce5eba, n=1/row: largest Sol-high hop across 20 gate turns ' +
      'used 1140 output tokens; median 20.1 s versus Terra 8.5 s. Keep the measured 3400 cap; ' +
      'no evidence supports a 16000 cap. Exact prompt/config handoff #78 5915316114.',
  },
  {
    model: 'gpt-5.6-sol',
    role: 'conversation',
    max_output_tokens: 3400,
    evidence:
      'Banked managed_agent_sol 6 turns: out 3311 total incl. 1026 reasoning, effort omitted.',
  },
];

/**
 * Resolve a budget. Throws rather than guessing: an unbudgeted (model, role) is
 * a decision nobody has made, and silently defaulting it is how every call ends
 * up at 6,000.
 */
export function budgetFor(model: string, role: CallBudget['role']): CallBudget {
  const hit = BANKED_BUDGETS.find((b) => b.model === model && b.role === role);
  if (hit === undefined) {
    throw new Error(
      `agent-lane: no measured budget for model "${model}" role "${role}". Add one to ` +
        `BANKED_BUDGETS with the measurement that justifies it — do not default it.`,
    );
  }
  return hit;
}
