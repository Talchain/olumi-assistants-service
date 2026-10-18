/** Leaf catalogue: no runtime imports into reply/compose modules. */
export const CLASS_MARKERS = {
  flip_threshold: ['sensitivity check', 'how far it can move', 'flip the', 'would flip', 'could change if', 'factor threshold'],
  driver: ['rests most on', 'most of the work', 'main driver', 'strongest driver', 'rests on a single factor'],
  sensitivity: ['sensitive to', 'sensitivity'],
  chance: ['chance of', 'chance is', 'chance falls'],
  range: ['between about', 'likely range', 'between '],
  leader: ['most-supported', 'leads', 'scored highest', 'supported by'],
  horizon: ['within', 'horizon', 'tested range', "doesn't project"],
  widened_not_in_chance: ["aren’t in the chance", "aren't in the chance", 'not in the chance'],
  robustness: ['robust', 'fragile'],
  other_science: ['confidence check', 'ranked one assessed', 'usable but not yet solid', 'least sure about', 'highest-value thing'],
} as const;

/** OBLIGATIONS: required disclosures across the whole reply, independent of the cell mix.
 * Catalogue only; production enforcement belongs to P45 S4 #2895. Target: zero gaps. */
export const OBLIGATIONS = {
  HORIZON_LIMIT_STATED: {
    trigger: 'goal horizon H held && no carrier at H',
    surfaces: ['face', 'detail', 'withhold_line'],
    owners: [
      'src/orchestrator-v5/agent-lane/decision-input-ask.ts#untestedHorizonLineForCells', // host A7
      'src/orchestrator-v5/agent-lane/decision-input-ask.ts#withCellHorizonWarning', // Run warning chance form
      'src/orchestrator-v5/goal-target/zero-spread-horizon-line.ts#zeroSpreadNoCarrierHorizonLine', // Science §(o′)
    ],
  },
} as const;

export type ScienceClaimClass = keyof typeof CLASS_MARKERS;
export type ClaimSubject = 'factor' | 'option' | 'link' | 'goal' | 'run_wide';
export type ClaimSurface = 'chat' | 'coaching_block' | 'analysis_block' | 'wire';
export type ClaimLicenceEntry = {
  readonly id: string;
  readonly owner: string;
  readonly surface: ClaimSurface;
  readonly subject: ClaimSubject;
  readonly binding: { readonly subjectField: string | null; readonly run: 'selected_current' };
  /** Informational argument name only. Null does not rule out keyed, sole-goal or selected-Run binding. */
  readonly readerSubjectParameter: string | null;
} & ({ readonly class: ScienceClaimClass; readonly licence: string | null; readonly evidenceRow?: string; readonly reason?: string; readonly producer?: { readonly status: 'exists' | 'missing'; readonly field: string; readonly gap: string } }
  | { readonly class: 'not_a_claim'; readonly licence: null; readonly reason: string; readonly reviewedLiteralHash: string; readonly reviewedLiterals?: readonly string[] });

/** Null means no sufficient producer licence for the whole owner; existing partial gates are not promoted.
 * Escape hashes bind review to exact discovered literals, so an escaped owner cannot acquire new copy silently. */
// RULE 1 is behavioural: producer material for S alone licenses claims about S in the selected Run.
// A passing MISMATCH row proves keyed, sole-goal or Run binding; a parameter name proves nothing.
// Null bindings are declared gaps, not evidence.
// selected_current on null/non-claim entries records the required scope, not a grant.
// #2890 landed: DOMINANT_DRIVER_MEASURED_TAIL is licensed (subject + selected Run); see the flip_threshold.dominant_driver.subject row.

/** The owner rows live in the CI data file beside the census discovery script (JSON, outside src): their review hashes and owner paths
 * are literals that src-wide scan guards (yardstick drift pin, consent-coverage manifest) would otherwise read as mirrors. */
