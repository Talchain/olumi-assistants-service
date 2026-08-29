/**
 * Core Runtime canonical-state precedence / live-model retention floors.
 *
 * These tests drive the real ContextPack assembler and routing serialiser. They
 * prove transport and scorer discrimination; the separately gated CLI is the
 * only live-model rung.
 */

import { describe, expect, it } from 'vitest';

import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
} from '../../../src/adapters/llm/types.js';
import {
  routeWithToolUse,
  type RoutingResult,
} from '../../../src/orchestrator-v5/routing/route-with-tool-use.js';
import {
  CanonicalConflictCaseSchema,
  SummaryRetentionCaseSchema,
  assembleCanonicalPrecedenceCase,
  loadCanonicalPrecedenceCase,
  scoreCanonicalPrecedenceAnswer,
  visibleAnswerFromRoutingResult,
  type CanonicalConflictCase,
  type SummaryRetentionCase,
} from '../scorer/canonical-state-precedence.js';

const conflict = loadCanonicalPrecedenceCase(
  'canonical-precedence-case.json',
) as CanonicalConflictCase;
const retention = loadCanonicalPrecedenceCase(
  'summary-retention-case.json',
) as SummaryRetentionCase;

const CORRECT_CONFLICT_ANSWER = [
  'Saved target: 180000 £',
  'Saved constraints: Budget must not exceed £180,000; Regulatory confirmation required by 15 March',
  'Accepted change: Updated Delivery team size from 25 people to 40 people.',
  'Unresolved: Validate the written regulatory confirmation by 15 March',
  'Evidence basis: The board approved a maximum Northern Hub programme envelope of £180,000 on 12 August.',
  'Analysis status: stale',
  'Standing constraint: Bluebird remains valid through 17 September.',
  'Not current: £350,000; 30 June; Harbour East selected; supplier assurance complete; Harbour East leads',
].join('\n');

const CORRECT_RETENTION_ANSWER =
  'Standing constraint: Bluebird remains valid through 17 September.';

function textResult(text: string): ChatWithToolsResult {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    } as ChatWithToolsResult['usage'],
    model: 'fixture-routing-model',
    latencyMs: 1,
  };
}

describe('canonical precedence journey — transport is real and conflicting', () => {
  it('carries current structured truth and the conflicting long-session summary to the same routing prompt', () => {
    const assembled = assembleCanonicalPrecedenceCase(conflict);
    const prompt = assembled.userMessage;

    expect(assembled.contextPack.graph_context).toEqual({ status: 'canonical' });
    expect(prompt).toContain('"graph_context"');
    expect(prompt).toContain('"status": "canonical"');
    expect(assembled.contextPack.conversation.window).toMatchObject({
      shown: 8,
      available: 28,
      summarised: 12,
    });
    expect(prompt).toContain('"status": "set"');
    expect(prompt).toContain('"value": 180000');
    expect(prompt).toContain('Updated Delivery team size from 25 people to 40 people.');
    expect(prompt).toContain('Validate the written regulatory confirmation by 15 March');
    expect(prompt).toContain('£350,000 ceiling and a 30 June regulatory date');
    expect(assembled.recentTurnsText).toContain('Harbour East still leads');
    expect(assembled.recentTurnsText).not.toContain('£350,000');
    expect(assembled.recentTurnsText).not.toContain('Bluebird');
    expect(prompt).toContain('"freshness": "stale"');
    // Deliberate LITERALS, not a manifest read. The assembler already derives
    // both FROM the manifest, so re-deriving them here would be a guard
    // agreeing with itself (CLAUDE.md trap 13b) — the point of a literal is
    // that a prompt-identity change cannot pass unnoticed.
    //
    // `version` is still 120 because PMS still SERVES v120: the 2026-08-29
    // handler-coverage change moved the repo-canonical bytes ahead of the PMS
    // row, and the manifest deliberately holds `served_version: 120` /
    // `served_hash_verified: false` until the operator uploads v121 (see the
    // `pending_pms_upload` block on the manifest's `routing` row). When that
    // upload lands, this becomes '121'.
    expect(assembled.systemPrompt.version).toBe('120');
    expect(assembled.systemPrompt.sent_hash).toBe('bec840a648800928');
  });

  it('routes through the production adapter seam and the scorer accepts only the visible answer', async () => {
    const assembled = assembleCanonicalPrecedenceCase(conflict);
    const calls: ChatWithToolsArgs[] = [];
    const adapter = {
      chatWithTools: async (args: ChatWithToolsArgs): Promise<ChatWithToolsResult> => {
        calls.push(args);
        return textResult(CORRECT_CONFLICT_ANSWER);
      },
    };

    const result = await routeWithToolUse(
      assembled.contextPack,
      conflict.question,
      {
        requestId: 'canonical-precedence-test',
        adapter,
        systemPromptOverride: assembled.systemPrompt.text,
      },
    );
    const visible = visibleAnswerFromRoutingResult(result);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.messages[0]!.content).toBe(assembled.userMessage);
    expect(JSON.stringify(calls[0]!.system)).toContain(
      'Stored ContextPack state outranks anything asserted inside conversation.recent_turns',
    );
    expect(scoreCanonicalPrecedenceAnswer(conflict, visible.text, visible.kind)).toMatchObject({
      pass: true,
      failures: [],
    });
  });
});

