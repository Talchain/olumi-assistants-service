/**
 * W5 (ALPHA-PLAN, "Not yet proven"; Paul 26 Oct; boundary as the PL confirmed it, 27 Oct): no RETIRED behaviour governs an alpha
 * operation. The claim is NO-EXEC of retired interpretation, readiness, refusal, repair and analysis branches, and of the
 * prohibited top-level effects (a PLoT or ISL call; a legacy turn engine deciding the outcome). It is NOT no-load: the served
 * process loads the legacy routes at boot, and shared approval, storage and helper code may run (W5 permits it).
 *
 * The run: the REAL core route (`POST /agent/v1/core-turn`) and its real request -> write/read dispatch, over the harness of
 * `core-turn.route.test.ts` (a scripted provider, 0 live calls; the graph read, register and versions routes as doubles in the
 * served PROGRAM shapes, their bodies out of scope). It takes a first draft, the approval of the card that draft held, a card
 * proposed and approved, an edit (a canvas figure), a Run press (on a current Run and on a stale one), a replay (the same press
 * resent), a recovery (a save whose acknowledgement was lost after it committed), negatives (a press on a card no longer
 * waiting; a press whose words are not the card's own; a reply lost after its save) and a Stop.
 *
 * THE TRAPS, each named below with its file and why it is retired, on two instruments at every step:
 *  1. an EXPORT TRAP on each retired entry point (it records the call and its caller, then runs the real code);
 *  2. V8's own per-function EXECUTION COUNT for the same function (`Profiler.takePreciseCoverage`). An export trap is blind to a
 *     caller that holds the module's original binding, which an import cycle gives (measured here: graph-hash.ts ->
 *     analysis-ready-helper.ts -> risk-occurrence.ts -> graph-hash.ts runs the readiness projection with its trap at 0); V8's
 *     counts do not depend on bindings. V8's BLOCK counts also trap the legacy refusal and repair branches inside shared code
 *     the path does enter (BRANCHES).
 * POSITIVE CONTROL, same run, same code: the modules the path really uses (the core contract, the program save) must show calls on
 * both instruments at every step; and a direct call into each retired entry shows on both (each trap can go RED).
 *
 * ⚠ ON THIS TREE THE CLAIM IS NOT YET TRUE: one named OPEN edge (OPEN below, with its file:line) executes the legacy readiness
 * projection on every save. It must still be observed (its row fails once the edge is cut, so the exception leaves with its fix);
 * nothing else retired may appear, and with the edge cut every row asserts 0. CEE #3851 cuts it: on staging f49f50e1 with #3851's
 * head ee5a947d merged (27 Oct), less OPEN A and its BRANCHES entry, every row passes with 0 retired calls, functions or branches.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeGraphIdentityHash } from '../../orchestrator-v5/context/graph-identity.js';
import { computeAnalysisAffectingGraphHash, computeAnalysisAffectingGraphHashSha256 } from '../../orchestrator-v5/context/graph-hash.js';
import { registrationTurnId } from '../../orchestrator-v5/graph-registration/registration-identity.js';
import { toOutboundGraph } from '../../orchestrator-v5/goal-target/outbound-graph.js';
import { streamWhenAsked } from '../../orchestrator-v5/agent-lane/__tests__/stream-when-asked.js';
import { bakery, BRIEF as BAKERY_BRIEF } from '../../orchestrator-v5/model-program-turn/__tests__/bakery.fixture.js';
import { programRevisionOf } from '../../orchestrator-v5/model-program-turn/program-card.js';
import { programReadinessOf } from '../../orchestrator-v5/model-program-turn/program-readiness.js';
import { seedOf } from '../../orchestrator-v5/model-program-turn/evaluate.js';
import { postimageOf, withNewRun } from '../../orchestrator-v5/model-program-turn/program-save.js';
import { MODEL_PROGRAM, reopenProgram, savedProgramOf } from '../../orchestrator-v5/model-program-turn/program-store.js';

type Json = Record<string, any>;
const SRC = resolve(__dirname, '../..');
const rel = (abs: string): string => relative(SRC, abs);

type Kind = 'engine' | 'plot_isl' | 'readiness' | 'interpretation' | 'refusal' | 'analysis';
/**
 * ⭐ THE RETIRED ENTRY POINTS (files under `src/`). Each is off the alpha by the inventory's verdict (`ALPHA-CODE-INVENTORY.md`
 * §1 families F1–F6, §2 rows) or by #3851's wall, re-read against this tree; the shared code around them is not trapped.
 */
