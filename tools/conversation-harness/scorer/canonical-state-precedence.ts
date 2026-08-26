/**
 * CORE POC — canonical-state precedence and long-session continuity evaluator.
 *
 * This is an evidence boundary, not another memory or state authority. It
 * assembles the exact production ContextPack and routing user message, then
 * scores only exact canaries deliberately carried by existing structured
 * fields or the existing rolling-summary section.
 *
 * Deterministic tests prove transport and scorer discrimination. A separately
 * gated live run proves model obedience at N=3, worst-run: one miss fails the
 * advisory run. Live output is never represented as CI or mounted evidence.
 */

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { z } from 'zod';

import type { ChatWithToolsResult } from '../../../src/adapters/llm/types.js';
import {
  getAdapterWithResolution,
  type ModelResolution,
} from '../../../src/adapters/llm/router.js';
import type { GraphV3Compact } from '../../../src/orchestrator/context/graph-compact.js';
import { makeMessagePayload } from '../../../src/orchestrator-v5/__tests__/fixtures.js';
import {
  assembleContextPackWithSummary,
  type ContextPack,
} from '../../../src/orchestrator-v5/context/context-pack-assembler.js';
import type { CoachingStatePack } from '../../../src/orchestrator-v5/context/canonical-analysis-state.js';
import { projectRecentChanges } from '../../../src/orchestrator-v5/context/recent-changes.js';
import {
  COACHING_CONTEXT_INSTRUCTION,
  GOAL_TARGET_INSTRUCTION,
  READINESS_INSTRUCTION,
  SUMMARY_PRECEDENCE_INSTRUCTION,
  buildUserMessage,
  routeWithToolUse,
  type RouteWithToolUseOptions,
  type RoutingResult,
} from '../../../src/orchestrator-v5/routing/route-with-tool-use.js';
import {
  ensureRoutingPromptSnapshot,
  type RoutingPromptSnapshot,
} from '../../../src/orchestrator-v5/routing/prompt-loader.js';
import type { SessionTurnWithContent } from '../../../src/orchestrator-v5/session/conversation-content.js';
import { makeSessionTurnRow } from '../../../tests/utils/mock-session-store.js';
import { normaliseForDetection, witnessPresent } from './memory-retention.js';

const TurnSchema = z.object({
  n: z.number().int().positive(),
  user: z.string().min(1),
  assistant: z.string().min(1),
}).strict();

const ConversationSummarySchema = z.object({
  text: z.string().min(1),
  current_to_turn_id: z.string().min(1),
  lag_turns: z.number().int().nonnegative(),
  stale: z.boolean(),
}).strict();

const OptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
}).strict();

const WitnessSchema = z.object({
  display: z.string().min(1),
  witness: z.array(z.string().min(1)).min(1),
}).strict();

const BaseCaseFields = {
  schema: z.literal('canonical_precedence_case.v1'),
  id: z.string().min(1),
  scenario_id: z.string().uuid(),
  brief: z.string().min(1),
  turns: z.array(TurnSchema).min(20).max(24),
  prior_turns_total: z.number().int().min(20),
  conversation_summary: ConversationSummarySchema,
  question: z.string().min(1),
};

export const CanonicalConflictCaseSchema = z.object({
  ...BaseCaseFields,
  mode: z.literal('canonical_conflict'),
  current: z.object({
    goal: z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      target_value: z.number().finite(),
      target_unit: z.string().min(1),
    }).strict(),
    options: z.array(OptionSchema).min(2),
    constraints: z.array(z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      source_quote: z.string().min(1),
    }).strict()).min(2),
    accepted_change: z.object({
      target_id: z.string().min(1),
      target_label: z.string().min(1),
      before_value: z.number().finite(),
      after_value: z.number().finite(),
      unit: z.string().min(1),
    }).strict(),
    readiness: z.object({
      status: z.string().min(1),
      kind: z.literal('model_needs_review'),
      description: z.string().min(1),
    }).strict(),
    analysis: z.object({ freshness: z.literal('stale') }).strict(),
    evidence_constraint_id: z.string().min(1),
  }).strict(),
  durable_summary_fact: WitnessSchema,
  obsolete_claims: z.array(WitnessSchema.extend({
    id: z.string().min(1),
    channel: z.enum(['summary_only', 'recent_and_summary']),
  }).strict()).min(2),
  never_stated_controls: z.array(WitnessSchema.extend({ id: z.string().min(1) }).strict()).min(1),
}).strict();

