/**
 * ONE VERDICT, SAID ONE WAY: ADMISSION'S SENTENCE AGREES WITH THE CAVEATED LEADER (DL #70 5845827326).
 *
 * Paul, 7 Sep: "caveat, not withhold" (programme-docs#38 5576895511) — on a `quantified_provisional` run the
 * leader is named WITH a caveat. Served (AI Quality #70 5845776236, CEE bc09bb1, agent lane, OpenAI only): the
 * reply opened "Release to All Now is provisionally separated in this model, but the comparison is fragile" —
 * that ruling working — while admission's own sentence in the same payload said "no option can be called the
 * leader". One fact, stated two ways.
 *
 * The fix is admission's COPY, not the leader: `leader_claim` and both gates are unchanged. The two
 * `quantified_provisional` sentences say figures, and which option they favour, can be shown only as
 * provisional, and keep the remedy each already names.
 *
 * The graph is the served run turn's `draft_graph` (its hash matches the admission's). Two cells are that graph
 * with ONE stamp changed; each premise is pinned in-test.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { resolveAnalysisAdmission } from '../analysis-admission.js';
import { textNamesLeadingOption } from '../../compose/leading-option-egress-guard.js';

type Json = Record<string, any>;
const SERVED = JSON.parse(
  readFileSync(new URL('./fixtures/served-provisional-leader.bc09bb1.json', import.meta.url), 'utf8'),
) as { draft_graph: Json; graph_hash: string; analysis_ready: Json; analysis_state: Json; analysis_result_block: Json; assistant_text_first_line: string };

const DENIAL = 'no option can be called the leader';

function admissionOf(mutate: (g: Json) => void = () => {}) {
  const graph = structuredClone(SERVED.draft_graph);
  mutate(graph);
  return resolveAnalysisAdmission(graph);
}
const sentence = (a: ReturnType<typeof resolveAnalysisAdmission>, field: string) =>
  a.reasons.find((r) => r.field === field)?.message;
const stamp = (id: string, source: string) => (g: Json) => {
  (g.nodes as Json[]).find((n) => n.id === id)!.observed_state.source = source;
};

describe('PREMISE (served): the leader was named with a caveat while admission denied one', () => {
  it('the reply names "Release to All Now" provisionally, and leader_claim permits it', () => {
    expect(SERVED.assistant_text_first_line).toContain('Release to All Now is provisionally separated');
    expect(SERVED.analysis_state.leader_claim).toMatchObject({ permitted: true, separation: 'separated' });
    expect(SERVED.analysis_result_block.leading_option_id).toBe('release_to_all_now');
  });

  it('the same payload\'s admission said no option can be called the leader', () => {
    const admission = SERVED.analysis_ready.analysis_admission;
    expect(admission.permitted_analysis_mode).toBe('quantified_provisional');
    const served = (admission.reasons as Json[]).find((r) => r.field === 'permitted_analysis_mode');
    expect(served?.code).toBe('USER_STATED_PARAMETERS_NOT_MATERIAL');
    expect(served?.message).toContain(DENIAL);
  });

  it('the producer reproduces that cell on the served graph, at the served hash', () => {
    const a = admissionOf();
    expect(a.permitted_analysis_mode).toBe('quantified_provisional');
    expect(a.reasons.find((r) => r.field === 'permitted_analysis_mode')?.code).toBe('USER_STATED_PARAMETERS_NOT_MATERIAL');
    expect(SERVED.analysis_ready.analysis_admission.graph_hash.startsWith(SERVED.graph_hash)).toBe(true);
  });
});

describe('⭐ admission\'s sentence agrees with a caveated leader', () => {
  it('⭐ served cell (none of the deciding figures are yours): provisional, never a denial, remedy kept', () => {
    const a = admissionOf();
    for (const field of ['semantic_quality_sufficient', 'permitted_analysis_mode']) {
      expect(sentence(a, field)).toBe(
        'The values you have set sit outside what this comparison turns on, so none of the figures that decide it are yours yet. ' +
          'Figures, and which option they favour, can be shown only as provisional until you have set a value on a factor one of the options changes, ' +
          'or on another factor on the chain from there to your goal.',
      );
    }
  });

  it('⭐ every estimate is Olumi\'s: provisional, never a denial; stable/robust stays withheld, remedy kept', () => {
    const a = admissionOf(stamp('monthly_recurring_revenue', 'cee_inference'));
    expect(a.reasons.find((r) => r.field === 'permitted_analysis_mode')?.code, 'premise: the all-machine cell').toBe(
      'CONFIDENCE_PARAMETERS_ALL_MACHINE_AUTHORED',
    );
    expect(sentence(a, 'permitted_analysis_mode')).toBe(
      'Every estimate this comparison rests on is Olumi’s, not yours. ' +
        'Figures, and which option they favour, can be shown only as provisional, and no result can be called stable or robust until you have set at least one of them.',
    );
  });

  it('no quantified_provisional sentence reads as a leader claim to the egress vocabulary', () => {
    for (const a of [admissionOf(), admissionOf(stamp('monthly_recurring_revenue', 'cee_inference'))]) {
      for (const r of a.reasons) {
        expect(r.message, r.code).not.toContain(DENIAL);
        expect(textNamesLeadingOption(r.message), r.code).toBe(false);
      }
    }
  });

  it('CONTROL: once one deciding figure is the user\'s, the sentence is unchanged', () => {
    const a = admissionOf(stamp('ai_assistant_reliability_score', 'user_specified'));
    expect(sentence(a, 'semantic_quality_sufficient')).toBe(
      'At least one of the estimates this comparison rests on is yours, so a leading option can be named.',
    );
  });
});