const RETIRED: readonly { readonly file: string; readonly fns: readonly string[]; readonly kind: Kind; readonly why: string }[] = [
  // A legacy turn engine deciding the outcome (and no in-process dispatch to /agent/v1/turn or /orchestrate/v2/turn: see the rows).
  { file: 'orchestrator-v5/agent-lane/runtime/agent-loop.ts', fns: ['runAgentTurn'], kind: 'engine', why: 'F2: the legacy agent loop (the core route runs the SDK turn)' },
  { file: 'orchestrator-v5/agent-lane/runtime/agent-capabilities.ts', fns: ['createAgentCapabilities'], kind: 'engine', why: 'F2: the legacy capability set (build, edits, run_analysis via v2)' },
  { file: 'orchestrator-v5/commit.ts', fns: ['commitDirectAnswer'], kind: 'engine', why: 'F1: the v2 commit' },
  { file: 'orchestrator-v5/build-turn-context.ts', fns: ['buildTurnContext'], kind: 'engine', why: 'F1: the v2 turn context' },
  { file: 'orchestrator/route-v2.ts', fns: ['ceeOrchestratorRouteV2'], kind: 'engine', why: 'F1: the /orchestrate/v2/turn pipeline' },
  { file: 'orchestrator-v5/system-events/dispatch.ts', fns: ['dispatchSystemEvent'], kind: 'engine', why: 'F1: the legacy canvas-edit engine (a program edit is applyCanvasFigure)' },
  { file: 'orchestrator-v5/handlers/approve-held-proposal.ts', fns: ['approveHeldProposal', 'runHeldProposalApproval', 'commitHeldProposalInProcess'], kind: 'engine', why: 'F2: the legacy held-approval writer' },
  { file: 'orchestrator-v5/agent-lane/run-operation.ts', fns: ['restoreRunOperation', 'readRecordedRun'], kind: 'engine', why: 'F2: the legacy Run restore' },
  { file: 'orchestrator-v5/agent-lane/core/model-critic.ts', fns: ['modelCritic'], kind: 'engine', why: 'F2: the legacy draft critic call' },
  // PLoT and ISL (and no outbound call but the provider's: see the rows).
  { file: 'orchestrator/plot-client.ts', fns: ['createPLoTClient'], kind: 'plot_isl', why: 'F5: the CEE to PLoT client' },
  { file: 'adapters/isl/client.ts', fns: ['createISLClient'], kind: 'plot_isl', why: 'F5: the ISL client' },
  { file: 'adapters/isl/counterfactual-client.ts', fns: ['createCounterfactualClient', 'makeCounterfactualClient'], kind: 'plot_isl', why: 'F5: the ISL counterfactual client' },
  { file: 'services/validateClient.ts', fns: ['validateGraph'], kind: 'plot_isl', why: 'F5: engine validate (PLoT, over undici, outside the fetch stub)' },
  { file: 'orchestrator-v5/tools/registry.ts', fns: ['getDefaultPlotClient', 'getDefaultRegistry', 'createRegistry', 'resolveHandler'], kind: 'plot_isl', why: 'F5: the legacy tool registry and its PLoT client' },
  { file: 'orchestrator-v5/tools/handlers/run-analysis.ts', fns: ['createRunAnalysisHandler'], kind: 'plot_isl', why: 'F5: the legacy Run (PLoT)' },
  { file: 'orchestrator-v5/handlers/stress-variant-run.ts', fns: ['runStressVariant', 'runVariant'], kind: 'plot_isl', why: 'F5: the stress-test variant Run (PLoT)' },
  { file: 'orchestrator-v5/handlers/what-if-run.ts', fns: ['runWhatIf'], kind: 'plot_isl', why: 'F5: the what-if Run (PLoT)' },
  { file: 'orchestrator-v5/tools/handlers/what-would-flip.ts', fns: ['createWhatWouldFlipHandler'], kind: 'plot_isl', why: 'F5: what would flip (ISL)' },
  // Readiness and the legacy analysis read.
  { file: 'orchestrator/tools/analysis-ready-helper.ts', kind: 'readiness', why: 'F3: the legacy readiness/admission assessor and its option projection (#3851 FORBIDDEN)',
    fns: ['assessCanonicalAnalysisReadiness', 'buildCanonicalAnalysisReadyFromGraph', 'canonicalAnalysisReadyFrom', 'computeStructuralReadiness', 'buildAnalysisRefusalReadiness', 'projectOptionForCanonicalBuilder'] },
  { file: 'routes/scenario-graph-analysis-read.ts', fns: ['readScenarioAnalysis'], kind: 'readiness', why: 'F3: the legacy analysis reader' },
  { file: 'routes/canonical-analysis-view.ts', fns: ['projectCanonicalAnalysisView', 'projectCanonicalAnalysisCells'], kind: 'readiness', why: 'F3: the legacy Run view (#3851 FORBIDDEN)' },
  { file: 'orchestrator-v5/agent-lane/first-analysis.ts', fns: ['claimPermissionsFrom', 'runFirstAnalysisAfterConstruction'], kind: 'readiness', why: 'F3: legacy claim permissions and the first automatic Run' },
  // The legacy Run's analysis inputs.
  { file: 'orchestrator-v5/tools/handlers/run-analysis-participation-guard.ts', fns: ['guardAnalysisParticipation', 'isRetainedExcluded'], kind: 'analysis', why: 'F5: the PLoT Run\'s participation guard' },
  { file: 'orchestrator-v5/goal-target/carried-effects-timing.ts', fns: ['carriedEffectsTiming', 'recordedEffectsTimingOf'], kind: 'analysis', why: 'F2: the timing carried to the legacy automatic Run' },
  // Interpretation: the Living Model and the legacy semantic layers.
  { file: 'orchestrator-v5/path-b/living-model/view.ts', fns: ['livingViewOf'], kind: 'interpretation', why: 'F2: the Living Model reader (the pre-alpha core)' },
  { file: 'orchestrator-v5/path-b/living-model/mapper.ts', fns: ['mapLivingModel'], kind: 'interpretation', why: 'F2: the Living Model mapper' },
  { file: 'orchestrator-v5/path-b/living-model/edit.ts', fns: ['applyExplicitEdit'], kind: 'interpretation', why: 'F2: the Living Model edit rules' },
  { file: 'orchestrator-v5/path-b/living-model/kernel.ts', fns: ['applyKernel'], kind: 'interpretation', why: 'F2: the Living Model kernel' },
  { file: 'cee/context-integrity/not-modelled-manifest.ts', fns: ['deriveNotModelledManifest'], kind: 'interpretation', why: 'F3: the GraphV3 not-modelled scan (the program variant is shared)' },
  { file: 'orchestrator-v5/agent-lane/goal-definition-sum.ts', fns: ['deriveTodayParts', 'withTodayPartsAtGoalLevel', 'todayPartsApartFromGoal'], kind: 'interpretation', why: 'F3: the legacy goal today-part rule' },
  { file: 'orchestrator-v5/compose/goal-scope-claim-input.ts', fns: ['goalScopeClaimInput'], kind: 'interpretation', why: 'F3: the legacy goal-scope claim gate' },
  { file: 'orchestrator-v5/agent-lane/reply/compose-reply.ts', fns: ['composeReplyShape'], kind: 'interpretation', why: 'F2: the legacy reply composer' },
  { file: 'orchestrator-v5/agent-lane/actions/rank.ts', fns: ['actionBarOf'], kind: 'interpretation', why: 'F3/F7: the legacy action bar ranker' },
  { file: 'orchestrator-v5/core-route/action-bar.ts', fns: ['coreActionBarOf'], kind: 'interpretation', why: 'F3/F7: the core lane action bar (no program contract)' },
  { file: 'orchestrator-v5/agent-lane/history-store.ts', fns: ['historyFromDurableTurns'], kind: 'interpretation', why: 'F7: the legacy history window (a program reads program-history.ts)' },
  { file: 'orchestrator-v5/agent-lane/goal-chance-estimate-egress.ts', fns: ['withEstimateGoalPointsAtEgress'], kind: 'interpretation', why: 'F3: the egress gate keyed on the PLoT result licence' },
  { file: 'routes/agent-v1-turn.ts', fns: ['stillValidOffers', 'isDurableAnswerOffer'], kind: 'interpretation', why: 'F1: the legacy route\'s offer rules' },
  // Refusal: the Living Model card rules (a program card's life is program-card.ts's).
  { file: 'orchestrator-v5/agent-lane/approval-chips.ts', fns: ['approvalChipsFor'], kind: 'refusal', why: 'F6: the Living Model approval chips' },
  { file: 'orchestrator-v5/agent-lane/proposal-object/lifecycle.ts', fns: ['reconcileHeldProposals'], kind: 'refusal', why: 'F6: the Living Model card lifecycle' },
  { file: 'orchestrator-v5/agent-lane/proposal-object/still-applies.ts', fns: ['heldCardStillApplies', 'heldCardSubjectMoved', 'heldCardAppliesAt'], kind: 'refusal', why: 'F6: the Living Model "card still applies" rules' },
  { file: 'orchestrator-v5/agent-lane/proposal-object/record.ts', fns: ['heldRecordAppliesAt', 'heldRecordsApplyAt'], kind: 'refusal', why: 'F6: the legacy applies rule (the record itself is shared)' },
];