export const SummaryRetentionCaseSchema = z.object({
  ...BaseCaseFields,
  mode: z.literal('summary_retention'),
  model: z.object({
    goal: OptionSchema,
    options: z.array(OptionSchema).min(2),
  }).strict(),
  required_summary_fact: WitnessSchema,
  resolved_irrelevant_fact: WitnessSchema,
}).strict();

export const CanonicalPrecedenceCaseSchema = z.discriminatedUnion('mode', [
  CanonicalConflictCaseSchema,
  SummaryRetentionCaseSchema,
]);

export type CanonicalConflictCase = z.infer<typeof CanonicalConflictCaseSchema>;
export type SummaryRetentionCase = z.infer<typeof SummaryRetentionCaseSchema>;
export type CanonicalPrecedenceCase = z.infer<typeof CanonicalPrecedenceCaseSchema>;

export interface CanonicalPrecedenceAssembly {
  readonly kase: CanonicalPrecedenceCase;
  readonly contextPack: ContextPack;
  readonly userMessage: string;
  readonly recentTurnsText: string;
  readonly systemPrompt: CanonicalRoutingPromptEvidence;
}

export interface CanonicalRoutingPromptEvidence {
  readonly text: string;
  readonly version: string;
  readonly sent_hash: string;
  readonly full_sha256: string;
  readonly source: 'repo_canonical_export';
}

export interface CanonicalPrecedenceScore {
  readonly case_id: string;
  readonly pass: boolean;
  readonly failures: readonly string[];
  readonly visible_answer: string;
  readonly answer_kind: string;
}

export interface VisibleRoutingAnswer {
  readonly kind: 'text_only' | 'coach' | 'converse' | 'invalid';
  readonly text: string;
  readonly failure?: string;
}

export interface LiveCaseObservation {
  readonly case_id: string;
  readonly run: number;
  readonly score: CanonicalPrecedenceScore;
  /** Exact application-level adapter invocations observed for this route. */
  readonly adapter_call_count: number;
  /** Runtime's logical initial/retry/repair count (cache fallback is not counted here). */
  readonly routing_llm_call_count: number;
  readonly resolved_model: string;
  readonly provider: string | null;
  readonly resolution_source: string;
  readonly actual_model: string;
  readonly usage: Readonly<Record<string, number | undefined>>;
  readonly latency_ms: number;
  readonly stop_reason: string;
}

type LiveToolUseAdapter = NonNullable<RouteWithToolUseOptions['adapter']>;

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
}

export function loadCanonicalPrecedenceCase(name: string): CanonicalPrecedenceCase {
  const raw = readFileSync(fixturePath(name), 'utf8');
  return CanonicalPrecedenceCaseSchema.parse(JSON.parse(raw));
}

export function canonicalCaseFixtureHash(name: string): string {
  return createHash('sha256').update(readFileSync(fixturePath(name))).digest('hex');
}

/**
 * Load the repo-canonical PMS export and verify its manifest identity before it
 * may serve as deterministic evidence. The live runner separately requires the
 * actual loaded snapshot to match this identity.
 */
export function loadCanonicalRoutingPromptEvidence(): CanonicalRoutingPromptEvidence {
  const promptPath = fileURLToPath(
    new URL('../../../Prompts/canonical/routing.txt', import.meta.url),
  );
  const manifestPath = fileURLToPath(
    new URL('../../../Prompts/canonical/manifest.json', import.meta.url),
  );
  const text = readFileSync(promptPath, 'utf8');
  const fullSha = createHash('sha256').update(text).digest('hex');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    pms_prompts?: Array<Record<string, unknown>>;
  };
  const routing = manifest.pms_prompts?.find((row) => row.key === 'routing');
  if (!routing) throw new Error('canonical routing prompt is absent from Prompts/canonical/manifest.json');
  if (routing.sha256 !== fullSha) {
    throw new Error(`canonical routing prompt hash mismatch: manifest=${String(routing.sha256)} file=${fullSha}`);
  }
  const sentHash = String(routing.cee_content_hash_16 ?? '');
  if (sentHash.length !== 16 || fullSha.slice(0, 16) !== sentHash) {
    throw new Error(`canonical routing sent hash is invalid: ${sentHash}`);
  }
  return {
    text,
    version: String(routing.served_version ?? ''),
    sent_hash: sentHash,
    full_sha256: fullSha,
    source: 'repo_canonical_export',
  };
}

function rowUuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function toPriorTurns(kase: CanonicalPrecedenceCase): SessionTurnWithContent[] {
  return [...kase.turns]
    .reverse()
    .map((turn) => makeSessionTurnRow({
      id: rowUuid(turn.n),
      scenario_id: kase.scenario_id,
      turn_id: `turn-${turn.n}`,
      turn_class: 'direct_answer',
      handler_id: null,
      request_hash: `sha256:canonical-precedence-${turn.n}`,
      created_at: new Date(Date.UTC(2026, 7, 25, 8, turn.n)).toISOString(),
      user_message: turn.user,
      assistant_message: turn.assistant,
    }));
}

function conflictGraph(kase: CanonicalConflictCase): GraphV3Compact {
  const change = kase.current.accepted_change;
  const nodes: GraphV3Compact['nodes'] = [
    { id: kase.current.goal.id, kind: 'goal', label: kase.current.goal.label },
    ...kase.current.options.map((option) => ({
      id: option.id,
      kind: 'option',
      label: option.label,
    })),
    {
      id: change.target_id,
      kind: 'factor',
      label: change.target_label,
      value: change.after_value,
      raw_value: change.after_value,
      unit: change.unit,
    },
  ];
  return { nodes, edges: [], _node_count: nodes.length, _edge_count: 0 };
}

function summaryGraph(kase: SummaryRetentionCase): GraphV3Compact {
  const nodes: GraphV3Compact['nodes'] = [
    { id: kase.model.goal.id, kind: 'goal', label: kase.model.goal.label },
    ...kase.model.options.map((option) => ({
      id: option.id,
      kind: 'option',
      label: option.label,
    })),
  ];
  return { nodes, edges: [], _node_count: nodes.length, _edge_count: 0 };
}

function acceptedChangeFact(kase: CanonicalConflictCase): HandlerFact {
  const change = kase.current.accepted_change;
  return {
    fact_type: 'set_factor_value',
    fact_version: 1,
    noop: false,
    result: {
      target_id: change.target_id,
      status: 'applied',
      before: {
        value: change.before_value,
        raw_value: change.before_value,
        label: change.target_label,
        unit: change.unit,
      },
      after: {
        value: change.after_value,
        raw_value: change.after_value,
        label: change.target_label,
        unit: change.unit,
      },
    },
  };
}

function goalTargetDisplay(kase: CanonicalConflictCase): string {
  return `${String(kase.current.goal.target_value)} ${kase.current.goal.target_unit}`;
}

function acceptedChangeDisplay(kase: CanonicalConflictCase): string {
  const projected = projectRecentChanges([acceptedChangeFact(kase)])[0];
  if (projected === undefined) {
    throw new Error(`${kase.id}: accepted change did not produce a recent_changes value`);
  }
  return projected.summary;
}

function evidenceDisplay(kase: CanonicalConflictCase): string {
  const matches = kase.current.constraints.filter(
    (constraint) => constraint.id === kase.current.evidence_constraint_id,
  );
  if (matches.length !== 1) {
    throw new Error(`${kase.id}: evidence_constraint_id must resolve exactly one typed constraint`);
  }
  return matches[0]!.source_quote;
}

function staleCoachingState(kase: CanonicalConflictCase): CoachingStatePack {
  return {
    analysis_present: true,
    freshness: kase.current.analysis.freshness,
    readiness_status: 'needs_user_input',
    rerun_required: true,
    usable_for_prose: true,
    usable_for_chips: false,
    blocked: false,
    actionable_blocker_count: 1,
  };
}

