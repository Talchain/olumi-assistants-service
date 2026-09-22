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
    max_output_tokens: 6000,
    reasoning_effort: 'high',
    evidence:
      'Measured 22 Sep on the live API against the real buildCandidateSchema(), at a 6000 ceiling: ' +
      'status "completed", in 838 / out 3404 incl. 2070 reasoning, 54.4 s. It returned 4 options, ' +
      '11 factors, 6 risks, 6 outcomes, 18 links (5 of them direction "unknown", i.e. withheld ' +
      'rather than guessed), 1 constraint and 4 interventions. ' +
      'The measured output EXCEEDS the 2600 widening ceiling, so this role cannot borrow that ' +
      'budget; 6000 leaves ~1.8x margin over the measurement. ' +
      'NOTE: a one-pass vs two-pass comparison has NOT been re-derived this session \u2014 this ' +
      'entry justifies the budget only, not a choice between the two chains.',
  },
  {
    model: 'gpt-5.6-terra',
    role: 'conversation',
    max_output_tokens: 3400,
    evidence:
      'Banked managed_agent_terra 6 turns: out 3389 TOTAL across six turns incl. 615 reasoning, ' +
      'reasoning effort omitted (model default). Per-turn need is far below this; the figure is the ' +
      'six-turn total and is deliberately generous for one turn.',
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