/**
 * Legacy refusal and repair BRANCHES inside shared code the path does enter, trapped by V8's block counts at the branch itself.
 * The row writer (`persist-graph-write.ts:390`) runs the legacy horizon-basis hook on every core turn row, with no graph
 * (inventory §2.1: "should be skipped for a program"); none of its refusals or its repair may run. The save's legacy
 * analysis-hash refusal (`core-write.ts:89`) is OPEN A's branch: its condition is evaluated, its refusal must never be taken.
 */
const BRANCHES: readonly { readonly file: string; readonly at: readonly string[]; readonly kind: Kind; readonly why: string }[] = [
  { file: 'orchestrator-v5/goal-target/horizon-basis-provenance.ts', kind: 'refusal', why: 'F1: the legacy horizon-basis provenance refusals',
    at: ['horizon_basis write authorisation is invalid', 'horizon_basis authorised goal is absent', 'horizon_basis authorised goal is absent or ambiguous',
      'horizon_basis graph write is not prepared from stored provenance'] },
  { file: 'orchestrator-v5/goal-target/horizon-basis-provenance.ts', kind: 'refusal', why: 'F1: the legacy horizon-basis repair (rewrites a goal\'s basis)', at: ['delete node.horizon_basis'] },
  { file: 'orchestrator-v5/path-b/tools/core-write.ts', kind: 'refusal', why: 'OPEN A: the save refused on the legacy analysis hash', at: ['analysis_hash'] },
];

/**
 * ⚠ OPEN: a retired branch this tree DOES reach on the alpha path (STOP-and-report: no product code is changed here). Pinned by
 * identity (V8 function; the export trap is blind to it through the cycle above), it must still be observed (a row fails once the
 * edge is cut), and nothing else retired may appear.
 */
const OPEN: readonly { readonly id: string; readonly where: string; readonly functions: readonly string[]; readonly calls: readonly string[] }[] = [
  {
    id: 'A: every save evaluates the legacy analysis hash, over the legacy readiness projection (cut by CEE #3851)',
    where: 'path-b/tools/core-write.ts:88 computeAnalysisAffectingGraphHashSha256(after.graph), compared at :89 (a mismatch refuses the save as '
      + 'not_verified) -> context/graph-hash.ts -> orchestrator/tools/analysis-ready-helper.ts projectOptionForCanonicalBuilder, and graph-hash.ts:54 -> '
      + 'goal-target/held-user-links.ts:148 -> tools/handlers/run-analysis-participation-guard.ts isRetainedExcluded',
    functions: ['orchestrator/tools/analysis-ready-helper.ts#projectOptionForCanonicalBuilder', 'orchestrator-v5/tools/handlers/run-analysis-participation-guard.ts#isRetainedExcluded'],
    // The one call of it an export trap sees (held-user-links.ts holds the trapped binding); the projection's call it cannot.
    calls: ['orchestrator-v5/tools/handlers/run-analysis-participation-guard.ts#isRetainedExcluded <- orchestrator-v5/goal-target/held-user-links.ts'],
  },
];

/** Entry points the path really uses, trapped and counted by the SAME code: each must show calls (the instruments see what runs). */
const USED: readonly { readonly file: string; readonly fns: readonly string[] }[] = [
  { file: 'orchestrator-v5/core-route/contract.ts', fns: ['coreTurnContract', 'coreTurnFailure'] },
  { file: 'orchestrator-v5/model-program-turn/program-save.ts', fns: ['savePostimage'] },
];
const CONTRACT = ['orchestrator-v5/core-route/contract.ts#coreTurnContract', 'orchestrator-v5/core-route/contract.ts#coreTurnFailure'];
const SAVE = 'orchestrator-v5/model-program-turn/program-save.ts#savePostimage';

const RETIRED_FNS = new Set(RETIRED.flatMap((r) => r.fns.map((f) => `${r.file}#${f}`)));
const USED_FNS = new Set(USED.flatMap((u) => u.fns.map((f) => `${u.file}#${f}`)));
const OPEN_FNS = new Set(OPEN.flatMap((o) => o.functions));
const OPEN_CALLS = new Set(OPEN.flatMap((o) => o.calls));
/** A trapped call by its identity: the entry point and its caller's file. */
const callKey = (c: Call): string => `${c.id} <- ${c.site.replace(/:\d+:\d+$/, '')}`;
const MEASURED_FILES = new Set([...RETIRED, ...USED, ...BRANCHES].map((x) => x.file));

// ── INSTRUMENT 1: THE EXPORT TRAP ────────────────────────────────────────────────────────────────────────────────────────────
type Call = { readonly id: string; readonly site: string; readonly phase: string };
let phase = 'import';
const calls: Call[] = [];
/** Retired modules whose traps were installed because the route's own module graph loaded them. */
const loaded = new Set<string>();

/** Who called a trap: the first frame outside this file and outside the trapped module. */
function callerOf(file: string): string {
  const frames = (new Error().stack ?? '').split('\n').slice(1).map((l) => l.trim());
  const site = frames.find((l) => !l.includes('core-turn.no-retired-exec') && !l.includes(file) && /\/src\//.test(l)) ?? 'unknown';
  return /([\w.@-]+(?:\/[\w.@-]+)*\.ts):\d+:\d+/.exec(site.replaceAll(`${SRC}/`, ''))?.[0] ?? 'unknown';
}

/** A module whose named functions are traps (each records its call, then runs the real code); every other export is untouched. */
function trapModule(actual: Record<string, unknown>, file: string, fns: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(actual)) {
    let cached: { v: unknown } | undefined;
    // Read lazily: a module still loading in an import cycle is never touched before it is ready.
    Object.defineProperty(out, key, { enumerable: true, configurable: true, get: () => {
      const v = actual[key];
      if (!fns.includes(key) || typeof v !== 'function') return v;
      cached ??= { v: new Proxy(v, {
        apply: (t, self, args) => { calls.push({ id: `${file}#${key}`, site: callerOf(file), phase }); return Reflect.apply(t, self, args); },
        construct: (t, args, nt) => { calls.push({ id: `${file}#${key}`, site: callerOf(file), phase }); return Reflect.construct(t, args, nt); },
      }) };
      return cached.v;
    } });
  }
  return out;
}