export function assembleCanonicalPrecedenceCase(
  kase: CanonicalPrecedenceCase,
): CanonicalPrecedenceAssembly {
  assertCanonicalPreconditions(kase);
  const priorTurns = toPriorTurns(kase);
  const common = {
    payload: makeMessagePayload({
      scenario_id: kase.scenario_id,
      turn_id: randomUUID(),
      message: kase.question,
      stage: 'analyse',
      turn_class: 'review',
    }),
    brief: kase.brief,
    priorTurns,
    priorTurnsTotal: kase.prior_turns_total,
    conversationSummary: kase.conversation_summary,
    // Match loadConversationSummaryForInjection: the summary covers the
    // fetched hot window outside the eight verbatim turns, not every durable
    // turn that exists for the scenario.
    summarisedTurns: Math.max(0, priorTurns.length - 8),
    pendingConfirmation: false,
  } as const;

  const contextPack = kase.mode === 'canonical_conflict'
    ? assembleContextPackWithSummary({
        ...common,
        compactedGraph: conflictGraph(kase),
        compactedConstraints: kase.current.constraints,
        goalTarget: {
          status: 'set',
          value: kase.current.goal.target_value,
          unit: kase.current.goal.target_unit,
        },
        priorFacts: [acceptedChangeFact(kase)],
        priorFactsReadOk: true,
        readiness: {
          status: kase.current.readiness.status,
          open_items: [{
            kind: kase.current.readiness.kind,
            description: kase.current.readiness.description,
          }],
        },
        coachingContext: staleCoachingState(kase),
      }).contextPack
    : assembleContextPackWithSummary({
        ...common,
        compactedGraph: summaryGraph(kase),
        compactedConstraints: null,
        goalTarget: { status: 'unset' },
        priorFacts: [],
        priorFactsReadOk: true,
      }).contextPack;

  const userMessage = buildUserMessage(contextPack, kase.question);
  const recentTurnsText = JSON.stringify(contextPack.conversation.recent_turns);
  const systemPrompt = loadCanonicalRoutingPromptEvidence();
  assertAssembledPreconditions({ kase, contextPack, userMessage, recentTurnsText, systemPrompt });
  return { kase, contextPack, userMessage, recentTurnsText, systemPrompt };
}

function exactPhrasePresent(haystack: string, phrase: string): boolean {
  return normaliseForDetection(haystack).includes(normaliseForDetection(phrase).trim());
}

function assertSequentialTurns(kase: CanonicalPrecedenceCase): void {
  kase.turns.forEach((turn, index) => {
    if (turn.n !== index + 1) {
      throw new Error(`${kase.id}: turns must be chronological and contiguous; index ${index} has n=${turn.n}`);
    }
  });
}

function assertDisplayCarriesWitness(
  caseId: string,
  label: string,
  value: { readonly display: string; readonly witness: readonly string[] },
): void {
  if (!witnessPresent(value.display, value.witness)) {
    throw new Error(`${caseId}: ${label} display is not bound to its witness`);
  }
}

