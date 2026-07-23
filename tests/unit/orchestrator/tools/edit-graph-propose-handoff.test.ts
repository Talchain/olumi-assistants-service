/**
 * F-1 (POSTDEPLOY-PROBES-573-2026-07-20, P0-class) — the edit lane never
 * reaches op emission on configure phrasings.
 *
 * LIVE EVIDENCE (deployed build 53b817b, scenario
 * e1d9b089-a08f-4e40-a760-5e8931c09416): nine consecutive configure-shaped
 * turns each exited `edit_graph` with `llm_calls=0` and the deterministic
 * copy "I have changes in mind for **X**, but I need the specifics to apply
 * them directly." — while the specifics ("set CRM Feature Depth to 0.7")
 * were IN the message. Answering the clarify in the assistant's own requested
 * format produced no ops either. `opt_cloud_native.interventions` was still
 * `null` after all nine.
 *
 * MECHANISM RULE PINNED HERE: a deterministic claim must either fully handle
 * the turn OR fall through to the more capable path — never claim-then-starve.
 * The propose_and_confirm branch may only terminate a turn when it holds a
 * STORED proposal to replay (V4 confirm round-trip) or when the turn carries
 * no value or direction for either path to act on.
 *
 * The probe phrasings below are VERBATIM from
 * parallel-briefs/postdeploy-573-captures/ — do not paraphrase them.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: vi.fn().mockResolvedValue('You are editing a graph.'),
  getSystemPromptMeta: vi.fn().mockReturnValue(undefined),
}));

vi.mock('../../../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config, {
      get(target, prop) {
        if (prop === 'cee') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(ceeTarget, ceeProp) {
              if (ceeProp === 'maxRepairRetries') return 1;
              if (ceeProp === 'patchPreValidationEnabled') return false;
              if (ceeProp === 'patchBudgetEnabled') return false;
              return Reflect.get(ceeTarget, ceeProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

import { handleEditGraph } from '../../../../src/orchestrator/tools/edit-graph.js';
import type { ConversationContext } from '../../../../src/orchestrator/types.js';
import type { LLMAdapter } from '../../../../src/adapters/llm/types.js';

/** Mirrors the live probe scenario's graph shape (P0 draft, DB-verified). */
function makeCrmContext(): ConversationContext {
  return {
    graph: {
      nodes: [
        { id: 'dec_crm', kind: 'decision', label: 'CRM Platform Selection' },
        { id: 'opt_cloud_native', kind: 'option', label: 'Cloud-Native CRM' },
        { id: 'opt_onprem', kind: 'option', label: 'On-Prem Suite' },
        { id: 'fac_feature_depth', kind: 'factor', label: 'CRM Feature Depth' },
        { id: 'fac_cost', kind: 'factor', label: 'CRM Platform Cost' },
        { id: 'goal_roi', kind: 'goal', label: 'Maximise 3-Year ROI' },
      ],
      edges: [
        {
          from: 'fac_cost',
          to: 'goal_roi',
          strength: { mean: 0.5, std: 0.1 },
          exists_probability: 0.9,
          effect_direction: 'negative',
        },
      ],
    } as unknown as ConversationContext['graph'],
    analysis_response: null,
    framing: null,
    messages: [],
    scenario_id: 'e1d9b089-a08f-4e40-a760-5e8931c09416',
  };
}

/** The intervention write the served edit prompt emits for a configure turn. */
const INTERVENTION_OP = {
  op: 'update_node',
  path: '/nodes/opt_cloud_native/data/interventions/fac_feature_depth',
  value: '0.7',
};

function makeAdapter(): { adapter: LLMAdapter; chat: ReturnType<typeof vi.fn> } {
  const chat = vi.fn().mockResolvedValue({
    content: JSON.stringify({
      operations: [INTERVENTION_OP],
      removed_edges: [],
      warnings: [],
      coaching: { summary: 'Set the Cloud-Native CRM effect on CRM Feature Depth to 0.7.' },
    }),
  });
  return {
    chat,
    adapter: {
      name: 'test',
      model: 'test-model',
      chat,
      draftGraph: vi.fn(),
      repairGraph: vi.fn(),
      suggestOptions: vi.fn(),
      clarifyBrief: vi.fn(),
      critiqueGraph: vi.fn(),
      explainDiff: vi.fn(),
    } as unknown as LLMAdapter,
  };
}