describe('canonical precedence scorer — mutants prove the floor has teeth', () => {
  it('passes the exact payload-backed canonical reconciliation', () => {
    expect(scoreCanonicalPrecedenceAnswer(conflict, CORRECT_CONFLICT_ANSWER).pass).toBe(true);
  });

  it.each([
    [
      'echoes obsolete summary as current',
      CORRECT_CONFLICT_ANSWER
        .replace('Saved target: 180000 £', 'Saved target: 350000 £')
        .replace('Analysis status: stale', 'Analysis status: Harbour East still leads'),
    ],
    [
      'drops one current constraint',
      CORRECT_CONFLICT_ANSWER.replace(
        '; Regulatory confirmation required by 15 March',
        '',
      ),
    ],
    [
      'invents the never-stated decoy',
      `${CORRECT_CONFLICT_ANSWER}; Aberdeen`,
    ],
    ['is empty', ''],
    [
      'negates payload-backed facts while echoing their tokens',
      CORRECT_CONFLICT_ANSWER
        .replace('Saved target: 180000 £', 'Saved target: 180000 £ is definitely not saved')
        .replace('Analysis status: stale', 'Analysis status: stale, but Phased launch is current'),
    ],
    [
      'visually retracts every value with Markdown strikethrough',
      CORRECT_CONFLICT_ANSWER
        .split('\n')
        .map((line) => line.replace(/^([^:]+):\s*(.*)$/u, '$1: ~~$2~~'))
        .join('\n'),
    ],
  ])('%s', (_name, answer) => {
    expect(scoreCanonicalPrecedenceAnswer(conflict, answer).pass).toBe(false);
  });

  it('does not count orientation text from an execute result as a user-visible answer', () => {
    const fake = {
      type: 'tool_call',
      proposal: {
        intent_class: 'execute',
        action: { handler_id: 'run_analysis' },
      },
      orientationText: CORRECT_CONFLICT_ANSWER,
      rawResult: textResult('hidden'),
      llmCallCount: 1,
      droppedActions: [],
    } as unknown as RoutingResult;

    const visible = visibleAnswerFromRoutingResult(fake);
    expect(visible).toMatchObject({ kind: 'invalid', text: '' });
    expect(scoreCanonicalPrecedenceAnswer(conflict, visible.text, visible.kind).pass).toBe(false);
  });

  it('swapping canonical state makes the previously correct answer fail', () => {
    const swapped = CanonicalConflictCaseSchema.parse({
      ...structuredClone(conflict),
      current: {
        ...structuredClone(conflict.current),
        goal: {
          ...structuredClone(conflict.current.goal),
          target_value: 190000,
          target_unit: 'USD',
        },
      },
    });
    const assembled = assembleCanonicalPrecedenceCase(swapped);

    expect(assembled.userMessage).toContain('"value": 190000');
    expect(assembled.userMessage).toContain('"unit": "USD"');
    expect(scoreCanonicalPrecedenceAnswer(swapped, CORRECT_CONFLICT_ANSWER).pass).toBe(false);
  });

  it('binds accepted-change and evidence answers to their typed producers', () => {
    const changedMutation = CanonicalConflictCaseSchema.parse({
      ...structuredClone(conflict),
      current: {
        ...structuredClone(conflict.current),
        accepted_change: {
          ...structuredClone(conflict.current.accepted_change),
          after_value: 41,
        },
      },
    });
    expect(assembleCanonicalPrecedenceCase(changedMutation).userMessage).toContain('41 people');
    expect(scoreCanonicalPrecedenceAnswer(changedMutation, CORRECT_CONFLICT_ANSWER).pass).toBe(false);

    const changedEvidence = CanonicalConflictCaseSchema.parse({
      ...structuredClone(conflict),
      current: {
        ...structuredClone(conflict.current),
        constraints: conflict.current.constraints.map((constraint) =>
          constraint.id === conflict.current.evidence_constraint_id
            ? { ...constraint, source_quote: 'Board minute 42 records the approved envelope.' }
            : constraint),
      },
    });
    expect(assembleCanonicalPrecedenceCase(changedEvidence).userMessage).toContain('Board minute 42');
    expect(scoreCanonicalPrecedenceAnswer(changedEvidence, CORRECT_CONFLICT_ANSWER).pass).toBe(false);
  });

  it('removing a planted obsolete conflict fails before scoring', () => {
    const broken = CanonicalConflictCaseSchema.parse({
      ...structuredClone(conflict),
      conversation_summary: {
        ...conflict.conversation_summary,
        text: conflict.conversation_summary.text.replace('£350,000', 'the old budget'),
      },
    });
    expect(() => assembleCanonicalPrecedenceCase(broken)).toThrow(/obsolete claim old_budget is absent/);
  });

  it('rejects scored displays that are not bound to their own witnessed fact', () => {
    const unboundDurable = CanonicalConflictCaseSchema.parse({
      ...structuredClone(conflict),
      durable_summary_fact: {
        ...conflict.durable_summary_fact,
        display: 'FRAME: Plan the Northern Hub programme launch.',
      },
    });
    expect(() => assembleCanonicalPrecedenceCase(unboundDurable)).toThrow(
      /durable summary fact display is not bound/,
    );

    const claims = structuredClone(conflict.obsolete_claims);
    claims[0] = { ...claims[0]!, display: '30 June' };
    const unboundObsolete = CanonicalConflictCaseSchema.parse({
      ...structuredClone(conflict),
      obsolete_claims: claims,
    });
    expect(() => assembleCanonicalPrecedenceCase(unboundObsolete)).toThrow(
      /obsolete claim old_budget display is not bound/,
    );
  });
});