/** Load-time anti-vacuity checks over the authored journey. */
export function assertCanonicalPreconditions(kase: CanonicalPrecedenceCase): void {
  assertSequentialTurns(kase);
  if (kase.turns.length <= 8) throw new Error(`${kase.id}: journey does not exceed the verbatim window`);
  if (kase.prior_turns_total < kase.turns.length) {
    throw new Error(`${kase.id}: total turn count is smaller than the fetched hot window`);
  }
  const fixtureText = JSON.stringify(kase);
  if (exactPhrasePresent(kase.question, 'Aberdeen')) {
    throw new Error(`${kase.id}: the query contains the negative-control canary`);
  }
  if (kase.mode === 'canonical_conflict') {
    assertDisplayCarriesWitness(kase.id, 'durable summary fact', kase.durable_summary_fact);
    const recentFixtureText = JSON.stringify(kase.turns.slice(-8));
    let recentConflictCount = 0;
    let summaryOnlyConflictCount = 0;
    for (const claim of kase.obsolete_claims) {
      assertDisplayCarriesWitness(kase.id, `obsolete claim ${claim.id}`, claim);
      if (!witnessPresent(kase.conversation_summary.text, claim.witness)) {
        throw new Error(`${kase.id}: obsolete claim ${claim.id} is absent from the conflicting summary`);
      }
      const inRecent = witnessPresent(recentFixtureText, claim.witness);
      if (claim.channel === 'recent_and_summary') {
        if (!inRecent) throw new Error(`${kase.id}: recent conflict ${claim.id} is absent from the hot window`);
        recentConflictCount += 1;
      } else {
        if (inRecent) throw new Error(`${kase.id}: summary-only conflict ${claim.id} leaked into the hot window`);
        summaryOnlyConflictCount += 1;
      }
    }
    if (recentConflictCount === 0 || summaryOnlyConflictCount === 0) {
      throw new Error(`${kase.id}: fixture must discriminate recent-window and summary-only conflicts`);
    }
    if (new Set(kase.obsolete_claims.map((claim) => claim.display)).size !== kase.obsolete_claims.length) {
      throw new Error(`${kase.id}: obsolete claim displays must be unique`);
    }
    if (!witnessPresent(kase.conversation_summary.text, kase.durable_summary_fact.witness)) {
      throw new Error(`${kase.id}: durable summary-only fact is absent from the summary`);
    }
    if (!kase.conversation_summary.text.includes(kase.durable_summary_fact.display)) {
      throw new Error(`${kase.id}: scored durable fact is not an exact producer-payload value`);
    }
    if (witnessPresent(recentFixtureText, kase.durable_summary_fact.witness)) {
      throw new Error(`${kase.id}: durable summary-only fact leaked into the hot window`);
    }
    for (const control of kase.never_stated_controls) {
      assertDisplayCarriesWitness(kase.id, `never-stated control ${control.id}`, control);
      const withoutControlDeclaration = fixtureText.replace(JSON.stringify(kase.never_stated_controls), '');
      if (witnessPresent(withoutControlDeclaration, control.witness)) {
        throw new Error(`${kase.id}: never-stated control ${control.id} appears in journey input`);
      }
    }
    if (witnessPresent(kase.conversation_summary.text, [String(kase.current.goal.target_value)])) {
      throw new Error(`${kase.id}: current goal target leaked into the conflicting summary`);
    }
    for (const claim of kase.obsolete_claims) {
      const source = claim.channel === 'recent_and_summary'
        ? `${kase.conversation_summary.text}\n${recentFixtureText}`
        : kase.conversation_summary.text;
      if (!source.includes(claim.display)) {
        throw new Error(`${kase.id}: scored obsolete claim ${claim.id} is not an exact producer-payload value`);
      }
    }
    if (kase.current.accepted_change.before_value === kase.current.accepted_change.after_value) {
      throw new Error(`${kase.id}: accepted-change fixture is a no-op`);
    }
    acceptedChangeDisplay(kase);
    evidenceDisplay(kase);
  } else {
    assertDisplayCarriesWitness(kase.id, 'required summary fact', kase.required_summary_fact);
    assertDisplayCarriesWitness(kase.id, 'resolved irrelevant fact', kase.resolved_irrelevant_fact);
    if (!witnessPresent(kase.conversation_summary.text, kase.required_summary_fact.witness)) {
      throw new Error(`${kase.id}: required durable fact is absent from summary`);
    }
    if (!kase.conversation_summary.text.includes(kase.required_summary_fact.display)) {
      throw new Error(`${kase.id}: scored required fact is not an exact producer-payload value`);
    }
    if (!witnessPresent(kase.conversation_summary.text, kase.resolved_irrelevant_fact.witness)) {
      throw new Error(`${kase.id}: resolved negative control is absent from summary`);
    }
  }
}