// ── INSTRUMENT 2: V8'S OWN EXECUTION COUNTS ──────────────────────────────────────────────────────────────────────────────────
// Precise coverage is isolate-wide and each take resets its counters; it is started here and never stopped, so a coverage run of
// the suite still works (it loses only this file's counts).
const inspector = new Session();
type Range = { readonly startOffset: number; readonly endOffset: number; readonly count: number };
type ScriptCoverage = { readonly scriptId: string; readonly url: string; readonly functions: readonly { readonly functionName: string; readonly ranges: readonly Range[] }[] };
type Take = { readonly fns: readonly string[]; readonly branches: readonly string[] };
const sources = new Map<string, string>();
const sourceOf = async (scriptId: string): Promise<string> => {
  if (!sources.has(scriptId)) sources.set(scriptId, (await inspector.post('Debugger.getScriptSource', { scriptId }) as { scriptSource: string }).scriptSource);
  return sources.get(scriptId)!;
};
/** The traps' functions (`file#name`) and BRANCHES that ran since the last take; a take's own `post` resets the counts at once. */
async function take(files: ReadonlySet<string>): Promise<Take> {
  const { result } = await inspector.post('Profiler.takePreciseCoverage') as unknown as { result: ScriptCoverage[] };
  const fns = new Set<string>();
  const branches: string[] = [];
  for (const script of result) {
    if (!script.url.startsWith('file://')) continue;
    const file = rel(fileURLToPath(script.url.split('?')[0]!));
    if (!files.has(file)) continue;
    for (const fn of script.functions) if (fn.functionName !== '' && (fn.ranges[0]?.count ?? 0) > 0) fns.add(`${file}#${fn.functionName}`);
    for (const b of BRANCHES.filter((x) => x.file === file)) {
      const src = await sourceOf(script.scriptId);
      for (const at of b.at) {
        const offset = src.indexOf(at);
        if (offset < 0) { branches.push(`${file}: "${at}" NOT FOUND`); continue; }
        // The innermost range holding the branch gives its count (V8 reports a nested range only where the count differs).
        const ranges = script.functions.flatMap((f) => f.ranges).filter((r) => r.startOffset <= offset && offset < r.endOffset);
        const inner = ranges.reduce<Range | undefined>((a, r) => (a === undefined || r.endOffset - r.startOffset < a.endOffset - a.startOffset ? r : a), undefined);
        if ((inner?.count ?? 0) > 0) branches.push(`${file}: "${at}" x${inner!.count}`);
      }
    }
  }
  return { fns: [...fns].sort(), branches };
}
/** The path's V8 counts so far in this step, kept across each double's own work. */
let measured: Take[] = [];
/**
 * A double's own work, outside the measure. A double stands in for a served route whose body is out of scope, and V8 counts a FILE
 * whichever module instance runs it: the register double computes this tree's receipt hash with graph-hash.ts itself. Each take
 * runs synchronously inside `post`, so nothing else runs between the two.
 */
function asDouble<T>(work: () => T): Promise<T> {
  const before = take(MEASURED_FILES);
  const out = work();
  const own = take(new Set());
  return before.then((t) => { measured.push(t); return own; }).then(() => out);
}

// ── THE HARNESS: the minimum of `core-turn.route.test.ts` (store, scripted provider, read / register / versions doubles). ─────
let SCENARIO = '';
let persisted: Json | null = null;
const registered: Json[] = [];
const turnRows = new Map<string, any>();
const fenceRows = new Map<string, { generation: number; stopped_at: string | null }>();
let fenceGeneration = 0;
let pausedRun: any = null;
const conversationIds = new Map<string, string>();
/** The next write's acknowledgement is lost (a 503) after it committed: once, then cleared. */
let loseAck = false;
/** Every route served in process, by its pattern; every outbound HTTP call, by its path. */
const dispatched: string[] = [];
const outbound: string[] = [];
/** A program's revision, as the served read and register give it (`programRevisionOf`, else the graph's own hash). */
const revisionOf = (g: unknown): string => programRevisionOf(g) ?? computeAnalysisAffectingGraphHash(g as never) ?? '';

const store = {
  readOpenAiPausedRun: vi.fn(async () => pausedRun),
  saveOpenAiPausedRun: vi.fn(async (_s: string, r: any) => { if (pausedRun !== null) return false; pausedRun = r; return true; }),
  takeOpenAiPausedRun: vi.fn(async (_s: string, id: string) => { if (pausedRun?.pause_id !== id) return false; pausedRun = null; return true; }),
  readOpenAiConversationId: vi.fn(async (sid: string) => conversationIds.get(sid) ?? null),
  claimOpenAiConversationId: vi.fn(async (sid: string, id: string) => { if (!conversationIds.has(sid)) conversationIds.set(sid, id); return conversationIds.get(sid); }),
  loadGraph: async () => persisted,
  loadGraphAndBriefText: async () => ({ graph: persisted, briefText: BAKERY_BRIEF }),
  readFactsFor: vi.fn(async () => []),
  readRecent: vi.fn(async () => [...turnRows.values()].reverse()),
  readFactsWithTurnFor: async () => [],
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => turnRows.get(id) ?? null),
  readMostRecentPendingActions: vi.fn(async () => [...turnRows.values()].filter((r) => !String(r.turn_id).endsWith(':claim')).at(-1)?.pending_actions ?? []),
  releaseTurnClaim: vi.fn(async (_sid: string, id: string, hash: string) => { if (turnRows.get(id)?.request_hash === hash) turnRows.delete(id); }),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  readExistingScenario: vi.fn(async () => null),
  append: vi.fn(async (write: Json) => {
    const key = String(write.turn_id);
    const prior = turnRows.get(key);
    if (prior !== undefined) return prior.request_hash === write.request_hash ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
    const row = { ...write, id: `row-${turnRows.size + 1}`, created_at: new Date(Date.now() + turnRows.size).toISOString(), assistant_message: write.assistantMessage, user_message: write.userMessage };
    turnRows.set(key, row);
    return { id: row.id };
  }),
  getScenarioOwner: async () => null,
  invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
  invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  claimTurnFence: vi.fn(async (sid: string, tid: string) => {
    if (!fenceRows.has(`${sid}:${tid}`)) fenceRows.set(`${sid}:${tid}`, { generation: ++fenceGeneration, stopped_at: null });
    return { scenarioId: sid, turnId: tid, generation: fenceRows.get(`${sid}:${tid}`)!.generation };
  }),
  turnFenceRowExists: vi.fn(async (sid: string, tid: string) => fenceRows.has(`${sid}:${tid}`)),
  markTurnStopped: vi.fn(async (sid: string, tid: string) => {
    const row = fenceRows.get(`${sid}:${tid}`);
    fenceRows.set(`${sid}:${tid}`, { generation: row?.generation ?? ++fenceGeneration, stopped_at: '2026-10-27T10:00:00.000Z' });
    return { stopped: true, claimed: row !== undefined, alreadyCommitted: false };
  }),
  isTurnStopped: vi.fn(async (sid: string, tid: string) => (fenceRows.get(`${sid}:${tid}`)?.stopped_at ?? null) !== null),
};
vi.mock('../../orchestrator-v5/session/index.js', () => ({ getSessionStore: () => store, resetSessionStoreForTests: () => {}, SessionReadError: class SessionReadError extends Error {} }));
vi.mock('../../orchestrator/user-identity.js', async (original) => ({ ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }) }));