/** Verbatim probe phrasings + their capture filenames. */
const STARVED_PROBES: ReadonlyArray<readonly [string, string]> = [
  [
    'P4 / T12 (P4_T12_configure.json)',
    'Configure Cloud-Native CRM: set its CRM Feature Depth to 0.7 and CRM Platform Cost to 0.55.',
  ],
  [
    'P4c / T12 disambiguation reply (P4c_T12_disambig_reply.json)',
    "I meant the Cloud-Native CRM option's effect: set its effect on CRM Feature Depth to 0.7.",
  ],
  [
    'P5 / T12b (P5_T12b_configure_option.json)',
    'Configure the Cloud-Native CRM option: set CRM Feature Depth to 0.7, set CRM Platform Cost to 0.55.',
  ],
  [
    'P5b / T12b single change (P5b_T12b_single_change.json)',
    'Configure the Cloud-Native CRM option: set CRM Feature Depth to 0.7.',
  ],
  [
    'P6 / T12c (P6_T12c_under_option.json)',
    'Under the Cloud-Native CRM option, set its effect on CRM Feature Depth to 0.7.',
  ],
  [
    "P7 / T15 assistant's own format (P7_T15_own_format.json)",
    'Set CRM Feature Depth to 0.7 and CRM Platform Cost to 0.55 for the Cloud-Native CRM option.',
  ],
  [
    'P9b / redirect to the factor (P9b_A6_redirect_to_factor.json)',
    "No - I meant the factor itself: set the CRM Platform Cost factor's value to 0.55, not anything on the option.",
  ],
];

describe('F-1 — propose_and_confirm must hand off, never claim-then-starve', () => {
  it.each(STARVED_PROBES)(
    '%s reaches the edit LLM lane instead of a specifics-blind clarify',
    async (_id, message) => {
      const { adapter, chat } = makeAdapter();
      const result = await handleEditGraph(
        makeCrmContext(),
        message,
        adapter,
        'req-handoff',
        'turn-handoff',
      );

      // The live defect: llm_calls === 0 on every one of these turns.
      expect(chat).toHaveBeenCalled();
      // And the copy that asked for specifics already present must be gone.
      expect(result.assistantText ?? '').not.toContain('I need the specifics');
      // The branch must not mint an unconfirmable write-only proposal.
      expect(result.pendingProposal).toBeUndefined();
    },
  );

  it('the handed-off turn actually produces intervention operations', async () => {
    const { adapter } = makeAdapter();
    const result = await handleEditGraph(
      makeCrmContext(),
      'Configure Cloud-Native CRM: set its CRM Feature Depth to 0.7 and CRM Platform Cost to 0.55.',
      adapter,
      'req-ops',
      'turn-ops',
    );
    expect((result.operations?.length ?? 0)).toBeGreaterThan(0);
  });

  it('the heuristically-preferred option target is NOT pinned into the prompt on a handed-off turn', async () => {
    // REVIEW-573 C-1 kept the negation-blind option preference out of
    // auto-apply. Handing off must not smuggle it back in as an instruction:
    // the LLM has to read "shouldn't change" for itself. (F-3 residual —
    // negation handling itself is a separate lane.)
    const { adapter, chat } = makeAdapter();
    await handleEditGraph(
      makeCrmContext(),
      "Set CRM Platform Cost to 0.55 - the configuration of Cloud-Native CRM shouldn't change.",
      adapter,
      'req-neg',
      'turn-neg',
    );
    expect(chat).toHaveBeenCalled();
    const systemPrompt = String(chat.mock.calls[0]?.[0]?.system ?? chat.mock.calls[0]?.[0] ?? '');
    expect(systemPrompt).not.toContain('Apply this request to the existing Cloud-Native CRM option only.');
  });
});

describe('F-1 — the clarify survives exactly where it is still honest', () => {
  it('a genuinely vague configure (no value, no direction) still clarifies deterministically', async () => {
    // "A clarify is correct ONLY when neither path can proceed." With no
    // value and no direction in the message, the LLM lane cannot produce a
    // value op either — asking is the truthful move, and it costs no tokens.
    const { adapter, chat } = makeAdapter();
    const result = await handleEditGraph(
      makeCrmContext(),
      'Configure the Cloud-Native CRM option.',
      adapter,
      'req-vague',
      'turn-vague',
    );
    expect(chat).not.toHaveBeenCalled();
    expect(result.assistantText ?? '').toContain('I need the specifics');
  });

  it('a stored proposal is still a legitimate reason to KEEP the turn deterministically (no LLM handoff); the vestigial V4 pendingProposal mint is retired (S3-L1)', async () => {
    // F-1's live guarantee: a stored `pending_proposal` is the one case where
    // this branch holds something the LLM lane does not, so a value-bearing
    // message that would otherwise hand off KEEPS the turn deterministically
    // (`shouldHandOffProposeToLlmLane` returns false when hasStoredProposal).
    // That exception is what this test still pins — the LLM lane is NOT reached.
    //
    // ADJUDICATION (S3-L1): the `pending_proposal` IN / `pendingProposal` OUT
    // round-trip this test used to assert is DEAD on the live V5 wire, so the
    // vestigial mint is retired rather than kept. Traced end-to-end at the
    // bytes: (1) the ONLY code that threads `invocationInput.pending_proposal`
    // in AND reads `result.pendingProposal` back is the V4 pipeline
    // (phase3-llm / phase4-tools / tools/dispatch / deterministic-actions),
    // which is 410-tombstoned by default (`pipelineV4Enabled` defaults false →
    // route.ts returns 410); (2) the live V5 dispatcher
    // (edit-graph-dispatch.ts) calls handleEditGraph WITHOUT any
    // invocationInput — so `pending_proposal` is never threaded in on the
    // deployed path — and consumes the result via buildBoundarySuggestedActions,
    // which reads only `suggestedActions` + `pendingClarification`, never
    // `pendingProposal` (see the "pendingProposal accept/cancel chips
    // intentionally NOT rendered" note, edit-graph-dispatch.ts:738-757). The
    // input this test constructs by hand is one the live wire never produces.
    const { adapter, chat } = makeAdapter();
    const result = await handleEditGraph(
      makeCrmContext(),
      'Configure the Cloud-Native CRM option: set CRM Feature Depth to 0.7.',
      adapter,
      'req-stored',
      'turn-stored',
      {
        invocationInput: {
          pending_proposal: {
            tool: 'edit_graph',
            original_edit_request: 'Configure the Cloud-Native CRM option: set CRM Feature Depth to 0.7.',
            proposed_changes: {
              changes: [
                {
                  description: 'Set CRM Feature Depth to 0.7',
                  element_label: 'Cloud-Native CRM',
                  action_type: 'option_config',
                },
              ],
            },
            candidate_labels: ['Cloud-Native CRM'],
            base_graph_hash: 'deadbeef',
          },
        },
      } as never,
    );
    // POSITIVE control (the surviving live guarantee): the stored proposal made
    // the branch KEEP the turn — the LLM lane was not reached even though the
    // message carries a value ("0.7"), and the deterministic hold copy names
    // the resolved target the stored proposal is about.
    expect(chat).not.toHaveBeenCalled();
    expect(result.assistantText ?? '').toContain('**Cloud-Native CRM**');
    // Retired: the write-only V4 mint no longer round-trips (see adjudication).
    expect(result.pendingProposal).toBeUndefined();
  });
});