function assertAssembledPreconditions(assembly: CanonicalPrecedenceAssembly): void {
  const { kase, contextPack, userMessage, recentTurnsText, systemPrompt } = assembly;
  const { conversation_summary: _conversationSummary, ...contextPackWithoutSummary } = contextPack;
  const userMessageWithoutSummary = buildUserMessage(contextPackWithoutSummary, kase.question);
  if (contextPack.conversation.window?.shown !== 8) {
    throw new Error(`${kase.id}: assembled prompt does not use the eight-turn verbatim window`);
  }
  if ((contextPack.conversation.window?.summarised ?? 0) <= 0) {
    throw new Error(`${kase.id}: summary covers no turns; long-memory assertion would be vacuous`);
  }
  if (!userMessage.includes(SUMMARY_PRECEDENCE_INSTRUCTION)) {
    throw new Error(`${kase.id}: code-owned summary precedence instruction did not reach the model`);
  }
  if (!systemPrompt.text.includes('Stored ContextPack state outranks anything asserted inside conversation.recent_turns')) {
    throw new Error(`${kase.id}: canonical served prompt lacks the global precedence rule`);
  }

  if (kase.mode === 'canonical_conflict') {
    if (!userMessage.includes(GOAL_TARGET_INSTRUCTION)
      || !userMessage.includes(READINESS_INSTRUCTION)
      || !userMessage.includes(COACHING_CONTEXT_INSTRUCTION)) {
      throw new Error(`${kase.id}: one or more specialised canonical-state instructions are dark`);
    }
    for (const claim of kase.obsolete_claims) {
      if (!witnessPresent(userMessage, claim.witness)) {
        throw new Error(`${kase.id}: conflicting claim ${claim.id} did not reach the model`);
      }
      const inRecent = witnessPresent(recentTurnsText, claim.witness);
      if (claim.channel === 'recent_and_summary' && !inRecent) {
        throw new Error(`${kase.id}: recent conflict ${claim.id} did not reach recent_turns`);
      }
      if (claim.channel === 'summary_only' && inRecent) {
        throw new Error(`${kase.id}: summary-only conflict ${claim.id} reached recent_turns`);
      }
    }
    if (!witnessPresent(userMessage, kase.durable_summary_fact.witness)
      || witnessPresent(recentTurnsText, kase.durable_summary_fact.witness)) {
      throw new Error(`${kase.id}: durable fact is not exclusively summary-carried`);
    }
    if (witnessPresent(userMessageWithoutSummary, kase.durable_summary_fact.witness)) {
      throw new Error(`${kase.id}: durable summary fact leaked outside conversation_summary`);
    }
    if (contextPack.goal_target?.status !== 'set'
      || contextPack.goal_target.value !== kase.current.goal.target_value
      || contextPack.goal_target.unit !== kase.current.goal.target_unit
      || !userMessage.includes(acceptedChangeDisplay(kase))
      || !userMessage.includes(kase.current.readiness.description)
      || !userMessage.includes(evidenceDisplay(kase))) {
      throw new Error(`${kase.id}: current typed state did not reach the model`);
    }
    for (const canary of [goalTargetDisplay(kase), ...kase.obsolete_claims.map((x) => x.display)]) {
      if (exactPhrasePresent(systemPrompt.text, canary)) {
        throw new Error(`${kase.id}: case canary appears in the system prompt: ${canary}`);
      }
    }
  } else {
    if (!witnessPresent(userMessage, kase.required_summary_fact.witness)) {
      throw new Error(`${kase.id}: required summary fact did not reach the model`);
    }
    if (witnessPresent(recentTurnsText, kase.required_summary_fact.witness)) {
      throw new Error(`${kase.id}: required summary fact remains in the verbatim window`);
    }
    if (witnessPresent(userMessageWithoutSummary, kase.required_summary_fact.witness)) {
      throw new Error(`${kase.id}: required summary fact leaked outside conversation_summary`);
    }
    if (witnessPresent(recentTurnsText, kase.resolved_irrelevant_fact.witness)) {
      throw new Error(`${kase.id}: resolved control remains in the verbatim window`);
    }
    for (const canary of [kase.required_summary_fact.display, kase.resolved_irrelevant_fact.display]) {
      if (exactPhrasePresent(systemPrompt.text, canary)) {
        throw new Error(`${kase.id}: case canary appears in the system prompt: ${canary}`);
      }
    }
  }
}

function parseExactLabeledLines(answer: string, labels: readonly string[]): {
  readonly values: ReadonlyMap<string, string>;
  readonly failures: readonly string[];
} {
  const lines = answer.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const failures: string[] = [];
  if (lines.length !== labels.length) {
    failures.push(`expected exactly ${labels.length} non-empty lines, got ${lines.length}`);
  }
  const values = new Map<string, string>();
  for (const line of lines) {
    const match = /^([^:]+):\s*(.+)$/u.exec(line);
    if (!match) {
      failures.push(`unlabelled line: ${line}`);
      continue;
    }
    const label = match[1]!.trim().toLowerCase();
    if (!labels.includes(label)) {
      failures.push(`unexpected label: ${match[1]}`);
      continue;
    }
    if (values.has(label)) failures.push(`duplicate label: ${match[1]}`);
    values.set(label, match[2]!.trim());
  }
  for (const label of labels) {
    if (!values.has(label)) failures.push(`missing label: ${label}`);
  }
  return { values, failures };
}