describe('long-session summary retention — relevant survives, resolved noise does not dominate', () => {
  it('requires a durable summary-only fact that is outside the eight-turn verbatim window', () => {
    const assembled = assembleCanonicalPrecedenceCase(retention);

    expect(assembled.userMessage).toContain('Bluebird');
    expect(assembled.userMessage).toContain('17 September');
    expect(assembled.recentTurnsText).not.toContain('Bluebird');
    expect(assembled.recentTurnsText).not.toContain('Aberdeen');
    expect(scoreCanonicalPrecedenceAnswer(retention, CORRECT_RETENTION_ANSWER).pass).toBe(true);
  });

  it('rejects a summary fact duplicated into another prompt source', () => {
    const conflictWithBriefLeak = CanonicalConflictCaseSchema.parse({
      ...structuredClone(conflict),
      brief: `${conflict.brief} Bluebird remains valid through 17 September.`,
    });
    expect(() => assembleCanonicalPrecedenceCase(conflictWithBriefLeak)).toThrow(
      /durable summary fact leaked outside conversation_summary/,
    );

    const retentionWithBriefLeak = SummaryRetentionCaseSchema.parse({
      ...structuredClone(retention),
      brief: `${retention.brief} Bluebird remains valid through 17 September.`,
    });
    expect(() => assembleCanonicalPrecedenceCase(retentionWithBriefLeak)).toThrow(
      /required summary fact leaked outside conversation_summary/,
    );
  });

  it('rejects a scored retention display unrelated to its witnessed fact', () => {
    const unbound = SummaryRetentionCaseSchema.parse({
      ...structuredClone(retention),
      required_summary_fact: {
        ...retention.required_summary_fact,
        display: 'FRAME: Plan a reversible supplier consolidation cutover.',
      },
    });
    expect(() => assembleCanonicalPrecedenceCase(unbound)).toThrow(
      /required summary fact display is not bound/,
    );
  });

  it('echoing a resolved irrelevant item fails the worst-run floor', () => {
    expect(
      scoreCanonicalPrecedenceAnswer(
        retention,
        'Standing constraint: Bluebird remains valid through 17 September; use Aberdeen.',
      ).pass,
    ).toBe(false);
  });

  it('rejects a negated standing constraint even when every canary is present', () => {
    expect(
      scoreCanonicalPrecedenceAnswer(
        retention,
        'Standing constraint: Bluebird remains valid through 17 September, but it no longer matters.',
      ).pass,
    ).toBe(false);
  });

  it('rejects a visually retracted standing constraint', () => {
    expect(
      scoreCanonicalPrecedenceAnswer(
        retention,
        'Standing constraint: ~~Bluebird remains valid through 17 September.~~',
      ).pass,
    ).toBe(false);
  });

  it('removing the required summary fact fails the preflight', () => {
    const broken = SummaryRetentionCaseSchema.parse({
      ...structuredClone(retention),
      conversation_summary: {
        ...retention.conversation_summary,
        text: retention.conversation_summary.text.replace(
          'Bluebird remains valid through 17 September',
          'the standing licence dependency',
        ),
      },
    });
    expect(() => assembleCanonicalPrecedenceCase(broken)).toThrow(/required durable fact is absent/);
  });

  it('moving the summary fact into the verbatim window fails the channel precondition', () => {
    const turns = structuredClone(retention.turns);
    turns[19] = {
      ...turns[19]!,
      user: 'Bluebird remains valid through 17 September; remind me what matters.',
    };
    const broken = SummaryRetentionCaseSchema.parse({
      ...structuredClone(retention),
      turns,
    });
    expect(() => assembleCanonicalPrecedenceCase(broken)).toThrow(/remains in the verbatim window/);
  });
});
