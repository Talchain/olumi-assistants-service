/**
 * ⭐⭐ ROADMAP 2.427 — configure-option OUTCOME↔INTENT binding.
 *
 * THE CORPUS IS REAL (trap 22). Every phrasing below is a message actually sent
 * to deployed CEE `98f2476` by the 8 Aug diagnosis lane, and every verdict is
 * the verdict that lane recorded, read back from its capture set
 * (`scratchpad/lane-2427-1786147916/MANIFEST.json`, 71 fresh-scenario
 * captures). None of it was invented here, because a corpus drawn from the
 * author's head cannot see the class the author did not imagine — and this
 * defect is precisely a class nobody imagined: the product wrote the WRONG
 * ENTITY and said so accurately.
 *
 * The graph fixture is likewise lifted from a real capture
 * (`P3r7_4_phrasing.json` → `draft_graph`): the same five option ids, the same
 * three factor ids, the same labels, and — the load-bearing detail — the same
 * shape of failure, in which `opt_cloud_native`'s edge to
 * `fac_adoption_complexity` carries `strength.mean 0.7` while the option's own
 * `interventions` stay empty and its readiness stays `needs_encoding`.
 *
 * ⚠ ONE FIXTURE IS CONSTRUCTED AND IS LABELLED AS SUCH: `wrongOptionWrite`,
 * where a DIFFERENT option gains an intervention while the named option gains
 * none. No capture in the set shows that exact shape. It is inside the
 * producer's output domain — an interventions write on some option is the
 * ordinary success operation, and P3r7 proves the edit lane does pick the wrong
 * entity — but it is a perturbation of a real capture, not a capture, and it
 * exists to carry one half of the identity mutant pair.
 */

import { describe, it, expect } from 'vitest';
import { buildConfigureOptionAdvisedFormat } from '../../configure-option-chip-text.js';

// ---------------------------------------------------------------------------
// The corpus — live phrasings, live verdicts (MANIFEST.json).
// ---------------------------------------------------------------------------

/** T12c — the intermittent phrasing this row exists for. 5/7 recorded. */
const T12C = 'Under the Cloud-Native CRM option, set its effect on Adoption Complexity to 0.7.';

interface CorpusRow {
  readonly tag: string;
  readonly phrasing: string;
  readonly note: string;
}

/**
 * Configure phrasings the deployed product RECORDED. On these, an interventions
 * write lands for the named option and the guard must stay silent — a guard
 * that fired here would replace a working confirmation with a question.
 */
const RECORDED_CORPUS: readonly CorpusRow[] = [
  {
    tag: 'P2',
    phrasing:
      'Configure the Cloud-Native CRM option: set User Adoption Complexity to 0.7, set CRM Feature Richness to 0.55.',
    note: 'configure vocab + compound value payload',
  },
  { tag: 'P3r1', phrasing: T12C, note: 'T12c, the run that recorded' },
  {
    tag: 'P4',
    phrasing:
      'Set Adoption Complexity to 0.7 and Platform Feature Richness to 0.55 for the Cloud-Native CRM option.',
    note: "the assistant's suggested format (trailing option reference)",
  },
  {
    tag: 'P5',
    phrasing: "Set the Cloud-Native CRM option's effect on Adoption Complexity to 0.7",
    note: 'the advised format — buildConfigureOptionAdvisedFormat verbatim',
  },
  {
    tag: 'P6',
    phrasing: 'For the Cloud-Native CRM option, set its effect on Adoption Complexity to 0.7.',
    note: 'leading option reference',
  },
];

// ---------------------------------------------------------------------------
// 2. The RECORDED corpus — the guard must stay silent.
// ---------------------------------------------------------------------------

describe('ROADMAP 2.427 — recorded configure phrasings stay untouched', () => {

  it('the advised format is derived from the shipped builder, not transcribed', () => {
    // Pins P5 to the producer: if `buildConfigureOptionAdvisedFormat` changes,
    // this corpus row is wrong and says so, rather than silently testing a
    // phrasing the product no longer advises (trap 12b — a control pinned to a
    // literal decays the moment the literal moves).
    const advised = buildConfigureOptionAdvisedFormat(
      'Cloud-Native CRM',
      'Adoption Complexity',
      '0.7',
    );
    expect(RECORDED_CORPUS.find((r) => r.tag === 'P5')!.phrasing).toBe(advised);
  });
});