function requireExactValue(
  failures: string[],
  value: string | undefined,
  expected: string,
  field: string,
): void {
  if (!value || value.normalize('NFC').trim() !== expected.normalize('NFC').trim()) {
    failures.push(`${field} is not exactly the payload-backed value: ${expected}`);
  }
}

function scoreConflictAnswer(
  kase: CanonicalConflictCase,
  answer: string,
  answerKind: string,
): CanonicalPrecedenceScore {
  const labels = [
    'saved target',
    'saved constraints',
    'accepted change',
    'unresolved',
    'evidence basis',
    'analysis status',
    'standing constraint',
    'not current',
  ] as const;
  const parsed = parseExactLabeledLines(answer, labels);
  const failures = [...parsed.failures];

  requireExactValue(failures, parsed.values.get('saved target'), goalTargetDisplay(kase), 'saved target');
  requireExactValue(
    failures,
    parsed.values.get('saved constraints'),
    kase.current.constraints.map((constraint) => constraint.label).join('; '),
    'saved constraints',
  );
  requireExactValue(
    failures,
    parsed.values.get('accepted change'),
    acceptedChangeDisplay(kase),
    'accepted change',
  );
  requireExactValue(
    failures,
    parsed.values.get('unresolved'),
    kase.current.readiness.description,
    'unresolved',
  );
  requireExactValue(
    failures,
    parsed.values.get('evidence basis'),
    evidenceDisplay(kase),
    'evidence basis',
  );
  requireExactValue(failures, parsed.values.get('analysis status'), 'stale', 'analysis status');
  requireExactValue(
    failures,
    parsed.values.get('standing constraint'),
    kase.durable_summary_fact.display,
    'standing constraint',
  );
  requireExactValue(
    failures,
    parsed.values.get('not current'),
    kase.obsolete_claims.map((claim) => claim.display).join('; '),
    'not current',
  );
  for (const control of kase.never_stated_controls) {
    if (witnessPresent(answer, control.witness)) {
      failures.push(`never-stated control was invented: ${control.id}`);
    }
  }
  if (!['text_only', 'coach', 'converse'].includes(answerKind)) {
    failures.push(`answer came through a non-visible/non-conversational result: ${answerKind}`);
  }
  return {
    case_id: kase.id,
    pass: failures.length === 0,
    failures,
    visible_answer: answer,
    answer_kind: answerKind,
  };
}

function scoreSummaryAnswer(
  kase: SummaryRetentionCase,
  answer: string,
  answerKind: string,
): CanonicalPrecedenceScore {
  const parsed = parseExactLabeledLines(answer, ['standing constraint']);
  const failures = [...parsed.failures];
  const line = parsed.values.get('standing constraint') ?? '';
  requireExactValue(
    failures,
    line,
    kase.required_summary_fact.display,
    'standing constraint',
  );
  if (witnessPresent(answer, kase.resolved_irrelevant_fact.witness)) {
    failures.push(`resolved irrelevant fact dominated the answer: ${kase.resolved_irrelevant_fact.display}`);
  }
  if (!['text_only', 'coach', 'converse'].includes(answerKind)) {
    failures.push(`answer came through a non-visible/non-conversational result: ${answerKind}`);
  }
  return {
    case_id: kase.id,
    pass: failures.length === 0,
    failures,
    visible_answer: answer,
    answer_kind: answerKind,
  };
}

export function scoreCanonicalPrecedenceAnswer(
  kase: CanonicalPrecedenceCase,
  answer: string,
  answerKind = 'text_only',
): CanonicalPrecedenceScore {
  if (answer.trim().length === 0) {
    return {
      case_id: kase.id,
      pass: false,
      failures: ['visible answer is empty'],
      visible_answer: answer,
      answer_kind: answerKind,
    };
  }
  return kase.mode === 'canonical_conflict'
    ? scoreConflictAnswer(kase, answer, answerKind)
    : scoreSummaryAnswer(kase, answer, answerKind);
}