describe('F-2 — the surviving clarify never bolds a non-entity', () => {
  it('a vague multi-clause configure bolds only real graph entities', async () => {
    // This message carries no value or direction, so it legitimately KEEPS the
    // deterministic clarify (F-1 rule) — which is exactly why F-2 still has a
    // live surface after F-1 is fixed. The trailing clause names nothing in
    // the graph; before the fix it was bolded as an understood target.
    const { adapter, chat } = makeAdapter();
    const result = await handleEditGraph(
      makeCrmContext(),
      'Configure the Cloud-Native CRM option and tidy up whatever else looks off.',
      adapter,
      'req-garble',
      'turn-garble',
    );
    expect(chat).not.toHaveBeenCalled();
    const text = result.assistantText ?? '';
    expect(text).toContain('I need the specifics');

    const bolded = [...text.matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1]!.trim());
    const graphLabels = new Set([
      'CRM Platform Selection',
      'Cloud-Native CRM',
      'On-Prem Suite',
      'CRM Feature Depth',
      'CRM Platform Cost',
      'Maximise 3-Year ROI',
    ]);
    expect(bolded.length).toBeGreaterThan(0);
    for (const entity of bolded) {
      expect(graphLabels.has(entity.replace(/\.$/, ''))).toBe(true);
    }
  });
});

describe('F-2 — later clauses resolve against the GRAPH label set', () => {
  it('a second clause naming a real factor is bolded as that factor', async () => {
    // Discriminates the label-SOURCE half of the F-2 fix from the
    // bold-filter half. `resolution.candidate_labels` holds only the labels
    // that already resolved as targets (live: ["Cloud-Native CRM"]), so
    // before the fix clause 2 could never match and "CRM Platform Cost" was
    // lost — the filter alone would silently drop it instead of naming it.
    const { adapter, chat } = makeAdapter();
    const result = await handleEditGraph(
      makeCrmContext(),
      'Configure the Cloud-Native CRM option and the CRM Platform Cost factor.',
      adapter,
      'req-label-source',
      'turn-label-source',
    );
    expect(chat).not.toHaveBeenCalled();
    const text = result.assistantText ?? '';
    expect(text).toContain('**Cloud-Native CRM**');
    expect(text).toContain('**CRM Platform Cost**');
  });
});

describe('F-1 — deliberate behaviour change outside the probe set', () => {
  it('"Make Price double" — a stated direction is acted on, not asked for again', async () => {
    // This turn used to take the propose branch and answer a stated
    // direction ("double") with a request for a direction. It is the same
    // claim-then-starve shape as the 5c probes, just outside the captured
    // set. edit-graph.test.ts's Mode A copy pin was re-fixtured onto a
    // genuinely value-free message rather than left pinning this.
    const { adapter, chat } = makeAdapter();
    const result = await handleEditGraph(
      makeCrmContext(),
      'Make CRM Platform Cost double',
      adapter,
      'req-double',
      'turn-double',
    );
    expect(chat).toHaveBeenCalled();
    expect(result.assistantText ?? '').not.toContain('I need the specifics');
  });
});

describe('F-1 — regression pins (the fix must not over-reach)', () => {
  it('P12 control: a plain factor value set still auto-applies through the LLM lane', async () => {
    const { adapter, chat } = makeAdapter();
    await handleEditGraph(
      makeCrmContext(),
      'Set CRM Platform Cost to 45000 pounds.',
      adapter,
      'req-ctl',
      'turn-ctl',
    );
    expect(chat).toHaveBeenCalled();
  });
});