let served = 0;
let preparedId = '';
let canonicalDraft: string | undefined;
let outputs: Json[][] = [];
let sent: Json[] = [];
/** When set, the next provider call waits for it: a turn still running while its Stop is sent. */
let holdProvider: Promise<void> | undefined;
const ANSWER = 'The model holds the oven price as a question.';
const responsesBody = (output: Json[]): Json => {
  served += 1;
  return { id: `resp_${served}`, object: 'response', model: 'gpt-scripted', status: 'completed',
    output: output.map((item, i) => item.type === 'message'
      ? { id: `msg_${served}_${i}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: item.text, annotations: [] }] }
      : { id: `fc_${served}_${i}`, status: 'completed', type: 'function_call', name: item.name, call_id: item.call_id ?? `call_${served}_${i}`,
          arguments: JSON.stringify(item.name === 'apply_change' && item.args === undefined ? { proposal_id: preparedId } : item.args ?? {}) }),
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The served read's PROGRAM branch (`assist.v1.scenario-graph.ts`: `programAnalysisRead` and the response body): no legacy reader. */
function graphRead(): Json {
  if (persisted === null) return { scenario_id: SCENARIO, graph: null, graph_present: false, brief_text: null, graph_identity_hash: null, graph_hash: null, content_hash: null };
  const identity = computeGraphIdentityHash(persisted as never)!;
  const ready = programReadinessOf(persisted);
  return { schema: 'scenario_graph.v1', scenario_id: SCENARIO, graph: toOutboundGraph(persisted), graph_present: true, brief_text: BAKERY_BRIEF,
    graph_identity_hash: identity, content_hash: identity.value, graph_hash: revisionOf(persisted),
    analysis_state: null, analysis_result: null, canonical_analysis_view: reopenProgram(persisted)?.view ?? null,
    current_read: { run_state: null, computed_against_hash: null, current_analysis_hash: null, figures: [], ...(ready === undefined ? {} : { analysis_ready: ready }) } };
}
/** The route's own turn-fence reader (after `resetModules`): the register commits a core turn's write under the turn's handle. */
let currentTurnFence: () => { readonly generation: number | null } | undefined = () => undefined;
/** The register (`assist.v1.scenario-graph-register.ts`), in its served shapes: the fence, the compare-and-set, the receipt, a lost acknowledgement. */
function register(b: Json): { readonly status: number; readonly body: Json } {
  // The commit's own gate (append_turn_atomic_v4): a write under a stopped turn's handle is refused in the transaction.
  const bound = currentTurnFence();
  if (bound !== undefined && [...fenceRows.values()].some((r) => r.generation === bound.generation && r.stopped_at !== null)) return { status: 409, body: { details: { code: 'TURN_STOPPED' } } };
  const current = persisted === null ? null : computeGraphIdentityHash(persisted as never)!.value;
  if ((b.expected_graph_identity_hash ?? null) !== current) return { status: 409, body: { details: { code: 'GRAPH_STALE' } } };
  persisted = b.graph as Json;
  registered.push(b);
  if (loseAck) { loseAck = false; return { status: 503, body: { code: 'upstream_unavailable' } }; }
  const identity = computeGraphIdentityHash(persisted as never)!;
  // The receipt carries the analysis hash this tree's save still compares (OPEN A).
  return { status: 200, body: { registered: true, graph_identity_hash: identity, graph_hash: revisionOf(persisted),
    model_version: { version_id: `v_${registered.length}`, version_number: registered.length, mutation_id: `m_${registered.length}`,
      creation_kind: registered.length === 1 ? 'initial' : 'committed_mutation', graph_identity_hash: identity.value,
      analysis_affecting_hash: computeAnalysisAffectingGraphHashSha256(persisted as never) } } };
}

type Step = { readonly name: string; readonly status: number; readonly retired: readonly string[]; readonly used: readonly string[] };
const steps: Step[] = [];

// Each step takes V8's counts several times (once around every double), so a row runs for seconds: never vitest's 5 s default.
describe('W5: on the real core route, no retired behaviour governs an alpha operation', { timeout: 60_000 }, () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    inspector.connect();
    await inspector.post('Profiler.enable');
    await inspector.post('Debugger.enable');
    await inspector.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
    vi.stubGlobal('fetch', vi.fn(streamWhenAsked(async (url: unknown, init?: { body?: unknown }) => {
      outbound.push(String(url).replace(/\/v1\/conversations\/[^/]+/, '/v1/conversations/:id'));
      if (String(url).endsWith('/v1/conversations')) return json({ id: `conv_${randomUUID()}`, object: 'conversation' });
      if (/\/v1\/conversations\/[^/]+\/items$/.test(String(url))) return json({ object: 'list', data: [], first_id: null, last_id: null, has_more: false });
      const body = JSON.parse(String(init?.body ?? '{}')) as Json;
      if (body.text?.format?.name === 'canonical_model') { sent.push(body); return json(responsesBody(canonicalDraft === undefined ? [] : [{ type: 'message', text: canonicalDraft }])); }
      if (body.text?.format?.type === 'json_schema') return json(responsesBody([]));
      sent.push(body);
      if (holdProvider !== undefined) { const hold = holdProvider; holdProvider = undefined; await hold; }
      const next = outputs.shift() ?? [{ type: 'message', text: ANSWER }];
      if (next[0]?.type === 'refuse') return json({ error: { message: 'Refused.', type: 'invalid_request_error', param: null, code: null } }, 400);
      return json(responsesBody(next));
    })));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    // The traps go on the module instances the route is about to load: the retired entry points, then the used ones.
    for (const r of [...RETIRED, ...USED]) {
      vi.doMock(join(SRC, r.file), async (importOriginal: () => Promise<Record<string, unknown>>) => {
        loaded.add(r.file);
        return trapModule(await importOriginal(), r.file, r.fns);
      });
    }
    const route = await import('../core-turn.js');
    // The real Stop handler (route-v2's `/orchestrate/v2/turn/stop` body), over the same store, as the route harness mounts it.
    const { recordExplicitTurnStop } = await import('../turn-stop.js');
    ({ currentTurnFence } = await import('../../orchestrator-v5/session/turn-fence.js'));
    app = Fastify({ logger: false });
    app.addHook('onRequest', async (req) => { dispatched.push(req.routeOptions.url ?? req.url); });
    app.post('/assist/v1/scenarios/:id/graph', async () => asDouble(graphRead));
    app.post('/assist/v1/scenarios/:id/graph/register', async (req, reply) => {
      const out = await asDouble(() => register(req.body as Json));
      return reply.code(out.status).send(out.body);
    });
    app.post('/assist/v1/scenarios/:id/versions', async (req) => asDouble(() => ({ versions: registered.map((b, i) => ({
      version_id: `v_${i + 1}`, sequence: i + 1, created_at: '2026-10-27T10:00:00.000Z',
      creation: { kind: 'committed_mutation', mutation_id: `m_${i + 1}`, source_turn_id: registrationTurnId((req.params as { id: string }).id, String(b.operation_id)) } })) })));
    app.post('/orchestrate/v2/turn/stop', async (req, reply) => { const r = await recordExplicitTurnStop(req, 'req-stop'); return reply.code(r.status).send(r.body as never); });
    await app.register(route.coreTurnRoute);
    await app.ready();
    phase = 'ready';
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => {
    SCENARIO = randomUUID(); persisted = null; canonicalDraft = undefined; registered.length = 0; fenceRows.clear(); turnRows.clear(); conversationIds.clear();
    pausedRun = null; outputs = []; sent = []; preparedId = ''; loseAck = false; holdProvider = undefined;
  });

  const post = (payload: Json) => app.inject({ method: 'POST', url: '/agent/v1/core-turn',
    payload: { kind: 'message', scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame', ...payload } });
  const typed = (message: string, turnId = randomUUID()) => post({ turn_id: turnId, message, source: 'composer' });
  const pressOf = (card: Json): Json => ({ turn_id: randomUUID(), message: card.approve_action.message, source: 'chip_click',
    chip: { id: card.approve_action.id, action_type: card.approve_action.action_type } });
  const runPress = (): Json => ({ turn_id: randomUUID(), message: 'Run the analysis', source: 'chip_click', chip: { id: 'run_analysis', action_type: 'run_analysis' } });
  const canvasEdit = (value: number) => post({ kind: 'system_event', turn_id: randomUUID(), event: { kind: 'factor_value_edit', target_id: 'base_sales', raw_value: value } });
  const storedRuns = (): number => savedProgramOf(persisted)!.runs.length;
  const figure = (id: string): number | null => savedProgramOf(persisted)!.canonical.quantities.find((x) => x.id === id)!.value;
  /** The saved model as one saved before its Run (a figure moved, the Runs kept): its newest stored Run is no longer current. */
  const staleRun = (): void => {
    const p = savedProgramOf(persisted)!;
    persisted = postimageOf({ ...p, canonical: { ...p.canonical, quantities: p.canonical.quantities.map((x) => (x.id === 'base_sales' ? { ...x, value: (x.value ?? 0) + 7 } : x)) } }) as Json;
    expect(reopenProgram(persisted)!.current, 'the stored Run is from an earlier revision').toBe(false);
  };
  const answer = (value: number, quote: string): Json => ({ public_label: `Oven price ${quote}`, basis: 'their answer', request: '', remove: [],
    answers: [{ id: 'oven_price', value, low: null, high: null, range_kind: null, party: null, quote, basis: null, status: 'known', author: 'person' }] });

  /** One operation through the route, on both instruments: every retired call, function and branch it reached, and the used entries'. */
  const step = async (name: string, run: () => Promise<{ statusCode: number; json: () => unknown }>): Promise<Json> => {
    await take(new Set());
    measured = [];
    const c0 = calls.length;
    phase = name;
    const r = await run();
    phase = 'ready';
    measured.push(await take(MEASURED_FILES));
    const fns = new Set(measured.flatMap((t) => t.fns));
    const ofCalls = calls.slice(c0);
    steps.push({ name, status: r.statusCode,
      retired: [...new Set([...ofCalls.filter((c) => RETIRED_FNS.has(c.id) && !OPEN_CALLS.has(callKey(c))).map((c) => `trap ${c.id} <- ${c.site}`),
        ...[...fns].filter((f) => RETIRED_FNS.has(f) && !OPEN_FNS.has(f)).map((f) => `ran ${f}`), ...measured.flatMap((t) => t.branches).map((b) => `branch ${b}`)])].sort(),
      used: [...new Set([...ofCalls.filter((c) => USED_FNS.has(c.id)).map((c) => `trap ${c.id}`), ...[...fns].filter((f) => USED_FNS.has(f)).map((f) => `ran ${f}`)])].sort() });
    return r.json() as Json;
  };
  /** The draft every row starts from: the canonical drafter's first model, saved, with its reading card held. */
  const draft = async (): Promise<Json> => {
    canonicalDraft = JSON.stringify(bakery());
    const d = await step('a first draft', () => typed(BAKERY_BRIEF));
    expect(steps.at(-1)!.status, JSON.stringify(d._agent)).toBe(200);
    return d;
  };
  const readingCardOf = (d: Json): Json => { const c = (d.cards as Json[]).find((x) => x.reading === true); expect(c, JSON.stringify(d.cards)).toBeDefined(); return c!; };
  /** A card holding their answer, proposed on a typed turn. */
  const propose = async (): Promise<Json> => {
    outputs = [[{ type: 'function_call', name: 'propose_change', call_id: 'prop', args: answer(2500, '£2,500') }], [{ type: 'message', text: 'I prepared that change.' }]];
    const p = await step('a card proposed', () => typed('The second oven would cost £2,500.'));
    const card = (p.cards as Json[]).find((c) => c.reading !== true);
    expect(card, JSON.stringify(p._agent)).toBeDefined();
    preparedId = String(card!.proposal_id);
    return card!;
  };
  const approve = async (name: string, press: Json): Promise<Json> => {
    outputs = [[{ type: 'function_call', name: 'apply_change', call_id: `apply_${randomUUID()}` }], [{ type: 'message', text: 'Saved.' }]];
    return step(name, () => post(press));
  };

  it('SETUP + CONTRAST: every trap is on the instance the route loads, and a direct call into EACH retired entry point shows on both instruments (each trap can go RED)', async () => {
    for (const r of [...RETIRED, ...USED, ...BRANCHES]) expect(existsSync(join(SRC, r.file)), r.file).toBe(true);
    for (const b of BRANCHES) for (const at of b.at) expect(readFileSync(join(SRC, b.file), 'utf8'), `${b.file}: ${at}`).toContain(at);
    // Loaded by the route's own module graph (no-load is NOT the claim): the legacy engine, PLoT, ISL and the readiness assessor.
    for (const f of ['routes/agent-v1-turn.ts', 'orchestrator/plot-client.ts', 'adapters/isl/counterfactual-client.ts', 'orchestrator/tools/analysis-ready-helper.ts',
      'orchestrator-v5/tools/registry.ts', 'orchestrator-v5/path-b/living-model/view.ts']) expect(loaded, f).toContain(f);
    // Any argument read throws, so no entry point gets past its first use of its input (and validateGraph's body fails before undici).
    const poison = new Proxy({}, { get: () => { throw new Error('contrast: not a real input'); } });
    const missing: string[] = [];
    for (const r of RETIRED) {
      const mod = await import(/* @vite-ignore */ join(SRC, r.file)) as Record<string, unknown>;
      for (const fn of r.fns) {
        const f = mod[fn];
        if (typeof f !== 'function') { missing.push(`${r.file}#${fn}: not a function`); continue; }
        await take(new Set());
        const c0 = calls.length;
        try { await (f as (...a: unknown[]) => unknown)(fn === 'validateGraph' ? { big: 1n } : poison, poison, poison); } catch { /* the call is what counts */ }
        const ran = (await take(new Set([r.file]))).fns;
        if (!calls.slice(c0).some((c) => c.id === `${r.file}#${fn}`)) missing.push(`${r.file}#${fn}: no trap call`);
        if (!ran.includes(`${r.file}#${fn}`)) missing.push(`${r.file}#${fn}: V8 counted no run`);
        calls.length = c0;
      }
    }
    expect(missing).toEqual([]);
    // CONTRAST for the branch traps: each can go RED. A goal write whose basis was not prepared from stored provenance reaches the
    // hook's repair and its refusal; a receipt whose analysis hash differs reaches the save's legacy refusal.
    const hb = await import('../../orchestrator-v5/goal-target/horizon-basis-provenance.js');
    await take(new Set());
    try { hb.assertDoorProvenance({ nodes: [{ id: 'g', kind: 'goal', horizon_basis: { bound_months: 6 } }] }, null, 's'); } catch { /* the refusal is what counts */ }
    // OPEN A's refusal, while that edge (and its BRANCHES entry) stands: it goes with them.
    const openA = BRANCHES.some((b) => b.file === 'orchestrator-v5/path-b/tools/core-write.ts');
    if (openA) {
      const cw = await import('../../orchestrator-v5/path-b/tools/core-write.js');
      const g = withNewRun({ model_program: MODEL_PROGRAM, canonical: bakery(), seed: seedOf('contrast'), person_words: [BAKERY_BRIEF], runs: [] }).graph as Json;
      const id = computeGraphIdentityHash(g as never)!;
      const write = await cw.writeCorePostimage({ dispatch: async (path) => (path.endsWith('/graph/register')
        ? { status: 200, json: { registered: true, graph_identity_hash: id, graph_hash: 'h', model_version: { version_id: 'v_1', version_number: 1, mutation_id: 'm_1',
          graph_identity_hash: id.value, analysis_affecting_hash: 'not-this-graphs-hash' } } }
        : { status: 200, json: { graph: g, graph_hash: 'h', graph_identity_hash: id } }) },
      { scenarioId: randomUUID(), graph: g, operationId: randomUUID(), expectedIdentity: null, ownVersion: async () => null });
      expect(write.status, 'the save is refused on the legacy hash').toBe('unknown');
    }
    const hit = (await take(MEASURED_FILES)).branches;
    for (const at of ['delete node.horizon_basis', 'horizon_basis graph write is not prepared from stored provenance', ...(openA ? ['analysis_hash'] : [])]) {
      expect(hit, at).toEqual(expect.arrayContaining([expect.stringContaining(`"${at}"`)]));
    }
    expect(outbound, 'the contrast made no outbound call').toEqual([]);
  });

  it('⭐ a first draft, the approval of the card it held, a card proposed and approved, an edit, a Run press (current, then stale) and a replay: each succeeds as the route says', async () => {
    const drafted = await draft();
    expect(registered, 'the draft saved once').toHaveLength(1);
    const reading = readingCardOf(drafted);
    preparedId = String(reading.proposal_id);
    const confirmed = await approve('the approval of the card the draft held', pressOf(reading));
    expect(confirmed.receipts, JSON.stringify(confirmed._agent)).toEqual([expect.objectContaining({ authorised_by: 'person' })]);
    const card = await propose();
    const press = pressOf(card);
    const saves = registered.length;
    const approved = await approve('the approval of a card', press);
    expect([approved.receipts, registered.length - saves, figure('oven_price')], JSON.stringify(approved._agent))
      .toEqual([[expect.objectContaining({ authorised_by: 'person' })], 1, 2500]);
    // An edit: the person's own figure on the canvas, saved with a new Run, no model call.
    const before = sent.length;
    const edited = await step('an edit (a canvas figure)', () => canvasEdit(320));
    expect([steps.at(-1)!.status, figure('base_sales'), sent.length - before], JSON.stringify(edited)).toEqual([200, 320, 0]);
    // A Run press on a current Run: that Run, shown as stored, nothing written; on a stale one, a NEW Run, saved with the model.
    const runs = storedRuns();
    outputs = [[{ type: 'message', text: 'Each option, by the Run.' }]];
    const shown = await step('a Run press, current Run', () => post(runPress()));
    expect([shown.error, shown.model_program?.stored, storedRuns()], JSON.stringify(shown._agent)).toEqual([null, true, runs]);
    staleRun();
    outputs = [[{ type: 'message', text: 'Each option, by the new Run.' }]];
    const ran = await step('a Run press, stale Run', () => post(runPress()));
    expect([ran.error, ran.model_program?.saved, storedRuns()], JSON.stringify(ran._agent)).toEqual([null, true, runs + 1]);
    // A replay: the approval's press resent with its own turn id answers from its record: no model call, no write.
    const [sentBefore, writesBefore] = [sent.length, registered.length];
    const again = await step('a replay (the same press resent)', () => post(press));
    expect([again.durability, sent.length, registered.length]).toEqual(['replayed', sentBefore, writesBefore]);
  });

  it('a recovery: a save whose acknowledgement was lost after it committed is proved by its own version and readback, and said with that receipt', async () => {
    await draft();
    staleRun();
    loseAck = true;
    outputs = [[{ type: 'message', text: 'Each option, by the new Run.' }]];
    const saves = registered.length;
    const recovered = await step('a recovery (an acknowledgement lost after commit)', () => post(runPress()));
    expect([steps.at(-1)!.status, recovered.error, registered.length - saves], JSON.stringify(recovered._agent)).toEqual([200, null, 1]);
    expect(recovered.receipts, 'the save, found by its own operation').toEqual([expect.objectContaining({ version_id: `v_${registered.length}`, authorised_by: 'person' })]);
    expect(loseAck, 'the acknowledgement was lost').toBe(false);
  });

  it('negatives: a press whose words are not the card\'s own, a press on a card no longer waiting, and a reply lost after its save', async () => {
    const drafted = await draft();
    const reading = readingCardOf(drafted);
    const refused = await step('a press whose words are not the card\'s own', () => post({ ...pressOf(reading), message: 'Something else entirely.' }));
    expect([steps.at(-1)!.status, refused.error]).toEqual([409, expect.objectContaining({ code: 'CARD_NOT_WAITING', nothing_saved: true })]);
    const card = await propose();
    await approve('the approval of a card', pressOf(card));
    const stale = await step('a press on a card no longer waiting (already applied)', () => post(pressOf(card)));
    expect([steps.at(-1)!.status, stale.error]).toEqual([409, expect.objectContaining({ code: 'CARD_NOT_WAITING', nothing_saved: true })]);
    staleRun();
    outputs = [[{ type: 'refuse' }]];
    const lost = await step('a reply lost after its save', () => post(runPress()));
    expect([steps.at(-1)!.status, lost.error]).toEqual([502, expect.objectContaining({ message: 'The saved change is kept, but the reply didn’t arrive. Send a new message to continue.', nothing_saved: false })]);
  });

  it('a Stop: the person stops a card\'s approval while its call is out; the write the AI then makes commits nothing', async () => {
    await draft();
    const card = await propose();
    const press = pressOf(card);
    let release!: () => void;
    holdProvider = new Promise<void>((resolve) => { release = resolve; });
    outputs = [[{ type: 'function_call', name: 'apply_change', call_id: 'apply' }], [{ type: 'message', text: 'Saved.' }]];
    const saves = registered.length;
    const before = sent.length;
    const a = await step('a Stop', async () => {
      const approval = post(press);
      await vi.waitFor(() => expect(sent.length).toBe(before + 1));
      const stop = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn/stop', payload: { scenario_id: SCENARIO, turn_id: press.turn_id } });
      expect(stop.json()).toMatchObject({ stopped: true, claimed: true, turn_id: press.turn_id });
      release();
      return approval;
    });
    expect([registered.length - saves, figure('oven_price'), a.receipts], JSON.stringify(a._agent)).toEqual([0, null, []]);
  });

  it('⭐ THE CLAIM across every operation above, on both instruments: no retired entry point, function or branch but the named OPEN edge; the positive controls show calls at each', () => {
    const names = steps.map((s) => s.name);
    for (const must of ['a first draft', 'the approval of the card the draft held', 'the approval of a card', 'an edit (a canvas figure)', 'a Run press, stale Run',
      'a replay (the same press resent)', 'a recovery (an acknowledgement lost after commit)', 'a press on a card no longer waiting (already applied)', 'a Stop']) {
      expect(names, must).toContain(must);
    }
    expect(steps.map((s) => [s.name, s.retired])).toEqual(steps.map((s) => [s.name, []]));
    for (const s of steps) {
      expect(s.used.filter((u) => CONTRACT.some((c) => u.endsWith(c))), `${s.name}: the contract, on both instruments`)
        .toEqual(expect.arrayContaining([expect.stringMatching(/^trap /), expect.stringMatching(/^ran /)]));
    }
    for (const s of steps.filter((x) => ['a first draft', 'the approval of the card the draft held', 'the approval of a card', 'an edit (a canvas figure)',
      'a Run press, stale Run', 'a recovery (an acknowledgement lost after commit)', 'a reply lost after its save'].includes(x.name))) {
      expect(s.used, `${s.name}: the program save, on both instruments`).toEqual(expect.arrayContaining([`trap ${SAVE}`, `ran ${SAVE}`]));
    }
    // No legacy turn engine was dispatched to, and nothing was called out but the provider (no PLoT, no ISL).
    expect(dispatched.filter((d) => d === '/agent/v1/turn' || d === '/orchestrate/v2/turn')).toEqual([]);
    const paths = [...new Set(outbound.map((u) => new URL(u).pathname))];
    expect(paths, 'the provider was called').toContain('/v1/responses');
    expect(paths.filter((p) => !['/v1/conversations', '/v1/conversations/:id/items', '/v1/responses'].includes(p))).toEqual([]);
  });

  it('⚠ OPEN: the named edge is still open on this tree (observed by identity); once it is cut, this row fails and its entry goes', async () => {
    await draft();
    staleRun();
    outputs = [[{ type: 'message', text: 'Each option, by the new Run.' }]];
    // One save, measured as the steps are: V8 counts each OPEN function.
    await take(new Set());
    measured = [];
    expect((await post(runPress())).statusCode).toBe(200);
    measured.push(await take(MEASURED_FILES));
    const ran = new Set(measured.flatMap((t) => t.fns));
    const trapped = new Set(calls.filter((c) => c.phase !== 'import').map(callKey));
    for (const o of OPEN) {
      for (const f of o.functions) expect(ran.has(f), `${o.id}: ${f}`).toBe(true);
      for (const c of o.calls) expect(trapped.has(c), `${o.id}: ${c}`).toBe(true);
    }
  });

  it('module level (the load; no-load is NOT the claim): no alpha code calls a retired entry point while the route loads, and the load calls out to nothing', () => {
    const atLoad = calls.filter((c) => c.phase === 'import' && RETIRED_FNS.has(c.id));
    const alpha = /^(orchestrator-v5\/(model-program|model-program-turn|core-route)\/|routes\/core-turn\.ts:)/;
    expect(atLoad.filter((c) => alpha.test(c.site)).map((c) => `${c.id} <- ${c.site}`)).toEqual([]);
    // What a retired module does at its own load is its own (a frozen constant): measured 27 Oct, one, within the legacy read.
    expect(atLoad.map(callKey)).toEqual(['routes/canonical-analysis-view.ts#projectCanonicalAnalysisView <- routes/scenario-graph-analysis-read.ts']);
  });
});