/** Only user-visible answer channels count. Orientation text never does. */
export function visibleAnswerFromRoutingResult(result: RoutingResult): VisibleRoutingAnswer {
  if (result.type === 'text_only') {
    return { kind: 'text_only', text: result.text.trim() };
  }
  const proposal = result.proposal;
  if (proposal.intent_class === 'coach' || proposal.intent_class === 'converse') {
    return {
      kind: proposal.intent_class,
      text: proposal.answer_text?.trim() ?? '',
      ...(proposal.answer_text?.trim() ? {} : { failure: 'coach/converse proposal has no visible answer_text' }),
    };
  }
  return {
    kind: 'invalid',
    text: '',
    failure: `state query returned ${proposal.intent_class}; execute/clarify is not a valid visible answer`,
  };
}

function usageProjection(result: ChatWithToolsResult): Readonly<Record<string, number | undefined>> {
  return {
    input_tokens: result.usage?.input_tokens,
    output_tokens: result.usage?.output_tokens,
    cache_read_input_tokens: result.usage?.cache_read_input_tokens,
    cache_creation_input_tokens: result.usage?.cache_creation_input_tokens,
  };
}

export async function assertLivePromptIdentity(
  expected: CanonicalRoutingPromptEvidence,
): Promise<RoutingPromptSnapshot> {
  const snapshot = await ensureRoutingPromptSnapshot();
  if (snapshot.source !== 'store') {
    throw new Error(`live evaluator requires the PMS/store routing prompt; got source=${snapshot.source}`);
  }
  if (snapshot.sent_hash !== expected.sent_hash || snapshot.version !== expected.version) {
    throw new Error(
      `live routing prompt identity mismatch: expected v${expected.version}/${expected.sent_hash}, `
      + `got v${snapshot.version}/${snapshot.sent_hash}`,
    );
  }
  return snapshot;
}

export async function runLiveCanonicalPrecedenceCase(
  assembly: CanonicalPrecedenceAssembly,
  run: number,
  resolved: { adapter: LiveToolUseAdapter; resolution: ModelResolution },
): Promise<LiveCaseObservation> {
  let adapterCallCount = 0;
  const countingAdapter: LiveToolUseAdapter = {
    chatWithTools: async (args, options) => {
      adapterCallCount += 1;
      if (adapterCallCount > 4) {
        throw new Error('routing evaluator exceeded its four-adapter-call per-case ceiling');
      }
      return resolved.adapter.chatWithTools(args, options);
    },
  };
  const result = await routeWithToolUse(
    assembly.contextPack,
    assembly.kase.question,
    {
      requestId: randomUUID(),
      sessionId: assembly.kase.scenario_id,
      adapter: countingAdapter,
    },
  );
  const visible = visibleAnswerFromRoutingResult(result);
  const score = scoreCanonicalPrecedenceAnswer(assembly.kase, visible.text, visible.kind);
  const raw = result.rawResult;
  return {
    case_id: assembly.kase.id,
    run,
    score: visible.failure
      ? { ...score, pass: false, failures: [...score.failures, visible.failure] }
      : score,
    adapter_call_count: adapterCallCount,
    routing_llm_call_count: result.llmCallCount,
    resolved_model: resolved.resolution.resolved_model,
    provider: resolved.resolution.provider ?? null,
    resolution_source: resolved.resolution.resolution_source,
    actual_model: raw.model,
    usage: usageProjection(raw),
    latency_ms: raw.latencyMs,
    stop_reason: raw.stop_reason,
  };
}

export function resolveLiveOrchestrator(): {
  adapter: LiveToolUseAdapter;
  resolution: ModelResolution;
} {
  const { adapter, resolution } = getAdapterWithResolution('orchestrator');
  if (resolution.provider !== 'anthropic' && resolution.provider !== 'openai') {
    throw new Error(
      `live evaluator cannot prove a provider-attempt cap for ${resolution.provider ?? 'unknown'}`,
    );
  }
  if (!adapter.chatWithTools) {
    throw new Error(
      `resolved orchestrator adapter does not implement chatWithTools: ${resolution.resolved_model}`,
    );
  }
  const chatWithTools = adapter.chatWithTools.bind(adapter);
  return {
    adapter: {
      chatWithTools: (args, options) => {
        if (options.timeoutMs === undefined) {
          throw new Error('routing evaluator received a tool call without the production timeout');
        }
        return chatWithTools(args, {
          requestId: options.requestId,
          timeoutMs: options.timeoutMs,
          signal: options.signal,
        });
      },
    },
    resolution,
  };
}
